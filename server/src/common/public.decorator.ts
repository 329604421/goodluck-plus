import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记无需设备 Token 鉴权的接口（/health、/api/auth/register） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
