/**
 * One-shot migration: add token_fp column + index to worker_tokens.
 *
 * Idempotent (uses IF NOT EXISTS), so safe to re-run. Used because
 * drizzle-kit push hung waiting on an interactive prompt that piped
 * input could not satisfy on this Windows shell setup.
 *
 * Run with: npx tsx scripts/add-token-fp-column.ts
 *   (from inside web/)
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

// Mask password for logging.
const masked = url.replace(/(postgres(?:ql)?:\/\/[^:]+):[^@]+@/, '$1:****@');
console.log('Target:', masked);

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1 });

async function main() {
  // 1. Check the column doesn't exist yet.
  const before = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'worker_tokens'
      AND column_name = 'token_fp'
  `;
  console.log(`Pre-check: token_fp column exists? ${before.length > 0}`);

  // 2. Add the column (idempotent).
  await sql`ALTER TABLE worker_tokens ADD COLUMN IF NOT EXISTS token_fp text`;
  console.log('✓ ADD COLUMN token_fp');

  // 3. Add the index (idempotent).
  await sql`
    CREATE INDEX IF NOT EXISTS worker_tokens_token_fp_idx
    ON worker_tokens (token_fp)
  `;
  console.log('✓ CREATE INDEX worker_tokens_token_fp_idx');

  // 4. Verify.
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'worker_tokens'
    ORDER BY ordinal_position
  `;
  console.log('\nworker_tokens columns:');
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(25)} nullable=${c.is_nullable}`);
  }

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'worker_tokens'
    ORDER BY indexname
  `;
  console.log('\nworker_tokens indexes:');
  for (const i of idx) console.log('  ' + i.indexname);

  // 5. Quick stats: how many rows have a fp set vs not?
  const stats = await sql`
    SELECT
      COUNT(*) FILTER (WHERE token_fp IS NULL) AS legacy,
      COUNT(*) FILTER (WHERE token_fp IS NOT NULL) AS migrated,
      COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active
    FROM worker_tokens
  `;
  console.log('\nToken stats:', stats[0]);
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
