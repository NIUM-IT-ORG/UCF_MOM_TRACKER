import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { createHttpLogger, createLogger } from './common/logger.js';
import { isRawUploadRequest } from './common/raw-upload.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(createHttpLogger(logger));
  app.use(helmet());
  app.use(cookieParser());

  /*
   * File uploads arrive as a raw body on exactly one route — the PUT that
   * sends the bytes. Everything else is JSON, and the JSON parser would
   * reject a PDF, so the raw parser is registered ahead of Nest's own body
   * handling but only for that one request.
   *
   * Mounting it on the whole `/files` subtree, as this once did, also caught
   * the JSON that reserves a file: the DTO then received a Buffer and refused
   * a body that plainly carried a fileName. Nothing could be uploaded.
   */
  const rawUpload = express.raw({ type: '*/*', limit: '25mb' });
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (isRawUploadRequest(req.method, req.path)) {
      rawUpload(req, res, next);
      return;
    }
    next();
  });

  // Tokens travel as httpOnly cookies, so the browser must be allowed to send
  // them and the origin list must be explicit — never a wildcard with credentials.
  app.enableCors({ origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()), credentials: true });

  app.setGlobalPrefix(env.API_PREFIX);
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.info(
    { port: env.PORT, prefix: env.API_PREFIX, env: env.NODE_ENV },
    `API listening on http://localhost:${env.PORT}/${env.API_PREFIX}`,
  );
}

bootstrap().catch((err: unknown) => {
  // The logger itself may be what failed, so this one writes directly.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
