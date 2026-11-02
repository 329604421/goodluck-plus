import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { VisionService, OcrResult } from '../../integrations/volcengine/vision.service';
import { ApiException } from '../../common/api-exception';
import { fmtDate, fmtMoney, parseDate } from '../../common/format';
import { utcDate } from '../../common/date-utc';
import {
  LOTTERY_RULES,
  TICKET_STATUS_CN,
  LotteryType,
  nextDrawDate,
  validateBalls,
} from '../lottery/lottery-rules';
import { SaveTicketDto } from './ticket.dto';
import { RedeemService } from '../redeem/redeem.service';
import { DrawSyncService } from '../lottery/draw-sync.service';
import { utcToday } from '../../common/date-utc';
import { normalizeIssue } from '../../common/issue';

/**
 * 票据服务（文档 §8.3.4/8.3.5/8.3.6、§9.2/9.3）
 */
@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vision: VisionService,
    private readonly config: ConfigService,
    private readonly redeem: RedeemService,
    private readonly drawSync: DrawSyncService,
  ) {}

  /** POST /api/ticket/ocr：图片 base64 直传多模态模型，不落盘 */
  async recognizeTicket(imageBytes: Buffer): Promise<OcrResult> {
    // ⚠️ 兼容解码（2026-08-25 OCR 事故修复）：眼镜端（AIUI）无 FormData/Blob，
    //    手写 multipart 上传时 file 字段为 **base64 文本**；若不解码，
    //    vision 层 toString('base64') 会双重编码 → 火山收到文本 → "image format is not supported"。
    //    启发式检测：JPEG/PNG 二进制转 utf8 必然含非 base64 字符（乱码/替换符），
    //    纯 base64 字符集 + 长度 4 的倍数 → 判为 base64 文本并解码（对二进制直传无副作用）。
    const rawText = imageBytes.toString('utf8').trim();
    if (
      rawText.length > 64 &&
      rawText.length % 4 === 0 &&
      /^[A-Za-z0-9+/=]+$/.test(rawText)
    ) {
      const decoded = Buffer.from(rawText, 'base64');
      if (decoded.length > 0) {
        this.logger.log(
          `[OCR] file 为 base64 文本(${imageBytes.length} 字符) → 解码为二进制(${decoded.length} 字节)`,
        );
        imageBytes = decoded;
      }
    }
    // 请求日志：确认前端请求是否真正到达后端（排查联调断点）
    this.logger.log(`[OCR] 请求到达, 图片 ${imageBytes.length} 字节`);
    const maxBytes = this.config.get<number>('ocrImageMaxBytes') ?? 2097152;
    if (imageBytes.length > maxBytes) {
      throw new ApiException(40001, `图片超过 ${Math.round(maxBytes / 1024)}KB 上限，请压缩后重试`);
    }
    try {
      const result = await this.vision.recognizeTicketImage(imageBytes);
      // 服务端二次校验（文档 §6.2.5）
      const type = this.guessLotteryType(result.lotteryName);
      for (const bet of result.bets ?? []) {
        validateBalls(type, bet.red, bet.blue);
      }
      this.logger.log(`[OCR] 识别成功: ${result.lotteryName} ${result.period} ${(result.bets ?? []).length} 注`);
      return result;
    } catch (err) {
      if (err instanceof ApiException) throw err;
      this.logger.warn(`[OCR] 识别失败: ${(err as Error).message}`);
      throw new ApiException(40010, 'OCR 识别失败，请手动校对号码');
    }
  }

  /** POST /api/ticket：保存票据（事务写 Ticket + TicketBet），返回 id */
  async saveTicket(userId: bigint, dto: SaveTicketDto) {
    const type = this.normalizeType(dto.lotteryType);
    const rule = LOTTERY_RULES[type];
    // 2026-08-25 修复：期号归一化为 7 位存储（OCR 可能识别为 5 位"26096"，
    // 若不归一化，兑奖计算/开奖比对/号码展示全部匹配不上开奖记录）
    const period = normalizeIssue(dto.period);

    // 逐注规则校验
    const bets = dto.bets.map((b, i) => {
      const { red, blue } = validateBalls(type, b.red, b.blue);
      return { betIndex: i + 1, redBalls: red, blueBalls: blue, mult: Math.max(1, b.mult | 0) };
    });

    // 金额重算校验（每注 ¥2 × 倍数）
    const calcTotal = bets.reduce((sum, b) => sum + b.mult * rule.priceCent, 0);
    if (dto.totalAmount !== calcTotal) {
      throw new ApiException(40001, `金额校验失败：应为 ${calcTotal} 分`);
    }

    // 开奖日期：优先票面 OCR 识别值（彩票上印的正确开奖日，勿用录入时间推算）；
    // 缺省时：匹配已落库开奖结果，否则取下一个该彩种开奖日（预计开奖日）
    const drawDate = dto.drawDate
      ? this.parseDrawDate(dto.drawDate)
      : await this.resolveDrawDate(type, period);

    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          userId,
          lotteryType: type,
          lotteryName: rule.name,
          period,
          drawDate,
          betCount: bets.length,
          multiplier: dto.multiplier,
          totalAmountCent: calcTotal,
          status: 'pending',
          source: 'ocr',
        },
      });
      await tx.ticketBet.createMany({
        data: bets.map((b) => ({ ...b, ticketId: t.id })),
      });
      return t;
    });

    // 录入后触发：已开奖 → 比对兑奖；开奖日已过未同步 → 补同步再比对
    // 同步等待（保存响应稍慢 1-3s）：保证用户保存后立即看到已开奖/未中奖/中奖状态
    await this.afterSaveDrawCheck(type, period, drawDate);

    // 返回比对后的最新状态（可能已从 pending → drawn / not_win）
    const latest = await this.prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true },
    });
    return { id: ticket.id.toString(), status: latest?.status ?? ticket.status };
  }

  /**
   * 录入后触发动作（需求 2026-08-20）：
   * 1. 对比该期是否已开奖 → 已开奖则执行兑奖比对（computeForDraw 幂等，按状态流转防重）
   * 2. 若票面开奖日 < 今天 且 draw_results 尚无该期 → 先按开奖日补同步（syncDrawByDate 幂等），再比对
   * 3. 未开奖/未来期 → 保持 pending，等定时任务开奖后自然比对
   * 任何一步失败都不影响票据落库（记录日志即可，定时任务会兜底）。
   */
  private async afterSaveDrawCheck(type: LotteryType, period: string, drawDate: Date): Promise<void> {
    try {
      // 2026-08-25：期号归一化匹配（存量 5 位票/新票统一 7 位均能命中）
      const norm = normalizeIssue(period);
      const draw = await this.prisma.drawResult.findFirst({
        where: { lotteryType: type, period: { in: [period, norm] } },
      });
      if (draw) {
        // 2026-10-07 事故防线：期号匹配上 ≠ 这张票已经开奖。
        // 期号错位（休市导致期号领先、或开奖记录本身有误）时，票面开奖日会晚于
        // 开奖记录的开奖日；此时必须挂起，否则今晚才开奖的票会被旧记录提前判奖。
        if (draw.drawDate && drawDate.getTime() > draw.drawDate.getTime()) {
          this.logger.warn(
            `录入票 ${type} ${period} 票面开奖日 ${fmtDate(drawDate)} 晚于开奖记录开奖日 ` +
              `${fmtDate(draw.drawDate)}（疑似期号错位/记录有误），保持待开奖`,
          );
          return;
        }
        // 已落库开奖结果 → 直接比对
        await this.redeem.computeForDraw(type, period);
        return;
      }
      // 无开奖结果：票面开奖日已过（今天之前）→ 先补同步再比对
      const today = utcToday();
      if (drawDate.getTime() < today.getTime()) {
        this.logger.log(`录入票 ${type} ${period} 开奖日 ${drawDate.toISOString().slice(0, 10)} 已过，先补同步`);
        await this.drawSync.syncDrawByDate(type, drawDate.toISOString().slice(0, 10));
        await this.redeem.computeForDraw(type, period);
      } else {
        this.logger.log(`录入票 ${type} ${period} 开奖日未到，保持待开奖`);
      }
    } catch (err) {
      // 同步失败/比对失败：不影响保存，定时任务兜底
      this.logger.warn(`录入后开奖比对失败（不影响保存）: ${(err as Error).message}`);
    }
  }

  /** GET /api/ticket：列表态（bets 红蓝用空格分隔字符串、mult 用 "*N"，对齐 mock.tickets） */
  async listTickets(userId: bigint) {
    const tickets = await this.prisma.ticket.findMany({
      where: { userId },
      orderBy: [{ drawDate: 'desc' }, { id: 'desc' }],
      include: { bets: { orderBy: { betIndex: 'asc' } } },
    });

    // 一次性取所有票据所属期的真实开奖号码（供前端逐球比对高亮，2026-08-20 新增）
    // 用彩票期号精确匹配 draw_results，不依赖 heatmap 的 12 周窗口（历史票也能高亮）
    // 2026-08-25：期号归一化（票据可能 5 位、draw_results 为 7 位，统一键匹配）
    const periods = [...new Set(tickets.map((t) => `${t.lotteryType}:${normalizeIssue(t.period)}`))];
    const draws = await this.prisma.drawResult.findMany({
      where: { OR: periods.map((p) => {
        const [lotteryType, period] = p.split(':');
        return { lotteryType, period };
      }) },
      select: { lotteryType: true, period: true, redBalls: true, blueBalls: true },
    });
    const drawByKey = new Map(draws.map((d) => [`${d.lotteryType}:${normalizeIssue(d.period)}`, d]));

    return {
      list: tickets.map((t) => {
        const draw = drawByKey.get(`${t.lotteryType}:${normalizeIssue(t.period)}`);
        // 2026-08-24 修复：待开奖（pending）的票据绝不返回开奖号码——
        // 此前仅按期号匹配 draw_results，若库里恰好有该期记录会误带号码，
        // 前端明细卡因此显示"未开奖却有开奖信息"的假数据。
        const isDrawn = t.status !== 'pending';
        return {
          id: t.id.toString(), // 供 DELETE /api/ticket/:id 使用（前端联调用）
          period: `第 ${t.period} 期`,
          lottery: t.lotteryType,
          lotteryName: t.lotteryName ?? LOTTERY_RULES[t.lotteryType as LotteryType]?.name,
          status: TICKET_STATUS_CN[t.status] ?? t.status,
          drawDate: fmtDate(t.drawDate),
          betAmount: fmtMoney(t.totalAmountCent),
          winAmount: t.winAmountCent > 0 ? fmtMoney(t.winAmountCent) : '',
          // 该期真实开奖号码（待开奖票为空数组，前端判 hasDraw 不高亮、不展示）
          winningRed: isDrawn ? ((draw?.redBalls as string[]) || []).map((x) => String(x).padStart(2, '0')) : [],
          winningBlue: isDrawn ? ((draw?.blueBalls as string[]) || []).map((x) => String(x).padStart(2, '0')) : [],
          bets: t.bets.map((b) => ({
            id: b.betIndex,
            red: (b.redBalls as string[]).join(' '),
            blue: (b.blueBalls as string[]).join(' '),
            mult: `*${b.mult}`,
            // 后端已算好的命中数量（redeem 落库），前端可用作展示/校验
            matchedRed: b.matchedRed,
            matchedBlue: b.matchedBlue,
          })),
        };
      }),
    };
  }

  /** DELETE /api/ticket/:id：级联删除票据 + 注 + 兑奖记录 */
  async deleteTicket(userId: bigint, ticketId: bigint) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.userId !== userId) {
      throw new ApiException(40001, '票据不存在');
    }
    await this.prisma.$transaction([
      this.prisma.redeemRecord.deleteMany({ where: { ticketId } }),
      this.prisma.ticketBet.deleteMany({ where: { ticketId } }),
      this.prisma.ticket.delete({ where: { id: ticketId } }),
    ]);
    return null;
  }

  // ---------- 内部方法 ----------

  private normalizeType(v: string): LotteryType {
    if (v === 'ssq' || v === 'dlt') return v;
    throw new ApiException(40001, 'lotteryType 仅支持 ssq/dlt');
  }

  private guessLotteryType(name?: string): LotteryType {
    return name === '大乐透' ? 'dlt' : 'ssq';
  }

  private async resolveDrawDate(type: LotteryType, period: string): Promise<Date> {
    const draw = await this.prisma.drawResult.findUnique({
      where: { lotteryType_period: { lotteryType: type, period } },
    });
    if (draw?.drawDate) return draw.drawDate;
    // 预计开奖日：下一个该彩种开奖日
    return nextDrawDate(new Date(), type);
  }

  /** 解析票面开奖日期（YYYY-MM-DD）为 UTC 日期键，避免时区偏移 */
  private parseDrawDate(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) {
      throw new ApiException(40001, `开奖日期格式错误：${s}`);
    }
    return utcDate(y, m, d);
  }
}
