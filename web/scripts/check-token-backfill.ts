import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',
  prepare: false,
  max: 1,
});

async function main() {
  const rows = await sql`
    SELECT
      id,
      name,
      token_fp IS NOT NULL AS has_fp,
      last_seen_at,
      revoked_at,
      created_at
    FROM worker_tokens
    WHERE user_id = 'f326f703-aec1-4aa7-8123-33b5c6e56148'
    ORDER BY created_at DESC
  `;
  console.log(`Tokens for user f326f703-...: ${rows.length}`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
  }

  const all = await sql`
    SELECT
      COUNT(*)                                                AS total,
      COUNT(*) FILTER (WHERE token_fp IS NOT NULL)            AS with_fp,
      COUNT(*) FILTER (WHERE token_fp IS NULL)                AS without_fp,
      COUNT(*) FILTER (WHERE revoked_at IS NULL)              AS active,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND token_fp IS NULL) AS active_legacy
    FROM worker_tokens
  `;
  console.log('\nGlobal stats:', all[0]);
}

main()
  .then(() => sql.end())
  .catch((err) => {
    console.error(err);
    return sql.end().then(() => process.exit(1));
  });
