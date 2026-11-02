import { Global, Module } from '@nestjs/common';
import { LunarService } from './lunar.service';

@Global()
@Module({
  providers: [LunarService],
  exports: [LunarService],
})
export class LunarModule {}
