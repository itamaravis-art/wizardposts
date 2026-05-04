/**
 * End-to-end smoke test for shortlinks:
 *   1. Insert a test parent shortlink for a known user
 *   2. Hit /l/<slug> via fetch — expect 302 to target_url + click row
 *   3. Hit it again with a fake FB UA — expect 302 + is_bot click
 *   4. Verify both clicks are persisted with correct attribution
 *   5. Clean up (delete the test row)
 *
 * Run with: npx tsx scripts/smoke-test-shortlinks.ts  (from web/)
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

const HOST = process.env.SMOKE_HOST ?? 'https://wizardposts.vercel.app';
const sql = postgres(url, { ssl: 'require', prepare: false, max: 1 });

const TEST_SLUG = `smoke${Date.now().toString(36).slice(-6)}`;
const TARGET = 'https://example.com/smoke-test-target';

async function main() {
  // Find any user we can attach the test row to.
  const [user] = await sql`SELECT id FROM users LIMIT 1`;
  if (!user) throw new Error('No users in DB to attach the test shortlink to');
  const userId = user.id as string;
  console.log(`Using user: ${userId}`);
  console.log(`Test slug:  ${TEST_SLUG}`);
  console.log(`Target:     ${TARGET}`);
  console.log(`Host:       ${HOST}\n`);

  // 1. Insert
  const [link] = await sql`
    INSERT INTO shortlinks (user_id, slug, target_url, label)
    VALUES (${userId}, ${TEST_SLUG}, ${TARGET}, 'smoke-test')
    RETURNING id, slug, click_count, bot_click_count
  `;
  console.log('✓ inserted shortlink:', link);

  // 2. Hit the redirect as a "human"
  console.log('\n→ GET /l/' + TEST_SLUG + ' (human UA)');
  const res1 = await fetch(`${HOST}/l/${TEST_SLUG}`, {
    redirect: 'manual',
    headers: { 'user-agent': 'Mozilla/5.0 SmokeTestHuman/1.0' },
  });
  console.log(`  status: ${res1.status}`);
  console.log(`  location: ${res1.headers.get('location')}`);
  if (res1.status !== 302) throw new Error(`expected 302, got ${res1.status}`);
  if (res1.headers.get('location') !== TARGET) {
    throw new Error(`unexpected redirect target: ${res1.headers.get('location')}`);
  }

  // 3. Hit again as facebookexternalhit
  console.log('\n→ GET /l/' + TEST_SLUG + ' (facebookexternalhit UA)');
  const res2 = await fetch(`${HOST}/l/${TEST_SLUG}`, {
    redirect: 'manual',
    headers: { 'user-agent': 'facebookexternalhit/1.1' },
  });
  console.log(`  status: ${res2.status}`);
  if (res2.status !== 302) throw new Error(`expected 302, got ${res2.status}`);

  // Give the async fire-and-forget writes time to flush.
  await new Promise((r) => setTimeout(r, 1500));

  // 4. Verify clicks landed
  const clicks = await sql`
    SELECT is_bot, user_agent, country, device_type, clicked_at
    FROM shortlink_clicks
    WHERE shortlink_id = ${link.id}
    ORDER BY clicked_at
  `;
  console.log(`\n✓ ${clicks.length} click rows recorded:`);
  for (const c of clicks) {
    console.log(`    is_bot=${c.is_bot}  device=${c.device_type ?? '—'}  country=${c.country ?? '—'}  ua=${(c.user_agent ?? '').slice(0, 50)}`);
  }
  if (clicks.length !== 2) throw new Error(`expected 2 clicks, got ${clicks.length}`);
  const [human, bot] = clicks;
  if (human.is_bot) throw new Error('first click should be human');
  if (!bot.is_bot) throw new Error('second click should be bot');

  // Verify denormalized counters bumped correctly
  const [counters] = await sql`
    SELECT click_count, bot_click_count FROM shortlinks WHERE id = ${link.id}
  `;
  console.log(`✓ counters: human=${counters.click_count}  bot=${counters.bot_click_count}`);
  if (counters.click_count !== 1) throw new Error(`human counter wrong: ${counters.click_count}`);
  if (counters.bot_click_count !== 1) throw new Error(`bot counter wrong: ${counters.bot_click_count}`);

  // 5. Clean up
  await sql`DELETE FROM shortlinks WHERE id = ${link.id}`;
  console.log(`\n✓ cleaned up test row`);

  console.log('\n🎉 All checks passed.');
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\n✗ FAILED:', err);
    // Still try to clean up
    try {
      await sql`DELETE FROM shortlinks WHERE slug = ${TEST_SLUG}`;
    } catch {}
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
