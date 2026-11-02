import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TicketService } from '../../modules/ticket/ticket.service';
import { SaveTicketDto } from '../../modules/ticket/ticket.dto';
import { ApiException } from '../../common/api-exception';

@Controller('api/ticket')
export class TicketController {
  constructor(private readonly ticket: TicketService) {}

  /** POST /api/ticket/ocr：multipart/form-data，字段名 file */
  @Post('ocr')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async ocr(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new ApiException(40001, '缺少图片文件（字段名 file）');
    }
    return this.ticket.recognizeTicket(file.buffer);
  }

  @Post()
  async save(@Req() req: { userId: bigint }, @Body() dto: SaveTicketDto) {
    return this.ticket.saveTicket(req.userId, dto);
  }

  @Get()
  async list(@Req() req: { userId: bigint }) {
    return this.ticket.listTickets(req.userId);
  }

  @Delete(':id')
  async remove(@Req() req: { userId: bigint }, @Param('id') id: string) {
    return this.ticket.deleteTicket(req.userId, BigInt(id));
  }
}
