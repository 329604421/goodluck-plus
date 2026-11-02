import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ArkService } from '../../integrations/volcengine/ark.service';
import { LunarService } from '../lunar/lunar.service';
import { UserService } from '../user/user.service';
import { ApiException } from '../../common/api-exception';
import { utcToday } from '../../common/date-utc';
import { LOTTERY_RULES, LotteryType } from '../lottery/lottery-rules';
import { fmtDateWithWeek, fmtDate } from '../../common/format';

const SYSTEM_NAMES: Record<string, string> = {
  astrology: '星座占星',
  iching: '五行推命',
};

/**
 * 推荐服务（文档 §9.6）：用户配置 + 农历 → Prompt → 火山方舟 LLM
 * 结果按 userId+date+lottery+system 日级缓存；refresh=true 强制重算。
 * LLM 返回号码做二次合法化修正。
 */
@Injectable()
export class RecommendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ark: ArkService,
    private readonly lunar: LunarService,
    private readonly user: UserService,
  ) {}

  async recommend(userId: bigint, system: string, lottery: string, refresh = false) {
    if (!(system in SYSTEM_NAMES)) {
      throw new ApiException(40001, 'system 仅支持 astrology/iching');
    }
    if (lottery !== 'ssq' && lottery !== 'dlt') {
      throw new ApiException(40001, 'lottery 仅支持 ssq/dlt');
    }

    const today = new Date();
    // UTC 日期键（Prisma DATE 列按 UTC 日期存取，避免本地零点偏移一天）
    const todayOnly = utcToday();

    // 缓存命中
    if (!refresh) {
      const cached = await this.prisma.recommendationCache.findUnique({
        where: {
          userId_recommendDate_lotteryType_divinationSystem: {
            userId,
            recommendDate: todayOnly,
            lotteryType: lottery,
            divinationSystem: system,
          },
        },
      });
      if (cached) return cached.resultJson;
    }

    const [cfg, lunarInfo] = await Promise.all([
      this.user.getRawConfig(userId),
      Promise.resolve(this.lunar.getLunarInfo(today)),
    ]);

    const result = await this.ark.generateRecommendation(
      {
        name: cfg?.name ?? '彩友',
        gender: cfg?.gender ?? '',
        birth: cfg?.birth ? fmtDate(cfg.birth) : '',
      },
      lunarInfo,
      system as 'astrology' | 'iching',
      lottery as LotteryType,
    );

    // 号码二次合法化修正
    const rule = LOTTERY_RULES[lottery as LotteryType];
    const sanitize = (balls: unknown, max: number, count: number): string[] => {
      const list = [...new Set(
        (Array.isArray(balls) ? balls : [])
          .map((x) => String(Number(x)).padStart(2, '0'))
          .filter((x) => Number(x) >= 1 && Number(x) <= max),
      )].sort();
      // 补齐 / 截断
      let i = 1;
      while (list.length < count) {
        const v = String(((Number(list[list.length - 1] ?? '0') + i) % max) + 1).padStart(2, '0');
        if (!list.includes(v)) list.push(v);
        list.sort();
        i++;
      }
      return list.slice(0, count);
    };
    const finalResult = {
      ...result,
      systemName: SYSTEM_NAMES[system],
      date: fmtDateWithWeek(today),
      redLabel: `${rule.redLabel === '红球' ? '红球区' : '前区红球'} · ${rule.redCount} 个`,
      blueLabel: `${rule.blueLabel === '蓝球' ? '蓝球区' : '后区蓝球'} · ${rule.blueCount} 个`,
      redBalls: sanitize(result.redBalls, rule.redMax, rule.redCount),
      blueBalls: sanitize(result.blueBalls, rule.blueMax, rule.blueCount),
      disclaimer: '本推荐仅供娱乐，不构成任何购彩建议',
    };

    // upsert 缓存
    const payload = {
      userId,
      recommendDate: todayOnly,
      lotteryType: lottery,
      divinationSystem: system,
      resultJson: finalResult as object,
    };
    await this.prisma.recommendationCache.upsert({
      where: {
        userId_recommendDate_lotteryType_divinationSystem: {
          userId,
          recommendDate: todayOnly,
          lotteryType: lottery,
          divinationSystem: system,
        },
      },
      create: payload,
      update: { resultJson: payload.resultJson },
    });

    return finalResult;
  }
}
