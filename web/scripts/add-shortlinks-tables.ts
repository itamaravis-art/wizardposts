/**
 * One-shot migration: create `shortlinks` + `shortlink_clicks` tables.
 *
 * Idempotent (uses IF NOT EXISTS), safe to re-run. Done as a direct DDL
 * script because drizzle-kit push hangs on an interactive prompt that
 * piped input cannot satisfy on Windows.
 *
 * Run with: npx tsx scripts/add-shortlinks-tables.ts  (from web/)
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
  // shortlinks
  await sql`
    CREATE TABLE IF NOT EXISTS shortlinks (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id       uuid,
      post_id         uuid REFERENCES posts(id) ON DELETE SET NULL,
      group_id        uuid REFERENCES groups(id) ON DELETE SET NULL,
      job_id          uuid REFERENCES jobs(id) ON DELETE SET NULL,
      slug            text NOT NULL UNIQUE,
      target_url      text NOT NULL,
      label           text,
      is_active       boolean NOT NULL DEFAULT true,
      click_count     integer NOT NULL DEFAULT 0,
      bot_click_count integer NOT NULL DEFAULT 0,
      created_at      timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  console.log('✓ CREATE TABLE shortlinks');

  // self-referencing parent FK — added separately so the table create above
  // doesn't depend on its own existence.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'shortlinks' AND constraint_name = 'shortlinks_parent_id_fkey'
      ) THEN
        ALTER TABLE shortlinks
          ADD CONSTRAINT shortlinks_parent_id_fkey
          FOREIGN KEY (parent_id) REFERENCES shortlinks(id) ON DELETE CASCADE;
      END IF;
    END$$
  `;
  console.log('✓ FK shortlinks.parent_id → shortlinks.id');

  await sql`CREATE INDEX IF NOT EXISTS shortlinks_user_id_idx     ON shortlinks(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS shortlinks_parent_id_idx   ON shortlinks(parent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS shortlinks_post_group_idx  ON shortlinks(post_id, group_id)`;
  await sql`CREATE INDEX IF NOT EXISTS shortlinks_user_active_idx ON shortlinks(user_id, is_active)`;
  console.log('✓ shortlinks indexes');

  // shortlink_clicks
  await sql`
    CREATE TABLE IF NOT EXISTS shortlink_clicks (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shortlink_id  uuid NOT NULL REFERENCES shortlinks(id) ON DELETE CASCADE,
      clicked_at    timestamp with time zone NOT NULL DEFAULT now(),
      ip_hash       text,
      user_agent    text,
      country       text,
      device_type   text,
      referrer      text,
      is_bot        boolean NOT NULL DEFAULT false
    )
  `;
  console.log('✓ CREATE TABLE shortlink_clicks');

  await sql`CREATE INDEX IF NOT EXISTS shortlink_clicks_shortlink_time_idx ON shortlink_clicks(shortlink_id, clicked_at)`;
  await sql`CREATE INDEX IF NOT EXISTS shortlink_clicks_time_idx           ON shortlink_clicks(clicked_at)`;
  console.log('✓ shortlink_clicks indexes');

  // Verify
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('shortlinks', 'shortlink_clicks')
    ORDER BY table_name
  `;
  console.log('\nTables now present:');
  for (const t of tables) console.log('  ' + t.table_name);

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('shortlinks','shortlink_clicks')
    ORDER BY indexname
  `;
  console.log('\nIndexes:');
  for (const i of idx) console.log('  ' + i.indexname);
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
