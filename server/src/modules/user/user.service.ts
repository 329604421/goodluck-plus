import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { fmtDate } from '../../common/format';
import { utcDate } from '../../common/date-utc';

export interface SaveConfigInput {
  name?: string;
  gender?: string;
  birth?: string; // YYYY-MM-DD
  lotteryType?: string;
  divinationSystem?: string;
}

/**
 * 用户配置（文档 §8.3.2 / §9.1）：
 * 主字段 lotteryType/birth/divinationSystem，同时兼容输出 lotteryTypes 数组。
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(userId: bigint): Promise<Record<string, unknown>> {
    const cfg = await this.prisma.userConfig.findUnique({ where: { userId } });
    if (!cfg) {
      return {
        userId: String(userId), // 2026-08-25：暴露 userId 供 Rokid 口令绑定
        initialized: false,
        name: '',
        gender: '',
        birth: '',
        lotteryType: null,
        lotteryTypes: [],
        divinationSystem: null,
      };
    }
    const lotteryType = cfg.lotteryType ?? null;
    return {
      userId: String(userId), // 2026-08-25：暴露 userId（BigInt 字符串化）
      initialized: true,
      name: cfg.name ?? '',
      gender: cfg.gender ?? '',
      birth: cfg.birth ? fmtDate(cfg.birth) : '',
      lotteryType,
      lotteryTypes: lotteryType ? [lotteryType] : [],
      divinationSystem: cfg.divinationSystem ?? null,
    };
  }

  async saveConfig(userId: bigint, input: SaveConfigInput) {
    const data = {
      name: input.name,
      gender: input.gender,
      // birth 必须用 utcDate 构造：MySQL DATE 按 UTC 日期存取，本地零点 new Date()
      // 会偏移成前一天（Prisma DATE 陷阱，与 drawDate 同款问题，2026-08-20 修复）
      birth: input.birth ? this.parseBirthDate(input.birth) : null,
      lotteryType: input.lotteryType,
      divinationSystem: input.divinationSystem,
      rawPayload: input as object,
    };
    await this.prisma.userConfig.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { initialized: true };
  }

  /** 解析生日（YYYY-MM-DD）为 UTC 日期键，避免时区偏移 */
  private parseBirthDate(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) {
      throw new ApiException(40001, `生日格式错误：${s}`);
    }
    return utcDate(y, m, d);
  }

  /** 供推荐服务等模块内部使用 */
  async getRawConfig(userId: bigint) {
    return this.prisma.userConfig.findUnique({ where: { userId } });
  }
}
