// Notify-pending — runs at 07:00 daily.
//
// Reminder ping to the owner: "you have N pending posts to approve
// before 09:30". Skipped if 0 pending. Also skipped if no OWNER_WHATSAPP
// env (notifyOwner handles that gracefully).

import { NextRequest } from 'next/server';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import { notifyOwner } from '@/lib/notifications/greenApi';
import { db } from '@/lib/db';
import { posts } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const [{ count }] = (await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(posts)
    .where(
      and(
        eq(posts.channel, 'page'),
        eq(posts.approvalStatus, 'pending'),
      ),
    )) as Array<{ count: number }>;

  if (count > 0) {
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
    await notifyOwner(
      `🌅 בוקר טוב!\nיש ${count} פוסטים שמחכים לאישור היום.\nאם לא יאושרו עד 09:30 — הם ידולגו.\n\nאישור: ${baseUrl}/page/queue`,
    );
  }

  return Response.json({ ok: true, pendingCount: count });
}
