import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  // 全局入参校验：class-validator DTO 校验失败 → HttpExceptionFilter 统一转 code=40001
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.APP_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`🚀 彩票小助手后端已启动: http://localhost:${port}`);
  new Logger('Bootstrap').log(`健康检查: http://localhost:${port}/health`);
}

bootstrap();
