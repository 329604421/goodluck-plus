/**
 * 本地联调 mock 数据（无火山引擎 Key 时的兜底），对齐前端 utils/mock.js
 */

export const LOCAL_OCR_MOCK = {
  lotteryName: '双色球',
  period: '第 2026101 期',
  drawDate: '2026-08-20',
  ocrStatus: 'OCR 已识别（本地 Mock）',
  betCount: 2,
  multiplier: 1,
  totalAmount: '¥ 4.00',
  bets: [
    { id: 1, red: ['03', '08', '15', '21', '27', '30'], blue: ['09'], mult: 1 },
    { id: 2, red: ['05', '11', '17', '23', '29', '32'], blue: ['07'], mult: 1 },
  ],
};

export const LOCAL_RECOMMEND_MOCK: Record<
  string,
  { redBalls: string[]; blueBalls: string[]; summary: string }
> = {
  ssqAstrology: {
    redBalls: ['03', '08', '15', '21', '27', '30'],
    blueBalls: ['09'],
    summary:
      '今日火星入命宫，红球偏向高频区 03/08/15/21/27/30，蓝球取幸运数位 9，祝您好运。',
  },
  ssqIching: {
    redBalls: ['05', '11', '17', '23', '29', '32'],
    blueBalls: ['07'],
    summary: '今日卦象雷火丰，红球取旺相之数 05/11/17/23/29/32，蓝球应时位 7，祝您好运。',
  },
  dltAstrology: {
    redBalls: ['04', '12', '19', '23', '31'],
    blueBalls: ['03', '11'],
    summary: '今日火星入前区，前区红球取高频组合 04/12/19/23/31，后区蓝球选 03/11 双数位，祝您好运。',
  },
  dltIching: {
    redBalls: ['06', '14', '20', '26', '32'],
    blueBalls: ['05', '09'],
    summary: '今日卦象地风升，前区红球取 06/14/20/26/32 上升之数，后区蓝球 05/09 阴阳调和。',
  },
};
