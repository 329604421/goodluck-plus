import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from './api-exception';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * 设备 Token 鉴权（文档 §11.1）：
 * 读取 X-Device-Token → 查 device_tokens → req.userId 注入当前用户。
 * Token 无效返回 code=40100。
 */
@Injectable()
export class DeviceTokenGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = req.headers['x-device-token'];
    if (!token || typeof token !== 'string') {
      throw new ApiException(40100, '缺少 X-Device-Token');
    }

    const dt = await this.prisma.deviceToken.findUnique({
      where: { deviceToken: token },
    });
    if (!dt || dt.status !== 1) {
      throw new ApiException(40100, 'Token 无效，请重新注册');
    }

    // 更新最近活跃（非阻塞）
    this.prisma.deviceToken
      .update({ where: { id: dt.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);

    req.userId = dt.userId;
    return true;
  }
}
