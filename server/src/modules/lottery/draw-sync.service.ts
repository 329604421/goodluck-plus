import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchInfinityService } from '../../integrations/volcengine/search-infinity.service';
import { RedeemService } from '../redeem/redeem.service';
import { ApiException } from '../../common/api-exception';
import {
  LOTTERY_RULES,
  LotteryType,
  nextDrawDate,
  issueOfDate,
  isDrawDayOfType,
} from './lottery-rules';
import { utcDate } from '../../common/date-utc';
import { fmtPool } from '../../common/format';

/**
 * 开奖同步服务（文档 §9.4、§10）：
 * 1. SearchInfinity 查询 → 正则解析红蓝球 → upsert DrawResult
 * 2. 触发兑奖预计算
 * 3. 期号推进：开奖后 currentIssue+1、drawDate=下一开奖日
 * Cron 装饰器在 jobs/draw-sync.job.ts（timeZone 兜底）。
 *
 * 2026-08-19 新增 syncDrawByDate：用户端补差（日历"同步"按钮），
 * 按开奖日期同步任意历史期，不推进当前期号。
 */
@Injectable()
export class DrawSyncService {
  private readonly logger = new Logger(DrawSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchInfinityService,
    private readonly redeem: RedeemService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 定时同步最新一期开奖结果（开奖日晚 21:00-23:00 轮询）。
   * 只查【前一日及之前】最近一期已开奖——开奖在晚上（21:15），
   * 若 cron 跑在当晚（含今日），21:15 前会去抓"今天未开的期"造成竞态/脏数据；
   * 统一改为同步昨日及更早的已开期，当天晚上的期次日同步（幂等，无丢失）。
   */
  async syncLatestDraw(type: LotteryType): Promise<void> {
    if (!this.config.get<boolean>('drawSyncEnabled')) return;
    const latestDrawn = this.previousDrawDate(type, new Date());
    await this.syncDrawByIssue(type, issueOfDate(type, latestDrawn), {
      updateStatus: true,
      drawDateFallback: latestDrawn,
    });
  }

  /**
   * 用户端补差：按开奖日期同步某一期（POST /api/lottery/sync）。
   * - 只允许过去日期（含今天）；未来日期拒绝
   * - 已存在则跳过（幂等）
   * - 不推进 lottery_status 当前期（历史补差不影响"待开奖"语义）
   */
  async syncDrawByDate(
    type: LotteryType,
    date: string,
  ): Promise<{ synced: boolean; skipped?: boolean; period?: string; message?: string }> {
    const rule = LOTTERY_RULES[type];
    const target = new Date(`${date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(target.getTime())) {
      throw new ApiException(40001, '日期格式错误，需为 YYYY-MM-DD');
    }
    if (target > today) {
      throw new ApiException(40001, '未来日期无需同步');
    }
    // 非开奖日直接拒绝（避免无谓的搜索调用）
    if (!isDrawDayOfType(target, type)) {
      throw new ApiException(40001, `${date} 不是${rule.name}开奖日`);
    }

    const issue = issueOfDate(type, target);
    return this.syncDrawByIssue(type, issue, {
      updateStatus: false,
      drawDateFallback: utcDate(target.getFullYear(), target.getMonth() + 1, target.getDate()),
    });
  }

  /** 核心：按期号同步（搜索 → 解析 → upsert → 兑奖计算 → 可选推进当前期） */
  private async syncDrawByIssue(
    type: LotteryType,
    issue: string,
    opts: { updateStatus: boolean; drawDateFallback?: Date },
  ): Promise<{ synced: boolean; skipped?: boolean; period: string; message?: string }> {
    const rule = LOTTERY_RULES[type];

    const exists = await this.prisma.drawResult.findUnique({
      where: { lotteryType_period: { lotteryType: type, period: issue } },
    });
    if (exists) {
      this.logger.log(`${rule.name} 第 ${issue} 期已同步，跳过`);
      // skipped 也确保 status 可用（冷启动重复同步/同步已存在期时，首页状态与奖池仍要能展示）
      await this.ensureStatusFresh(type);
      // 2026-08-25：skipped（开奖已存在）也触发兑奖计算——用户点"同步开奖信息"即可
      // 立即修复历史 pending 票（含 5 位期号票），不必等 15 分钟兜底 cron
      await this.redeem.computeForDraw(type, issue);
      return { synced: true, skipped: true, period: issue };
    }

    // query 期号用官方写法：双色球 7 位（2026090），大乐透 5 位（26090）。
    // 若与页面写法不一致，搜索召回会偏移——实测 dlt 用 7 位 query 时抓到的是
    // 最新一期（26094）的号码而非目标期，造成脏数据。
    const queryIssue = type === 'dlt' ? issue.replace(/^20/, '') : issue;

    let searchResp = await this.search.searchDrawResult(rule.name, queryIssue, { lotteryType: type });
    let parsed =
      type === 'ssq'
        ? this.search.parseSsqDraw(searchResp, issue)
        : this.search.parseDltDraw(searchResp, issue);

    // 二轮重试：官方三站对历史期召回不足时，去掉站点过滤再搜一次
    // （地方福彩公告页/门户站有完整号码正文，实测 2026090 期由此命中）
    if (!parsed) {
      this.logger.log(`${rule.name} 第 ${issue} 期首轮解析失败，尝试无站点过滤重搜`);
      try {
        searchResp = await this.search.searchDrawResult(rule.name, queryIssue, {
          lotteryType: type,
          noSiteFilter: true,
        });
        parsed =
          type === 'ssq'
            ? this.search.parseSsqDraw(searchResp, issue)
            : this.search.parseDltDraw(searchResp, issue);
      } catch (err) {
        this.logger.warn(`重搜失败: ${(err as Error).message}`);
      }
    }

    if (!parsed) {
      this.logger.warn(`${rule.name} 第 ${issue} 期开奖解析失败，保留原始响应待排查`);
      return { synced: false, period: issue, message: 'parse_failed' };
    }

    const drawDate = this.extractDrawDate(searchResp) ?? opts.drawDateFallback ?? null;

    // 幂等 upsert（唯一索引 lotteryType+period）
    const draw = await this.prisma.drawResult.upsert({
      where: { lotteryType_period: { lotteryType: type, period: issue } },
      create: {
        lotteryType: type,
        period: issue,
        drawDate,
        redBalls: parsed.redBalls,
        blueBalls: parsed.blueBalls,
        prizePoolCent: parsed.prizePoolCent ?? null,
        sourceName: parsed.sourceName,
        sourceUrl: parsed.sourceUrl,
        sourceRaw: { raw: parsed.sourceRaw },
        syncedAt: new Date(),
      },
      update: {
        redBalls: parsed.redBalls,
        blueBalls: parsed.blueBalls,
        ...(parsed.prizePoolCent ? { prizePoolCent: parsed.prizePoolCent } : {}),
        syncedAt: new Date(),
      },
    });

    // 触发兑奖预计算
    await this.redeem.computeForDraw(type, draw.period);

    // 仅最新一期同步后推进当前期号（历史补差不改"待开奖"语义）
    if (opts.updateStatus) {
      // 下一期 = 被同步期开奖日的次日之后第一个开奖日（今晚若有期则正确指向今晚，不会被跳过）
      const base = opts.drawDateFallback ?? new Date();
      const dayAfter = new Date(base);
      dayAfter.setDate(dayAfter.getDate() + 1);
      const nextDraw = nextDrawDate(dayAfter, type);
      const nextIssue = issueOfDate(type, nextDraw);
      // 奖池联动：公告的"下期奖池"即当前待开期奖池 → fmtPool 后写入 status
      const poolAmount = parsed.prizePoolCent ? fmtPool(parsed.prizePoolCent) : undefined;
      await this.prisma.lotteryStatus.upsert({
        where: { lotteryType: type },
        create: {
          lotteryType: type,
          currentIssue: nextIssue,
          periodText: `第 ${nextIssue} 期`,
          drawDate: nextDraw,
          ...(poolAmount ? { prizePoolAmount: poolAmount } : {}),
          winningNumbers: [...parsed.redBalls, ...parsed.blueBalls],
        },
        update: {
          currentIssue: nextIssue,
          periodText: `第 ${nextIssue} 期`,
          drawDate: nextDraw,
          ...(poolAmount ? { prizePoolAmount: poolAmount } : {}),
          winningNumbers: [...parsed.redBalls, ...parsed.blueBalls],
        },
      });
    } else {
      // 冷启动兜底：手动补差（updateStatus=false）后确保 lottery_status 可用——
      // 系统刚上线无 seed、定时任务未跑时，首页的当前期/奖池/最新号码也要能展示
      await this.ensureStatusFresh(type);
    }

    this.logger.log(`${rule.name} 第 ${issue} 期同步完成: 红${parsed.redBalls.join(',')} 蓝${parsed.blueBalls.join(',')}`);
    return { synced: true, period: issue };
  }

  /**
   * 冷启动兜底：保证 lottery_status 该彩种行存在且奖池新鲜。
   * - 不存在（无 seed/定时任务未跑）→ 用 draw_results 最新一期初始化：
   *   当前期 = 今天视角的下一开奖日（今晚若有期则指今晚），号码 = 最新一期，奖池 = 最新一期公告的"下期奖池"
   * - 已存在 → 仅用最新一期的奖池刷新 prizePoolAmount（不推进期号，不覆盖号码）
   */
  private async ensureStatusFresh(type: LotteryType): Promise<void> {
    const latest = await this.prisma.drawResult.findFirst({
      where: { lotteryType: type },
      orderBy: { period: 'desc' },
    });
    if (!latest) return; // 一条开奖都没有，无从初始化

    const poolAmount = latest.prizePoolCent ? fmtPool(Number(latest.prizePoolCent)) : undefined;
    const existing = await this.prisma.lotteryStatus.findUnique({ where: { lotteryType: type } });

    if (!existing) {
      const nextDraw = nextDrawDate(new Date(), type); // 含今日：今晚若有期则指向今晚
      const nextIssue = issueOfDate(type, nextDraw);
      await this.prisma.lotteryStatus.create({
        data: {
          lotteryType: type,
          currentIssue: nextIssue,
          periodText: `第 ${nextIssue} 期`,
          drawDate: nextDraw,
          ...(poolAmount ? { prizePoolAmount: poolAmount } : {}),
          winningNumbers: [...(latest.redBalls as string[]), ...(latest.blueBalls as string[])],
        },
      });
      this.logger.log(`${LOTTERY_RULES[type].name} lottery_status 冷启动初始化：当前期 ${nextIssue}`);
      return;
    }

    if (poolAmount) {
      await this.prisma.lotteryStatus.update({
        where: { lotteryType: type },
        data: { prizePoolAmount: poolAmount },
      });
    }
  }

  /** 状态刷新：检查是否有已开奖但期号未推进的情况 */
  async refreshStatus(): Promise<void> {
    for (const type of ['ssq', 'dlt'] as LotteryType[]) {
      const status = await this.prisma.lotteryStatus.findUnique({ where: { lotteryType: type } });
      if (!status?.currentIssue) continue;
      const drawn = await this.prisma.drawResult.findUnique({
        where: { lotteryType_period: { lotteryType: type, period: status.currentIssue } },
      });
      // 当前期已开奖 → 推进到下一期（从次日起算，期号由开奖日推算）
      if (drawn) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextDraw = nextDrawDate(tomorrow, type);
        const nextIssue = issueOfDate(type, nextDraw);
        await this.prisma.lotteryStatus.update({
          where: { lotteryType: type },
          data: {
            currentIssue: nextIssue,
            periodText: `第 ${nextIssue} 期`,
            drawDate: nextDraw,
            winningNumbers: [...(drawn.redBalls as string[]), ...(drawn.blueBalls as string[])],
          },
        });
        this.logger.log(`${LOTTERY_RULES[type].name} 期号推进至 ${nextIssue}`);
      }
    }
  }

  /** 从某日起往前找最近一个"已开奖"的该彩种开奖日（不含今日，UTC 零点）。
   *  开奖在晚上，今天开奖日晚 21:15 前视为未开——定时同步只查前一日及之前。 */
  private previousDrawDate(type: LotteryType, from: Date): Date {
    const d = new Date(from);
    for (let i = 1; i <= 7; i++) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      if (isDrawDayOfType(day, type)) {
        return utcDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
      }
    }
    return utcDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  private extractDrawDate(resp: unknown): Date | null {
    try {
      // 新结构 Result.WebResults[].PublishDate；兼容旧 data.search_results[].publish_date
      const root = resp as {
        Result?: { WebResults?: Array<{ PublishDate?: string }> };
        data?: { search_results?: Array<{ publish_date?: string }> };
      };
      const items = (root?.Result?.WebResults ?? []) as Array<{ PublishDate?: string }>;
      const legacy = (root?.data?.search_results ?? []) as Array<{ publish_date?: string }>;
      const first = items.find((i) => i.PublishDate) ?? legacy.find((i) => i.publish_date);
      const pd =
        (first as { PublishDate?: string } | undefined)?.PublishDate ??
        (first as { publish_date?: string } | undefined)?.publish_date;
      if (pd) return new Date(pd);
    } catch {
      /* ignore */
    }
    return null;
  }
}
