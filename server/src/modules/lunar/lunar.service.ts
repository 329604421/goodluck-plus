import { Injectable } from '@nestjs/common';
import { Solar } from 'lunar-javascript';
import { fmtDate } from '../../common/format';

/**
 * 农历干支服务（文档 §8.3.13）：基于 lunar-javascript 纯本地计算。
 * /api/lunar 前端消费 `lunar` 简短文案；推荐服务消费 ganZhi / constellation。
 */
@Injectable()
export class LunarService {
  getLunarInfo(date = new Date()) {
    const solar = Solar.fromDate(date);
    const lunar = solar.getLunar();
    const yearGz = lunar.getYearInGanZhi();
    const monthCn = lunar.getMonthInChinese(); // 如 "七"
    const dayCn = lunar.getDayInChinese(); // 如 "廿八"

    return {
      solarDate: fmtDate(date),
      lunar: `${yearGz}年${monthCn}月${dayCn}`, // 对齐前端 mock "甲辰年七月廿八"
      lunarDate: `${yearGz}年${monthCn}月${dayCn}`,
      ganZhi: {
        year: yearGz,
        month: lunar.getMonthInGanZhi(),
        day: lunar.getDayInGanZhi(),
      },
      zodiac: lunar.getYearShengXiao(),
      constellation: `${solar.getXingZuo()}座`, // lunar-javascript 返回短名"狮子"，前端展示"狮子座"
    };
  }
}
