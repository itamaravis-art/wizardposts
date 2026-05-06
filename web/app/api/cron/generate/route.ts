// Daily 22:00 cron — produce tomorrow's posts for every active page.
//
// For each active page × each scheduled slot tomorrow:
//   1. Look up the pillar from the weekly schedule.
//   2. Generate 3 captions with GPT-4o.
//   3. Generate 1 image with gpt-image-1 (medium quality).
//   4. INSERT a posts row with channel='page', approval_status='pending',
//      caption_variants=[3], image_url=public URL, scheduled_at=tomorrow at slot.
//
// Errors per-page or per-slot are isolated — one OpenAI failure does not
// kill the whole cron. Final summary WhatsApp goes to the owner.
//
// Auth: CRON_SECRET via Authorization header (Vercel injects).

import { NextRequest } from 'next/server';
import { addLog } from '@/lib/db/queries/logs';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import { listActivePagesWithTokens } from '@/lib/db/queries/pages';
import { createPagePost } from '@/lib/db/queries/pagePosts';
import {
  getAllPillarsForDate,
  dateAtSlot,
} from '@/lib/ai/pillarSchedule';
import { generateCaptions } from '@/lib/ai/captions';
import { generateImage } from '@/lib/ai/images';
import { notifyOwner } from '@/lib/notifications/greenApi';
import type { BrandKit, PillarId } from '@/lib/ai/types';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // generation can take 30-50s for 2 slots

interface SlotResult {
  slot: string;
  pillar: PillarId | null;
  ok: boolean;
  postId?: string;
  error?: string;
}

interface PageResult {
  pageId: string;
  pageName: string;
  slots: SlotResult[];
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const startedAt = Date.now();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pages = await listActivePagesWithTokens();
  const results: PageResult[] = [];

  for (const page of pages) {
    const brandKit = page.brandKit as BrandKit;
    const slots = getAllPillarsForDate(tomorrow, brandKit);
    const pageRes: PageResult = {
      pageId: page.id,
      pageName: page.pageName,
      slots: [],
    };

    for (const { slot, pillar } of slots) {
      if (!pillar) {
        pageRes.slots.push({ slot, pillar: null, ok: true });
        continue; // intentional skip slot
      }

      // Idempotence guard: skip if a post already exists for this
      // (page, scheduledAt). Prevents double-generation if the cron
      // fires twice (Vercel rare retries).
      const scheduledAt = dateAtSlot(tomorrow, slot);
      const existing = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          sql`${posts.channel} = 'page' AND ${posts.pageId} = ${page.id} AND ${posts.scheduledAt} = ${scheduledAt}`,
        )
        .limit(1);
      if (existing.length > 0) {
        pageRes.slots.push({
          slot,
          pillar,
          ok: true,
          postId: existing[0]!.id,
          error: 'already-generated',
        });
        continue;
      }

      try {
        const captions = await generateCaptions({ pillar, brandKit, count: 3 });
        // Use the first caption for image-prompt context (we don't have
        // a postId yet — generate uses a temp uuid, then we update on
        // the row insert).
        const tempPostId = crypto.randomUUID();
        const { url, prompt } = await generateImage({
          pillar,
          brandKit,
          caption: captions[0]!,
          pageId: page.id,
          postId: tempPostId,
        });

        const created = await createPagePost({
          userId: page.userId,
          pageId: page.id,
          initialText: captions[0]!,
          captionVariants: captions,
          imageUrl: url,
          imagePrompt: prompt,
          scheduledAt,
        });

        pageRes.slots.push({ slot, pillar, ok: true, postId: created.id });
        await addLog({
          userId: page.userId,
          level: 'info',
          source: 'page-generate-cron',
          message: `generated post for ${pillar} @ ${slot}`,
          meta: { pageId: page.id, postId: created.id, pillar, slot },
        }).catch(() => {});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pageRes.slots.push({ slot, pillar, ok: false, error: message });
        await addLog({
          userId: page.userId,
          level: 'error',
          source: 'page-generate-cron',
          message: `generation failed for ${pillar} @ ${slot}`,
          meta: { pageId: page.id, pillar, slot, error: message },
        }).catch(() => {});
      }
    }

    results.push(pageRes);
  }

  // Owner WhatsApp summary. Silent on success-with-zero-pages.
  const totalGenerated = results.reduce(
    (sum, p) => sum + p.slots.filter((s) => s.ok && s.postId).length,
    0,
  );
  const totalFailed = results.reduce(
    (sum, p) => sum + p.slots.filter((s) => !s.ok).length,
    0,
  );
  if (totalGenerated > 0 || totalFailed > 0) {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
    const summary =
      totalFailed === 0
        ? `🌿 ${totalGenerated} פוסטים מוכנים לאישור למחר.\n\nלאישור: ${baseUrl}/page/queue`
        : `⚠️ ${totalGenerated} פוסטים מוכנים, ${totalFailed} כשלו.\n\nלאישור: ${baseUrl}/page/queue`;
    await notifyOwner(summary);
  }

  return Response.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    pagesProcessed: results.length,
    totalGenerated,
    totalFailed,
    results,
  });
}
