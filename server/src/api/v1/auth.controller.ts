import { Body, Controller, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { AuthService } from '../../modules/auth/auth.service';
import { Public } from '../../common/public.decorator';

class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '缺少微信登录 code' })
  @MaxLength(128)
  code!: string;
}

class RokidPasscodeDto {
  @IsString()
  @IsNotEmpty({ message: '缺少验证码' })
  @Matches(/^\d{6}$/, { message: '验证码需为 6 位纯数字' })
  code!: string;
}

class RokidBindDto {
  @IsString()
  @IsNotEmpty({ message: '缺少 userId' })
  @Matches(/^\d+$/, { message: 'userId 格式错误' })
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: '缺少验证码' })
  @Matches(/^\d{6}$/, { message: '验证码需为 6 位纯数字' })
  code!: string;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/register：匿名设备注册（眼镜端），返回 deviceToken */
  @Public()
  @Post('register')
  async register() {
    return this.auth.register();
  }

  /** POST /api/auth/login：微信登录（code → openid），同一微信号多端同一用户（2026-08-21） */
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.auth.loginWithCode(dto.code);
  }

  /** POST /api/auth/rokid/passcode：设置/更新口令验证码（小程序端调用，2026-08-25） */
  @Post('rokid/passcode')
  async setRokidPasscode(@Body() dto: RokidPasscodeDto, @Req() req: { userId: bigint }) {
    return this.auth.setRokidPasscode(req.userId, dto.code);
  }

  /** POST /api/auth/rokid/bind：口令绑定（眼镜端调用，幂等可重复，2026-08-25） */
  @Public()
  @Post('rokid/bind')
  async bindRokid(@Body() dto: RokidBindDto) {
    return this.auth.bindRokid(dto.userId, dto.code);
  }
}
