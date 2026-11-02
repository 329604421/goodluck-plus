import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedeemRecord } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { fmtDate } from '../../common/format';
import { addDaysUtc, utcToday } from '../../common/date-utc';
import { normalizeIssue } from '../../common/issue';
import { calcPrize, PoolTier, DLT_POOL_THRESHOLD_CENT } from './prize-rules';
import { LOTTERY_RULES, LotteryType } from '../lottery/lottery-rules';

/**
 * 兑奖引擎（文档 §9.5）：
 * - computeForDraw：开奖落库后对 pending 票据逐注比对命中 → 更新状态与兑奖记录
 * - 兑奖渠道：单注 ¥1 万以下 shop / 及以上 center；截止日 = 开奖日 + 60 天
 * - daysLeft 查询时实时计算
 */
@Injectable()
export class RedeemService {
  private readonly logger = new Logger(RedeemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 对某期已开奖、状态仍为 pending 的票据执行兑奖计算（幂等：状态流转天然防重） */
  async computeForDraw(type: LotteryType, period: string): Promise<void> {
    // 2026-08-25 修复：票据期号可能是 5 位（"26096"），draw_results 为 7 位（"2026096"），
    // 原精确匹配查不到开奖记录导致兑奖永远不计算（线上事故：大乐透票一直"待开奖"）。
    const norm = normalizeIssue(period);
    const draw = await this.prisma.drawResult.findFirst({
      where: { lotteryType: type, period: { in: [period, norm] } },
    });
    if (!draw) return;

    const drawRed = draw.redBalls as string[];
    const drawBlue = draw.blueBalls as string[];
    const deadlineDays = this.config.get<number>('redeemDeadlineDays') ?? 60;
    const shopThreshold = this.config.get<number>('redeemShopThresholdCent') ?? 1000000;

    // 大乐透固定奖浮动档位（2026-02 新规则）：摇奖前奖池 = 上一期开奖后滚存奖池，
    // ≥8 亿 → 'high' 档（七等 ¥7 等），否则 'base' 档（七等 ¥5）。双色球忽略。
    let poolTier: PoolTier = 'base';
    if (type === 'dlt' && draw.drawDate) {
      const prev = await this.prisma.$queryRawUnsafe(
        `SELECT prize_pool_cent FROM draw_results
         WHERE lottery_type = ? AND draw_date < ? AND prize_pool_cent IS NOT NULL
         ORDER BY draw_date DESC LIMIT 1`,
        type,
        draw.drawDate,
      ) as { prize_pool_cent: bigint | number | string }[];
      const prevPool = prev.length ? Number(prev[0].prize_pool_cent) : 0;
      poolTier = prevPool >= DLT_POOL_THRESHOLD_CENT ? 'high' : 'base';
    }

    const tickets = await this.prisma.ticket.findMany({
      // 2026-08-25：期号归一化匹配（存量 5 位票 26096 / 7 位票 2026096 均命中）
      where: { lotteryType: type, status: 'pending', period: { in: [period, norm] } },
      include: { bets: true },
    });

    for (const ticket of tickets) {
      // 2026-10-07 事故防线（第二道，覆盖定时任务 computeAllPending 兜底路径）：
      // 票面开奖日晚于该期开奖记录的开奖日 → 二者并非同一期（期号错位/记录有误），
      // 挂起不结算，避免"今晚才开奖的票被旧记录判成未中奖"。
      if (ticket.drawDate && draw.drawDate && ticket.drawDate.getTime() > draw.drawDate.getTime()) {
        this.logger.warn(
          `票据 #${ticket.id}（${type} ${period}）票面开奖日 ${fmtDate(ticket.drawDate)} ` +
            `晚于开奖记录开奖日 ${fmtDate(draw.drawDate)}，跳过结算`,
        );
        continue;
      }
      let totalWin = 0;
      let bestLevel: string | null = null;

      const betUpdates = ticket.bets.map(async (bet) => {
        const red = bet.redBalls as string[];
        const blue = bet.blueBalls as string[];
        const matchedRed = red.filter((b) => drawRed.includes(b)).length;
        const matchedBlue = blue.filter((b) => drawBlue.includes(b)).length;
        const prize = calcPrize(type, matchedRed, matchedBlue, poolTier);

        const amountCent = prize ? prize.amountCent * bet.mult : 0;
        if (prize) {
          totalWin += amountCent;
          bestLevel = prize.level;
        }
        await this.prisma.ticketBet.update({
          where: { id: bet.id },
          data: {
            matchedRed,
            matchedBlue,
            isWin: prize ? 1 : 0,
            prizeLevel: prize?.level ?? null,
          },
        });
      });
      await Promise.all(betUpdates);

      if (totalWin > 0 || bestLevel) {
        // 中奖（含浮动奖金一/二等奖，金额记 0）→ 待兑奖
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: 'drawn', winAmountCent: totalWin, prizeLevel: bestLevel },
        });
        // 渠道判定：浮动奖金（一/二等奖）必然 ≥1 万 → center
        const maxPerBet = totalWin; // 固定奖下 totalWin = Σ(单注×倍)，倍投可能超阈值，按总额判定
        await this.prisma.redeemRecord.upsert({
          where: { ticketId: ticket.id },
          create: {
            ticketId: ticket.id,
            userId: ticket.userId,
            lotteryType: type,
            period,
            status: 'pending',
            amountCent: totalWin,
            prizeLevel: bestLevel,
            deadlineDate: draw.drawDate ? addDaysUtc(draw.drawDate, deadlineDays) : addDaysUtc(new Date(), deadlineDays),
            redeemChannel: totalWin >= shopThreshold ? 'center' : 'shop',
          },
          update: {},
        });
        this.logger.log(`票据 #${ticket.id} 中奖 ${bestLevel}，金额 ${totalWin} 分`);
      } else {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { status: 'not_win' },
        });
      }
    }
  }

  /** 全量兜底：对所有 pending 且已开奖的票据重算（定时任务用） */
  async computeAllPending(): Promise<void> {
    const pendings = await this.prisma.ticket.findMany({
      where: { status: 'pending' },
      select: { lotteryType: true, period: true },
      distinct: ['lotteryType', 'period'],
    });
    for (const p of pendings) {
      await this.computeForDraw(p.lotteryType as LotteryType, p.period);
    }
  }

  /** GET /api/redeem/pending：待兑奖列表（daysLeft 实时算） */
  async getPendingList(userId: bigint) {
    const records = await this.prisma.redeemRecord.findMany({
      where: { userId, status: 'pending' },
      orderBy: { deadlineDate: 'asc' },
    });

    const todayUtc = utcToday().getTime();
    return {
      list: records.map((r) => ({
        id: r.id.toString(),
        lottery: r.lotteryType,
        lotteryName: LOTTERY_RULES[r.lotteryType as LotteryType]?.name ?? '',
        period: `第 ${r.period} 期`,
        amount: r.amountCent,
        deadlineDate: fmtDate(r.deadlineDate),
        redeemChannel: r.redeemChannel ?? 'shop',
        daysLeft: r.deadlineDate
          ? Math.max(0, Math.ceil((r.deadlineDate.getTime() - todayUtc) / 86400000))
          : 0,
      })),
    };
  }

  /** POST /api/redeem/confirm：待兑奖 → 已兑奖（联动 Ticket 状态）
   *  支持传 id（RedeemRecord.id，首页 heroCard）或 ticketId（台账抽屉） */
  async confirm(userId: bigint, dto: { id?: string; ticketId?: string }) {
    let record: RedeemRecord | null = null;

    if (dto.id) {
      try {
        record = await this.prisma.redeemRecord.findUnique({ where: { id: BigInt(dto.id) } });
      } catch {
        record = null;
      }
    }
    if (!record && dto.ticketId) {
      record = await this.prisma.redeemRecord.findUnique({
        where: { ticketId: BigInt(dto.ticketId) },
      });
    }
    if (!record || record.userId !== userId) {
      throw new ApiException(40001, '兑奖记录不存在');
    }
    if (record.status !== 'pending') {
      return { status: 'redeemed' };
    }
    await this.prisma.$transaction([
      this.prisma.redeemRecord.update({
        where: { id: record.id },
        data: { status: 'redeemed' },
      }),
      this.prisma.ticket.update({
        where: { id: record.ticketId },
        data: { status: 'redeemed' },
      }),
    ]);
    return { status: 'redeemed' };
  }
}
