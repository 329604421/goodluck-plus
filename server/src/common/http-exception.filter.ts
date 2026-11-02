import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { MulterError } from 'multer';

/**
 * 统一异常过滤器：
 * - ApiException / HttpException → { code, message, data:null }，HTTP 200
 * - ValidationPipe 校验失败（BadRequestException）→ code=40001 参数错误
 * - 未知异常 → code=50000
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    // 文件上传超限（multer）：返回明确的 40001 而非 50000 服务器内部错误（2026-08-21 修复）
    if (exception instanceof MulterError) {
      const message =
        exception.code === 'LIMIT_FILE_SIZE'
          ? '图片超过 2048KB 上限，请压缩后重试'
          : `文件上传失败（${exception.code}）`;
      return res.status(200).json({ code: 40001, message, data: null });
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse() as Record<string, unknown>;
      // ApiException 携带业务 code
      if (typeof body === 'object' && body !== null && 'code' in body && 'message' in body) {
        return res.status(200).json(body);
      }
      // 413 PayloadTooLarge：FileInterceptor 会把 multer LIMIT_FILE_SIZE 转成 413 →
      // 返回明确的 40001（2026-08-21 修复：此前被误报为 50000 服务器内部错误）
      if (exception.getStatus() === 413) {
        return res
          .status(200)
          .json({ code: 40001, message: '图片超过 2048KB 上限，请压缩后重试', data: null });
      }
      // 校验失败（ValidationPipe）等 → 参数错误
      const message =
        typeof body === 'object' && body !== null && Array.isArray(body['message'])
          ? (body['message'] as string[]).join('; ')
          : exception.message;
      const code = exception.getStatus() === 400 ? 40001 : 50000;
      return res.status(200).json({ code, message, data: null });
    }

    this.logger.error(
      `未处理异常: ${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    return res
      .status(200)
      .json({ code: 50000, message: '服务器内部错误', data: null });
  }
}
