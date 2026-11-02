import { Controller, Get, Query } from '@nestjs/common';
import { LunarService } from '../../modules/lunar/lunar.service';

@Controller('api/lunar')
export class LunarController {
  constructor(private readonly lunar: LunarService) {}

  /** GET /api/lunar?date=2026-08-19（date 可选，缺省今天） */
  @Get()
  get(@Query('date') date?: string) {
    const d = date ? new Date(date + 'T00:00:00') : new Date();
    return this.lunar.getLunarInfo(d);
  }
}
