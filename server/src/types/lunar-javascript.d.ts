/** lunar-javascript 无官方类型声明，按其 README API 手写最小声明 */
declare module 'lunar-javascript' {
  export interface Lunar {
    getYearInGanZhi(): string;
    getMonthInGanZhi(): string;
    getDayInGanZhi(): string;
    getYearShengXiao(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
  }
  export interface Solar {
    getLunar(): Lunar;
    getXingZuo(): string;
  }
  export const Solar: {
    fromDate(d: Date): Solar;
    fromYmdHms(y: number, m: number, d: number, h?: number, mi?: number, s?: number): Solar;
  };
  export const Lunar: {
    fromDate(d: Date): Lunar;
    fromYmdHms(y: number, m: number, d: number, h?: number, mi?: number, s?: number): Lunar;
  };
}
