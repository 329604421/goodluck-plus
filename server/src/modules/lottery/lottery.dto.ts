import { IsIn, Matches } from 'class-validator';

/** POST /api/lottery/sync：按开奖日期补差同步某一期 */
export class SyncDrawDto {
  @IsIn(['ssq', 'dlt'], { message: 'type 仅支持 ssq/dlt' })
  type: 'ssq' | 'dlt';

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date 需为 YYYY-MM-DD 格式' })
  date: string;
}
