import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule], // bind 需 UserService（用户存在性校验 + getConfig）
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
