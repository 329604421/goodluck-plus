import {
  IsString,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  MaxLength,
  IsBoolean,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BetDto {
  @Type(() => Number)
  @IsInt()
  id: number;

  @IsArray()
  @IsString({ each: true })
  red: string[];

  @IsArray()
  @IsString({ each: true })
  blue: string[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  mult: number;
}

export class SaveTicketDto {
  @IsString()
  lotteryType: string; // ssq | dlt

  @IsString()
  @MaxLength(32)
  period: string; // 纯数字，前端已清洗

  /** 票面开奖日期（OCR 识别结果），YYYY-MM-DD；缺省时后端按期号推算 */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'drawDate 格式应为 YYYY-MM-DD' })
  drawDate?: string;

  @IsArray()
  @Type(() => BetDto)
  bets: BetDto[];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  multiplier: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  totalAmount: number; // 分
}

export class RecommendDto {
  @IsString()
  system: string; // astrology | iching

  @IsString()
  lottery: string; // ssq | dlt

  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class RedeemConfirmDto {
  /** RedeemRecord.id（来自 /redeem/pending 的 id，首页用） */
  @IsOptional()
  @IsString()
  id?: string;

  /** Ticket.id（台账抽屉只有票据 id 时用，后端按 ticketId 反查兑奖记录） */
  @IsOptional()
  @IsString()
  ticketId?: string;
}
