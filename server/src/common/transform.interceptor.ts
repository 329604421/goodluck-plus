import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * 统一响应包装：controller 直接返回业务 data，本拦截器包装为
 * { code: 0, message: 'ok', data }（文档 §8.1）。
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => ({ code: 0, message: 'ok', data: data ?? null })));
  }
}
