/**
 * 彩票期号归一化工具（2026-08-25 新增）
 *
 * 背景：OCR 清洗后票据期号可能是 5 位（"26096"）或 7 位（"2026096"），
 * 而 draw_results 同步的开奖记录为官方 7 位写法。所有按期号匹配的
 * 逻辑（兑奖计算/开奖比对/票据列表号码）必须统一归一化，否则 5 位票
 * 匹配不上开奖记录 → 兑奖不计算（线上事故）。
 */

/** 归一化：5 位补 "20" 前缀 → 7 位；7 位及以上保持不变；空 → '' */
export function normalizeIssue(p: string | null | undefined): string {
  const s = String(p ?? '').replace(/\D/g, '');
  if (!s) return '';
  return s.length === 5 ? '20' + s : s;
}
