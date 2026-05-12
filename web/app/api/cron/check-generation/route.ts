/**
 * Daily safety net (23:00 IL = 20:00 UTC): verify that tonight's
 * generate cron produced the expected number of posts for tomorrow.
 * If anything's missing, ping the owner on WhatsApp so they can
 * either re-fire generate manually or accept that a slot will be
 * empty.
 *
 * Why this exists: on 2026-05-11 the 22:00 IL generate cron returned
 * 200 OK but `totalGenerated: 0` for the 10:00 slot — a silent
 * transient failure. The scheduler now retries automatically (iter12),
 * but this endpoint catches anything that slipped through.
 *
 * Auth: CRON_SECRET via the standard cronAuth helper.
 */
import { NextRequest } from 'next/server';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import { db } from '@/lib/db';
import { pages, posts } from '@/lib/db/schema';
import { and, eq, gte, lt, sql as drizzleSql } from 'drizzle-orm';
import { notifyOwner } from '@/lib/notifications/greenApi';
import type { BrandKit } from '@/lib/ai/types';
import { getAllPillarsForDate } from '@/lib/ai/pillarSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  // Tomorrow in UTC — the generate cron creates posts dated +1 day.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(
    Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate()),
  );
  const dayAfter = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);

  const activePages = await db
    .select()
    .from(pages)
    .where(eq(pages.active, true));

  type Report = {
    pageName: string;
    pageId: string;
    expected: number;
    got: number;
    missingSlots: string[];
  };
  const reports: Report[] = [];

  for (const page of activePages) {
    const brandKit = page.brandKit as BrandKit;
    const expectedSlots = getAllPillarsForDate(tomorrow, brandKit).filter((s) => !!s.pillar);
    const got = await db
      .select({ scheduledAt: posts.scheduledAt })
      .from(posts)
      .where(
        and(
          eq(posts.channel, 'page'),
          eq(posts.pageId, page.id),
          gte(posts.scheduledAt, tomorrowStart),
          lt(posts.scheduledAt, dayAfter),
        ),
      );

    // Match by HH:mm of each post's scheduled_at against expected slots.
    const gotSlots = new Set(
      got
        .map((p) => p.scheduledAt)
        .filter((d): d is Date => d instanceof Date)
        .map((d) =>
          // toLocaleTimeString in IL TZ for HH:mm comparison.
          d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }),
        ),
    );
    const missingSlots = expectedSlots
      .map((s) => s.slot)
      .filter((s) => !gotSlots.has(s));

    reports.push({
      pageName: page.pageName,
      pageId: page.id,
      expected: expectedSlots.length,
      got: got.length,
      missingSlots,
    });
  }

  const broken = reports.filter((r) => r.missingSlots.length > 0);
  if (broken.length > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
    const lines: string[] = [];
    lines.push(`⚠️ פוסטים חסרים למחר (${tomorrowStart.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })}):`);
    for (const r of broken) {
      lines.push(
        `• ${r.pageName}: יש ${r.got}/${r.expected}. חסר: ${r.missingSlots.join(', ')}`,
      );
    }
    lines.push('');
    lines.push(`רענן ידנית ב: ${baseUrl}/page/queue`);
    lines.push(
      `או הרץ backfill: curl -H "Authorization: Bearer $CRON_SECRET" "${baseUrl}/api/cron/generate?slot=10:00&date=${tomorrowStart.toISOString().slice(0, 10)}"`,
    );
    await notifyOwner(lines.join('\n'));
  }

  return Response.json({
    ok: true,
    tomorrow: tomorrowStart.toISOString(),
    reports,
    notified: broken.length > 0,
  });
}
// Keep drizzleSql referenced.
void drizzleSql;
