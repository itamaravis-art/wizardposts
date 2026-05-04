/**
 * One-shot migration: add `failure_kind` text column to `jobs`.
 *
 * Idempotent (uses IF NOT EXISTS), safe to re-run. Done as a direct DDL
 * script because drizzle-kit push in this repo's setup hangs on an
 * interactive prompt that piped input cannot satisfy on Windows.
 *
 * Run with: npx tsx scripts/add-failure-kind-column.ts  (from web/)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const masked = url.replace(/(postgres(?:ql)?:\/\/[^:]+):[^@]+@/, '$1:****@');
console.log('Target:', masked);

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1 });

async function main() {
  const before = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'failure_kind'
  `;
  console.log(`Pre-check: failure_kind exists? ${before.length > 0}`);

  await sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS failure_kind text`;
  console.log('✓ ADD COLUMN failure_kind');

  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'jobs'
    ORDER BY ordinal_position
  `;
  console.log('\njobs columns:');
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(25)} nullable=${c.is_nullable}`);
  }

  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE failure_kind IS NOT NULL) AS with_kind,
      COUNT(*) FILTER (WHERE failure_kind IS NULL AND status = 'failed') AS legacy_failed,
      COUNT(*) FILTER (WHERE status = 'success') AS success,
      COUNT(*)                                          AS total
    FROM jobs
  `;
  console.log('\nJob stats:', stats[0]);
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    console.log('\nDone.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Migration failed:', err);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
