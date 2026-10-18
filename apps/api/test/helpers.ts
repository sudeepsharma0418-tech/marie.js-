import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app';
import { createDb, type Db } from '../src/db/client';
import { DEMO_PASSWORD, seedDemo, type SeedResult } from '../src/db/seed-data';
import { loadConfig } from '../src/config';

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://hp:hp_dev_password@localhost:5432/hotelproc_test';

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  seed: SeedResult;
  close: () => Promise<void>;
}

export async function setupTestEnv(): Promise<TestEnv> {
  const { db, pool } = createDb(TEST_DB, 20);
  await resetData(db);
  const seed = await seedDemo(db, { fastHash: true });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    STORAGE_DIR: path.join(os.tmpdir(), `hp-test-storage-${process.pid}`),
    LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  return {
    app,
    db,
    seed,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** TRUNCATE does not fire the append-only row triggers, so tests can start clean. */
export async function resetData(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(', ');
  if (names) await db.execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export class Client {
  cookie = '';
  csrf = '';
  constructor(
    private app: FastifyInstance,
    public label = 'anon',
  ) {}

  async login(email: string, password = DEMO_PASSWORD) {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    if (res.statusCode !== 200) throw new Error(`login ${email} failed: ${res.statusCode} ${res.body}`);
    this.cookie = String(res.cookies.find((c) => c.name === 'hp_sid')!.value);
    this.csrf = res.json().csrfToken;
    this.label = email;
    return this;
  }

  async req(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    return this.app.inject({
      method,
      url: url.startsWith('/api') ? url : `/api/v1${url}`,
      payload: payload as never,
      cookies: this.cookie ? { hp_sid: this.cookie } : {},
      headers: { ...(method !== 'GET' && this.csrf ? { 'x-csrf-token': this.csrf } : {}), ...headers },
    });
  }

  get(url: string) {
    return this.req('GET', url);
  }
  post(url: string, body: unknown = {}) {
    return this.req('POST', url, body);
  }
  put(url: string, body: unknown = {}) {
    return this.req('PUT', url, body);
  }
  patch(url: string, body: unknown = {}) {
    return this.req('PATCH', url, body);
  }

  /** Assert a 2xx and return the JSON body. */
  async ok<T = any>(p: Promise<LightMyRequestResponse>): Promise<T> {
    const res = await p;
    if (res.statusCode >= 300)
      throw new Error(`[${this.label}] expected success, got ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  }
}

export async function as(env: TestEnv, email: string) {
  return new Client(env.app).login(email);
}

export const uuid = () => randomUUID();

export const EMAILS = {
  owner: 'owner@demo.local',
  procurement: 'procurement@demo.local',
  warehouse: 'hub@demo.local',
  driver: 'driver@demo.local',
  tinauManager: 'manager@tinau.demo.local',
  tinauPurchaser: 'purchase@tinau.demo.local',
  tinauInventory: 'store@tinau.demo.local',
  lumbiniManager: 'manager@lumbini.demo.local',
  hillsManager: 'manager@hills.demo.local',
};

/** Drizzle wraps PostgreSQL errors; match against the underlying database message. */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    const msg = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
    if (!pattern.test(msg)) throw new Error(`Expected database error ${pattern}, got: ${msg}`);
    return;
  }
  throw new Error(`Expected database error ${pattern}, but the statement succeeded`);
}
