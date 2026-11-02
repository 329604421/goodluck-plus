import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api-exception';
import { UserService } from '../user/user.service';

/**
 * 设备注册与微信登录（文档 §8.3.1）：
 *
 * 1. register（匿名设备注册）：每次注册创建独立用户——2026-08-21 修复越权
 *    （原"个人单用户"设计会复用第一个用户，导致所有登录设备共享同一份数据）。
 *    眼镜端（无微信环境）使用此入口。
 *
 * 2. loginWithCode（微信登录）：wx.login code → code2session 换 openid →
 *    同一 openid 复用同一用户（手机/PC 微信多端同一账号）——2026-08-21 新增。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Rokid bind 失败限流（内存态，单实例足够）：userId → { failCount, firstFailAt, lockedUntil }
  private readonly bindFailures = new Map<string, { count: number; firstFailAt: number; lockedUntil: number }>();
  // passcode 设置频率限制（同用户 1 分钟内 > 3 次）：userId → 时间戳数组
  private readonly passcodeTimes = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly user: UserService,
  ) {}

  /** 匿名设备注册：独立新用户 */
  async register(): Promise<{ deviceToken: string }> {
    const deviceToken = randomBytes(24).toString('hex');

    // 每次注册创建独立用户，各设备数据完全隔离
    const user = await this.prisma.user.create({ data: {} });

    await this.prisma.deviceToken.create({
      data: {
        userId: user.id,
        deviceToken,
        clientType: 'wechat_mp',
        status: 1,
        lastSeenAt: new Date(),
      },
    });

    return { deviceToken };
  }

  /** 微信登录：code 换 openid，同一 openid 复用同一用户（多端同一账号） */
  async loginWithCode(code: string): Promise<{ deviceToken: string }> {
    const appid = this.config.get<string>('wechatAppid');
    const secret = this.config.get<string>('wechatAppSecret');
    if (!appid || !secret) {
      this.logger.error('wx 登录失败：WECHAT_APPID/WECHAT_APPSECRET 未配置');
      throw new ApiException(50000, '微信登录未配置（缺少 WECHAT_APPID/WECHAT_APPSECRET）');
    }
    if (!code || typeof code !== 'string') {
      throw new ApiException(40001, '缺少微信登录 code');
    }

    // 1. code2session（code 一次性、有效期约 5 分钟）
    const url =
      `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}` +
      `&secret=${secret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    let wxData: { openid?: string; errcode?: number; errmsg?: string };
    try {
      const resp = await fetch(url);
      wxData = (await resp.json()) as typeof wxData;
    } catch (err) {
      this.logger.error(`wx 登录失败：code2session 网络异常 ${(err as Error)?.message ?? err}`);
      throw new ApiException(50000, '微信登录网络异常，请重试');
    }
    if (!wxData?.openid) {
      // 常见：40029 code 无效、45011 频率限制、-1 系统繁忙
      this.logger.warn(`wx 登录失败：code2session errcode=${wxData?.errcode} errmsg=${wxData?.errmsg}`);
      throw new ApiException(40100, `微信登录失败（${wxData?.errcode ?? '未知'}）`);
    }
    const openid = wxData.openid;

    // 2. openid → 用户（upsert；openid 列通过 raw SQL 访问，暂未同步 Prisma client）
    let userId: bigint | undefined;
    const existing = await this.prisma.$queryRawUnsafe(
      'SELECT id FROM users WHERE openid = ? LIMIT 1',
      openid,
    ) as { id: bigint }[];
    if (existing.length > 0) {
      userId = existing[0].id;
      this.logger.log(`wx 登录：openid=${openid.slice(0, 8)}... → 复用用户 user=${userId}`);
    } else {
      // 2026-09-04 身份迁移（收编）：openid 首次登录时，若全库恰有一个设置过 Rokid 口令
      // 的老账号（唯一真实用户），直接把 openid 绑定到该账号，不再新建空用户——
      // 8/21 之前全部为匿名注册（openid 全空），openid 登录上线后首次登录会新建空用户，
      // 造成"历史数据清空"的假象。个人自用应用，收编规则安全；多用户需改为口令认领。
      const owners = await this.prisma.$queryRawUnsafe(
        'SELECT user_id FROM rokid_passcode LIMIT 2',
      ) as { user_id: bigint }[];
      if (owners.length === 1) {
        userId = owners[0].user_id;
        await this.prisma.$executeRawUnsafe(
          'UPDATE users SET openid = ?, updated_at = NOW(3) WHERE id = ? AND openid IS NULL',
          openid,
          userId,
        );
        this.logger.log(
          `wx 登录：openid 首次登录 → 自动收编唯一口令账号 user=${userId}（历史数据保留）`,
        );
      } else {
        this.logger.log(
          `wx 登录：openid=${openid.slice(0, 8)}... 无匹配账号（口令账号数=${owners.length}）→ 新建用户`,
        );
        await this.prisma.$executeRawUnsafe(
          'INSERT INTO users (openid, created_at, updated_at) VALUES (?, NOW(3), NOW(3))',
          openid,
        );
        const created = await this.prisma.$queryRawUnsafe(
          'SELECT id FROM users WHERE openid = ? LIMIT 1',
          openid,
        ) as { id: bigint }[];
        if (created.length === 0) {
          throw new ApiException(50000, '微信登录创建用户失败');
        }
        userId = created[0].id;
      }
    }
    this.logger.log(`wx 登录成功：user=${userId}，签发 deviceToken（wechat_openid）`);

    // 3. 签发 deviceToken（clientType 区分微信登录设备）
    const deviceToken = randomBytes(24).toString('hex');
    await this.prisma.deviceToken.create({
      data: {
        userId,
        deviceToken,
        clientType: 'wechat_openid',
        status: 1,
        lastSeenAt: new Date(),
      },
    });

    return { deviceToken };
  }

  // ---------- Rokid 眼镜端口令绑定（改造说明 §3.2 / §3.3，2026-08-25 上线） ----------

  /** 口令验证码 hash：sha256(userId + code + salt)，不存明文 */
  private hashCode(userId: bigint, code: string): string {
    const salt = this.config.get<string>('pairingSalt') ?? 'lottery-pairing-salt-v1';
    return createHash('sha256').update(`${userId}:${code}:${salt}`).digest('hex');
  }

  /** POST /api/auth/rokid/passcode：设置/更新口令验证码（upsert 覆盖，旧口令立即失效） */
  async setRokidPasscode(userId: bigint, code: string): Promise<{ userId: string }> {
    if (!/^\d{6}$/.test(code)) {
      throw new ApiException(40001, '验证码需为 6 位纯数字');
    }
    // 频率限制：同用户 1 分钟内 > 3 次
    const now = Date.now();
    const times = (this.passcodeTimes.get(String(userId)) || []).filter((t) => now - t < 60000);
    if (times.length >= 3) {
      throw new ApiException(42900, '操作过于频繁，请稍后重试');
    }
    times.push(now);
    this.passcodeTimes.set(String(userId), times);

    const codeHash = this.hashCode(userId, code);
    // upsert：一人一条（userId 唯一键），重复设置覆盖
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO rokid_passcode (user_id, code_hash, created_at, updated_at)
       VALUES (?, ?, NOW(3), NOW(3))
       ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), updated_at = NOW(3)`,
      userId,
      codeHash,
    );
    return { userId: String(userId) };
  }

  /** POST /api/auth/rokid/bind：口令绑定（幂等可重复；校验 → 签发 token → 失效旧 rokid token） */
  async bindRokid(userIdStr: string, code: string): Promise<{ deviceToken: string; userConfig: unknown }> {
    if (!/^\d+$/.test(userIdStr) || !/^\d{6}$/.test(code)) {
      throw new ApiException(40001, '参数格式错误');
    }
    const userId = BigInt(userIdStr);

    // 用户存在性
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ApiException(40401, '用户不存在');
    }

    // 限流：同 userId 10 分钟内失败 ≥ 5 次 → 锁定 10 分钟
    const now = Date.now();
    const rec = this.bindFailures.get(userIdStr);
    if (rec && rec.lockedUntil > now) {
      throw new ApiException(42900, '尝试次数过多，请稍后重试');
    }

    // 校验口令（长期有效，无过期/一次性判断）
    const rows = await this.prisma.$queryRawUnsafe(
      'SELECT code_hash FROM rokid_passcode WHERE user_id = ? LIMIT 1',
      userId,
    ) as { code_hash: string }[];
    const codeHash = this.hashCode(userId, code);
    const ok = rows.length > 0 && rows[0].code_hash === codeHash;
    if (!ok) {
      if (rec) {
        rec.count += 1;
        rec.firstFailAt = rec.firstFailAt || now;
        if (rec.count >= 5 && now - rec.firstFailAt < 10 * 60 * 1000) {
          rec.lockedUntil = now + 10 * 60 * 1000;
          rec.count = 0;
        }
      } else {
        this.bindFailures.set(userIdStr, { count: 1, firstFailAt: now, lockedUntil: 0 });
      }
      throw new ApiException(40100, '口令无效');
    }
    // 成功：清空失败记录
    this.bindFailures.delete(userIdStr);

    // 签发绑定 token（client_type = rokid_glasses）
    const deviceToken = randomBytes(24).toString('hex');
    await this.prisma.deviceToken.create({
      data: {
        userId,
        deviceToken,
        clientType: 'rokid_glasses',
        status: 1,
        lastSeenAt: new Date(),
      },
    });
    // 同用户旧 rokid token 失效（只保留最新）
    await this.prisma.deviceToken.updateMany({
      where: { userId, clientType: 'rokid_glasses', deviceToken: { not: deviceToken } },
      data: { status: 0 },
    });

    // userConfig 直接复用 getConfig（已含 userId；name 供眼镜端顶栏展示）
    const userConfig = await this.user.getConfig(userId);
    return { deviceToken, userConfig };
  }
}
