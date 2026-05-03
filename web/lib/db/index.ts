/**
 * Drizzle client singleton.
 *
 * - Reads `DATABASE_URL` from process.env.
 * - Uses the `postgres` driver with prepared statements enabled.
 * - SSL is required for Supabase (`sslmode=require`).
 *
 * In a serverless / edge-ish environment (Next.js dev mode hot reload), we
 * cache the client on `globalThis` so we don't open a new pool on every HMR.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

type GlobalWithPg = typeof globalThis & {
  __pgClient?: ReturnType<typeof postgres>;
};
const g = globalThis as GlobalWithPg;

const client =
  g.__pgClient ??
  postgres(connectionString, {
    ssl: 'require',
    prepare: true,
    max: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  g.__pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
export * from './schema';
export type Database = typeof db;
