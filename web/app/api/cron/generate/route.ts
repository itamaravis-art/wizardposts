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
  // Default target = tomorrow (the cron's intent: nightly run preps the
  // next day's posts). `?date=YYYY-MM-DD` lets us backfill missed days
  // (e.g. when the cron itself fails to fire).
  const dateOverride = req.nextUrl.searchParams.get('date');
  const tomorrow = dateOverride
    ? new Date(`${dateOverride}T12:00:00Z`)
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
  // Optional ?slot=HH:mm filter so a single function invocation only
  // produces one slot — keeps each call comfortably under Vercel's 60s
  // function ceiling on Hobby. The two daily cron entries in
  // vercel.json each pin themselves to one slot.
  const slotFilter = req.nextUrl.searchParams.get('slot') || null;
  const pages = await listActivePagesWithTokens();
  const results: PageResult[] = [];

  for (const page of pages) {
    const brandKit = page.brandKit as BrandKit;
    const allSlots = getAllPillarsForDate(tomorrow, brandKit);
    const slots = slotFilter
      ? allSlots.filter((s) => s.slot === slotFilter)
      : allSlots;
    const pageRes: PageResult = {
      pageId: page.id,
      pageName: page.pageName,
      slots: [],
    };

    // Process all slots for this page in parallel — each slot is an
    // independent OpenAI roundtrip + Supabase upload + DB insert. Two
    // sequential slots blew Vercel's 60s function ceiling once the
    // image-prompt got richer; running them concurrently halves wall
    // time and keeps total well under the limit.
    const slotResults = await Promise.all(
      slots.map(async ({ slot, pillar }): Promise<SlotResult> => {
        if (!pillar) {
          return { slot, pillar: null, ok: true };
        }

        // Idempotence guard: skip if a post already exists for this
        // (page, scheduledAt). Prevents double-generation if the cron
        // fires twice (Vercel rare retries).
        const scheduledAt = dateAtSlot(tomorrow, slot);
        const scheduledAtIso = scheduledAt.toISOString();
        const existing = await db
          .select({ id: posts.id })
          .from(posts)
          .where(
            sql`${posts.channel} = 'page' AND ${posts.pageId} = ${page.id} AND ${posts.scheduledAt} = ${scheduledAtIso}::timestamptz`,
          )
          .limit(1);
        if (existing.length > 0) {
          return {
            slot,
            pillar,
            ok: true,
            postId: existing[0]!.id,
            error: 'already-generated',
          };
        }

        try {
          const captions = await generateCaptions({ pillar, brandKit, count: 3 });
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

          await addLog({
            userId: page.userId,
            level: 'info',
            source: 'page-generate-cron',
            message: `generated post for ${pillar} @ ${slot}`,
            meta: { pageId: page.id, postId: created.id, pillar, slot },
          }).catch(() => {});

          return { slot, pillar, ok: true, postId: created.id };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await addLog({
            userId: page.userId,
            level: 'error',
            source: 'page-generate-cron',
            message: `generation failed for ${pillar} @ ${slot}`,
            meta: { pageId: page.id, pillar, slot, error: message },
          }).catch(() => {});
          return { slot, pillar, ok: false, error: message };
        }
      }),
    );

    pageRes.slots = slotResults;
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
