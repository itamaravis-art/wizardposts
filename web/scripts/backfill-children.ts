/**
 * Backfill child shortlinks for an active campaign whose creation
 * flow didn't run the auto-expansion (or ran it before the post text
 * contained the parent shortlink). Idempotent — uses the same
 * `ensureChildShortlinksForGroups` helper the campaign-create route
 * uses, so existing children are reused.
 *
 * Usage:
 *   npx tsx scripts/backfill-children.ts <campaignId>
 */
import { config } from 'dotenv';
config({ path: '.env.prod' });
config({ path: '.env.local' });

async function main() {
  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error('Usage: npx tsx scripts/backfill-children.ts <campaignId>');
    process.exit(1);
  }

  const { db } = await import('../lib/db/index.js');
  const { campaigns, jobs } = await import('../lib/db/schema.js');
  const { eq } = await import('drizzle-orm');
  const { ensureChildShortlinksForGroups } = await import(
    '../lib/db/queries/shortlinks.js'
  );
  const { getPostForUser } = await import('../lib/db/queries/posts.js');

  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) {
    console.error('Campaign not found:', campaignId);
    process.exit(2);
  }
  console.log('Campaign:', c.name, 'user:', c.userId);

  const post = await getPostForUser(c.userId, c.postId);
  if (!post) {
    console.error('Post not found:', c.postId);
    process.exit(3);
  }
  console.log('Post text contains /l/post:', post.text.includes('/l/post'));

  const groupRows = await db
    .selectDistinct({ groupId: jobs.groupId })
    .from(jobs)
    .where(eq(jobs.campaignId, campaignId));
  const groupIds = groupRows.map((r) => r.groupId);
  console.log('Groups:', groupIds.length);

  const result = await ensureChildShortlinksForGroups(
    c.userId,
    post.id,
    post.text,
    groupIds,
  );
  const groupKeys = Object.keys(result);
  console.log(`✓ Children present for ${groupKeys.length} groups`);
  if (groupKeys.length > 0) {
    const sample = result[groupKeys[0]!]!;
    console.log('Sample swap map:', sample);
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
