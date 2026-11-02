import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：HTTP 层面统一返回 200，错误语义由 body.code 表达。
 * 前端 request 封装只看 statusCode 2xx，再按 data 判空走兜底逻辑。
 */
export class ApiException extends HttpException {
  readonly bizCode: number;

  constructor(bizCode: number, message: string) {
    super({ code: bizCode, message, data: null }, HttpStatus.OK);
    this.bizCode = bizCode;
  }
}
