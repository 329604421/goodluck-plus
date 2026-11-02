/**
 * 种子数据（本地联调）：用户「春生」+ 开奖结果 + 5 张各状态票据 + 待兑奖记录 + 彩种状态。
 * 幂等：重复执行 upsert。
 * 注意：日期一律用 UTC 零点（Prisma DATE 列按 UTC 日期存取，见 src/common/date-utc.ts）
 * 用法：npm run seed
 */
import { PrismaClient } from '@prisma/client';
import { issueOfDate } from '../src/modules/lottery/lottery-rules';

const prisma = new PrismaClient();

/** UTC 零点日期 */
function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}
function dateOnly(offsetDays: number): Date {
  const now = new Date();
  const u = utcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
  u.setUTCDate(u.getUTCDate() + offsetDays);
  return u;
}

function latestDrawDate(type: 'ssq' | 'dlt', back = 0): Date {
  // 最近第 back 个已开奖日（不含今日——今天开奖日晚 21:15 前视为未开）
  const days: Record<string, number[]> = {
    ssq: [0, 2, 4], // 日 二 四
    dlt: [1, 3, 6], // 一 三 六
  };
  const now = new Date();
  let found = 0;
  for (let i = 1; i <= 7 * (back + 1) + 1; i++) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    if (days[type].includes(day.getDay())) {
      if (found === back) return utcDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
      found++;
    }
  }
  return dateOnly(0);
}

/** 未来最近开奖日（含今日，UTC 零点）——白天指"今晚待开的那期"；draw_results 只存已开期，不冲突 */
function nextDrawDay(type: 'ssq' | 'dlt'): Date {
  const days: Record<string, number[]> = { ssq: [0, 2, 4], dlt: [1, 3, 6] };
  const d = new Date();
  for (let i = 0; i <= 7; i++) {
    const day = new Date(d);
    day.setDate(d.getDate() + i);
    if (days[type].includes(day.getDay())) {
      return utcDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
    }
  }
  return dateOnly(0);
}

async function main() {
  console.log('🌱 开始灌入种子数据...');

  // 1. 用户 + 配置 + 固定 deviceToken（个人产品单用户）
  const user = await prisma.user.upsert({
    where: { id: 1n },
    create: {},
    update: {},
  });
  const token = process.env.SEED_DEVICE_TOKEN || 'dev-token-local-only';
  await prisma.deviceToken.upsert({
    where: { deviceToken: token },
    create: { userId: user.id, deviceToken: token, clientType: 'wechat_mp' },
    update: {},
  });
  await prisma.userConfig.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      name: '春生',
      gender: 'male',
      birth: new Date('2000-01-15'),
      lotteryType: 'ssq',
      divinationSystem: 'astrology',
    },
    update: {},
  });
  console.log(`✅ 用户 #${user.id}（春生）token: ${token}`);

  // 2. 开奖结果：官方真实期号与号码（期号由 issueOfDate 锚点推算，与官方公告一致）
  // 来源：福彩官网 cwl.gov.cn / 体彩官方公告（2026-08-19 多源核实）
  const ssqDraws = [
    // 2026095 期 08-18：官方开奖号尚未收录，用演示号码（期号/日期真实）
    { red: ['03', '08', '15', '21', '27', '30'], blue: ['09'], offset: 0 },
    // 2026094 期 08-16：官方号码 06 13 15 17 24 25 + 01
    { red: ['06', '13', '15', '17', '24', '25'], blue: ['01'], offset: 1 },
    // 2026093 期 08-13：官方号码 05 08 15 20 21 24 + 09
    { red: ['05', '08', '15', '20', '21', '24'], blue: ['09'], offset: 2 },
  ];
  for (const d of ssqDraws) {
    const drawDate = latestDrawDate('ssq', d.offset);
    const period = issueOfDate('ssq', drawDate);
    await prisma.drawResult.upsert({
      where: { lotteryType_period: { lotteryType: 'ssq', period } },
      create: {
        lotteryType: 'ssq',
        period,
        drawDate,
        redBalls: d.red,
        blueBalls: d.blue,
        prizePoolCent: 201000000000n,
        sourceName: 'seed',
        syncedAt: new Date(),
      },
      update: {},
    });
  }
  const dltDraws = [
    // 2026093 期 08-17：官方号码 08 10 22 26 29 + 03 10（体彩官方公告）
    { red: ['08', '10', '22', '26', '29'], blue: ['03', '10'], offset: 0 },
    // 2026092 期 08-15：演示号码（期号/日期真实）
    { red: ['02', '09', '14', '18', '26'], blue: ['05', '12'], offset: 1 },
  ];
  for (const d of dltDraws) {
    const drawDate = latestDrawDate('dlt', d.offset);
    const period = issueOfDate('dlt', drawDate);
    await prisma.drawResult.upsert({
      where: { lotteryType_period: { lotteryType: 'dlt', period } },
      create: {
        lotteryType: 'dlt',
        period,
        drawDate,
        redBalls: d.red,
        blueBalls: d.blue,
        prizePoolCent: 253000000000n,
        sourceName: 'seed',
        syncedAt: new Date(),
      },
      update: {},
    });
  }
  console.log('✅ 开奖结果 ssq×3 + dlt×2（期号按开奖日推算）');

  // 3. 彩种状态：当前期 = 下一个开奖日推算出的期号，drawDate = 下一个开奖日
  await prisma.lotteryStatus.upsert({
    where: { lotteryType: 'ssq' },
    create: {
      lotteryType: 'ssq',
      currentIssue: issueOfDate('ssq', nextDrawDay('ssq')),
      periodText: `第 ${issueOfDate('ssq', nextDrawDay('ssq'))} 期`,
      drawDate: nextDrawDay('ssq'),
      prizePoolAmount: '¥20.1 亿',
      winningNumbers: [...ssqDraws[0].red, ...ssqDraws[0].blue],
    },
    update: {},
  });
  await prisma.lotteryStatus.upsert({
    where: { lotteryType: 'dlt' },
    create: {
      lotteryType: 'dlt',
      currentIssue: issueOfDate('dlt', nextDrawDay('dlt')),
      periodText: `第 ${issueOfDate('dlt', nextDrawDay('dlt'))} 期`,
      drawDate: nextDrawDay('dlt'),
      prizePoolAmount: '¥25.3 亿',
      winningNumbers: [...dltDraws[0].red, ...dltDraws[0].blue],
    },
    update: {},
  });
  console.log('✅ 彩种状态 ssq/dlt（期号按下一开奖日推算）');

  // 4. 票据：5 张覆盖 4 种状态（期号一律由 drawDate 推算，与 draw_results 严格对应）
  const tickets = [
    {
      // 待开奖（dlt，下一开奖日）
      lotteryType: 'dlt',
      dateKind: 'next',
      status: 'pending',
      bets: [
        { red: ['01', '07', '16', '24', '28'], blue: ['03', '11'], mult: 2 },
        { red: ['05', '12', '19', '23', '30'], blue: ['07', '09'], mult: 1 },
      ],
    },
    {
      // 已兑奖（ssq，中 ¥3,000 五等奖？改四等奖 6+1 是一等奖——用 4+1=¥200；设定中 3000 需 5+1 三等奖）
      lotteryType: 'ssq',
      dateKind: 'latest',
      offset: 0,
      status: 'redeemed',
      win: 300000, // ¥3,000
      prizeLevel: '三等奖',
      bets: [{ red: ['03', '08', '15', '21', '27', '30'], blue: ['09'], mult: 1, matched: [5, 1] }],
    },
    {
      // 待兑奖（dlt，中 ¥240）
      lotteryType: 'dlt',
      dateKind: 'latest',
      offset: 0,
      status: 'drawn',
      win: 24000, // ¥240
      prizeLevel: '五等奖',
      bets: [
        { red: ['01', '07', '16', '24', '28'], blue: ['03', '11'], mult: 1, matched: [4, 1] },
      ],
    },
    {
      // 未中奖（ssq）
      lotteryType: 'ssq',
      dateKind: 'latest',
      offset: 1,
      status: 'not_win',
      bets: [
        { red: ['06', '12', '19', '22', '25', '31'], blue: ['04'], mult: 1 },
        { red: ['01', '07', '16', '24', '28', '32'], blue: ['15'], mult: 1 },
      ],
    },
    {
      // 未中奖（dlt，更早）
      lotteryType: 'dlt',
      dateKind: 'latest',
      offset: 1,
      status: 'not_win',
      bets: [{ red: ['10', '13', '20', '26', '33'], blue: ['02', '08'], mult: 1 }],
    },
  ];

  for (const t of tickets) {
    const drawDate =
      t.dateKind === 'next'
        ? nextDrawDay(t.lotteryType as 'ssq' | 'dlt')
        : latestDrawDate(t.lotteryType as 'ssq' | 'dlt', t.offset ?? 0);
    const period = issueOfDate(t.lotteryType as 'ssq' | 'dlt', drawDate);
    const total = t.bets.reduce((s, b) => s + b.mult * 200, 0);
    const existing = await prisma.ticket.findFirst({
      where: { userId: user.id, lotteryType: t.lotteryType, period },
    });
    if (existing) continue;

    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        lotteryType: t.lotteryType,
        lotteryName: t.lotteryType === 'ssq' ? '双色球' : '大乐透',
        period,
        drawDate,
        betCount: t.bets.length,
        multiplier: t.bets[0].mult,
        totalAmountCent: total,
        status: t.status,
        winAmountCent: t.win ?? 0,
        prizeLevel: t.prizeLevel ?? null,
        source: 'ocr',
        ocrStatus: 'OCR 已识别',
      },
    });
    for (let i = 0; i < t.bets.length; i++) {
      const b = t.bets[i];
      await prisma.ticketBet.create({
        data: {
          ticketId: ticket.id,
          betIndex: i + 1,
          redBalls: b.red,
          blueBalls: b.blue,
          mult: b.mult,
          matchedRed: b.matched?.[0] ?? 0,
          matchedBlue: b.matched?.[1] ?? 0,
          isWin: t.win ? 1 : 0,
          prizeLevel: t.win ? (t.prizeLevel ?? null) : null,
        },
      });
    }

    // 待兑奖票据生成 RedeemRecord
    if (t.status === 'drawn') {
      const deadline = new Date(drawDate);
      deadline.setDate(deadline.getDate() + 60);
      await prisma.redeemRecord.create({
        data: {
          ticketId: ticket.id,
          userId: user.id,
          lotteryType: t.lotteryType,
          period,
          status: 'pending',
          amountCent: t.win ?? 0,
          prizeLevel: t.prizeLevel ?? null,
          deadlineDate: deadline,
          redeemChannel: (t.win ?? 0) >= 1000000 ? 'center' : 'shop',
        },
      });
    }
  }
  console.log('✅ 票据 5 张（待开奖/已兑奖/待兑奖/未中奖×2）');

  console.log('🎉 种子数据完成！');
  console.log(`👉 小程序联调 token: ${token}`);
  console.log('   （register 会自动复用该用户，无需手动配置）');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
