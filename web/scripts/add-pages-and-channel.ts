/**
 * One-shot migration for the einatural Page module (Phase 1.1).
 *
 * Adds:
 *   - `channel` enum ('group' | 'page')
 *   - `pages` table (FB pages connected via Graph API)
 *   - `posts.channel`, `pageId`, `imagePrompt`, `captionVariants`,
 *     `approvalStatus`, `approvedAt`, `scheduledAt`, `fbPostId`,
 *     `retryCount` columns
 *   - `posts_publish_lookup_idx` for the publisher cron's hot path
 *
 * Idempotent. Safe to re-run. Done as direct DDL because drizzle-kit
 * push hangs interactively on this Windows setup (verified previously).
 *
 * Run:  npx tsx scripts/add-pages-and-channel.ts  (from web/)
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
  // 1. channel enum
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel') THEN
        CREATE TYPE channel AS ENUM ('group', 'page');
      END IF;
    END$$
  `;
  console.log('✓ channel enum');

  // 2. pages table
  await sql`
    CREATE TABLE IF NOT EXISTS pages (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fb_page_id         text NOT NULL,
      page_name          text NOT NULL,
      access_token       text NOT NULL,
      token_expires_at   timestamp with time zone,
      brand_kit          jsonb NOT NULL,
      active             boolean NOT NULL DEFAULT true,
      created_at         timestamp with time zone NOT NULL DEFAULT now(),
      updated_at         timestamp with time zone NOT NULL DEFAULT now()
    )
  `;
  console.log('✓ CREATE TABLE pages');

  await sql`CREATE INDEX IF NOT EXISTS pages_user_id_idx ON pages(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS pages_active_idx  ON pages(active)`;
  console.log('✓ pages indexes');

  // 3. posts column extensions
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS channel channel NOT NULL DEFAULT 'group'`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS page_id uuid`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_prompt text`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS caption_variants jsonb`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS approval_status text`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at timestamp with time zone`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS fb_post_id text`;
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0`;
  console.log('✓ posts column extensions');

  // 4. posts.page_id FK (added separately so the ALTER TABLE above doesn't
  //    fail if pages didn't exist on first run — order is decoupled).
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'posts' AND constraint_name = 'posts_page_id_fkey'
      ) THEN
        ALTER TABLE posts
          ADD CONSTRAINT posts_page_id_fkey
          FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL;
      END IF;
    END$$
  `;
  console.log('✓ FK posts.page_id → pages.id');

  // 5. publish-lookup index (drives the cron that picks rows to publish)
  await sql`
    CREATE INDEX IF NOT EXISTS posts_publish_lookup_idx
    ON posts(channel, approval_status, scheduled_at)
  `;
  console.log('✓ posts_publish_lookup_idx');

  // Verify
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'posts'
    ORDER BY ordinal_position
  `;
  console.log('\nposts columns:');
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} ` +
        `nullable=${c.is_nullable} default=${c.column_default ?? '—'}`,
    );
  }

  const tableStats = await sql`
    SELECT
      (SELECT COUNT(*) FROM pages) AS pages_count,
      (SELECT COUNT(*) FROM posts) AS posts_count,
      (SELECT COUNT(*) FROM posts WHERE channel = 'group') AS group_posts,
      (SELECT COUNT(*) FROM posts WHERE channel = 'page')  AS page_posts
  `;
  console.log('\nStats:', tableStats[0]);
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
