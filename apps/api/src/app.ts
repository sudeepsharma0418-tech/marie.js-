import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import path from 'node:path';
import fs from 'node:fs';
import type { Config } from './config';
import { createDb, type Db } from './db/client';
import authPlugin from './plugins/auth';
import { AppError } from './lib/errors';
import { registerRoutes } from './modules';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

export interface BuildOptions {
  config: Config;
  db?: Db;
  logger?: boolean;
}

/** PostgreSQL error codes mapped to API responses. */
function mapPgError(err: { code?: string; constraint?: string; message: string }) {
  switch (err.code) {
    case '23505':
      return new AppError(409, 'duplicate', 'A record with the same unique value already exists', {
        constraint: err.constraint,
      });
    case '23514':
      return new AppError(422, 'constraint', 'The data violates a business constraint', {
        constraint: err.constraint,
      });
    case '23503':
      return new AppError(422, 'reference', 'A referenced record does not exist', {
        constraint: err.constraint,
      });
    case '23001':
      return new AppError(409, 'immutable', err.message);
    case '22P02':
      return new AppError(400, 'bad_request', 'Malformed value');
    default:
      return null;
  }
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { config } = opts;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]'],
            ...(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  const db = opts.db ?? createDb(config.DATABASE_URL).db;
  app.decorate('config', config);
  await app.register(
    fp(
      async (i) => {
        i.decorate('db', db);
      },
      { name: 'db' },
    ),
  );

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === 'test' ? 100_000 : 600,
    timeWindow: '1 minute',
  });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 } });
  await app.register(authPlugin);

  app.setErrorHandler((err: unknown, req, reply) => {
    let e: AppError;
    if (err instanceof AppError) e = err;
    else if (err instanceof ZodError) e = new AppError(400, 'bad_request', 'Validation failed', err.issues);
    else {
      const anyErr = err as { statusCode?: number; code?: string; message: string; cause?: unknown };
      const pg = mapPgError(anyErr) ?? mapPgError((anyErr.cause ?? {}) as never);
      if (pg) e = pg;
      else if (anyErr.statusCode && anyErr.statusCode < 500) {
        e = new AppError(anyErr.statusCode, anyErr.code ?? 'error', anyErr.message);
      } else {
        req.log.error({ err }, 'unhandled error');
        e = new AppError(500, 'internal', 'Something went wrong. The error has been logged.');
      }
    }
    if (e.statusCode >= 500) req.log.error({ err }, e.message);
    reply.status(e.statusCode).send({ error: { code: e.code, message: e.message, details: e.details } });
  });

  app.get('/api/v1/health', async () => {
    await db.execute('select 1' as never);
    return { ok: true, time: new Date().toISOString() };
  });

  await app.register(registerRoutes, { prefix: '/api/v1' });

  // Single-process production deployment: serve the built SPA.
  if (config.WEB_DIST_DIR && fs.existsSync(config.WEB_DIST_DIR)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    const root = path.resolve(config.WEB_DIST_DIR);
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'not_found', message: 'Route not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
