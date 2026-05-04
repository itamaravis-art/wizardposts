// GET    /api/shortlinks/:id   — full drilldown for a parent shortlink
// DELETE /api/shortlinks/:id   — soft-delete (sets is_active=false)

import { NextResponse } from 'next/server';
import { getUserId, handleRouteError, HttpError } from '../../_lib/route-helpers';
import {
  getParentShortlinkForUser,
  getPerGroupClicksForParent,
  getParentTotals,
  getRecentClicksForParent,
  setShortlinkActive,
} from '@/lib/db/queries/shortlinks';
import { shortlinkUrl } from '@/lib/shortlinks/urls';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;

    const parent = await getParentShortlinkForUser(userId, id);
    if (!parent) throw new HttpError(404, 'Shortlink not found');

    const [totals, perGroup, recent] = await Promise.all([
      getParentTotals(userId, id),
      getPerGroupClicksForParent(userId, id),
      getRecentClicksForParent(userId, id, 50),
    ]);

    return NextResponse.json({
      shortlink: {
        id: parent.id,
        slug: parent.slug,
        url: shortlinkUrl(parent.slug),
        target_url: parent.targetUrl,
        label: parent.label,
        is_active: parent.isActive,
        created_at: parent.createdAt,
      },
      totals,
      per_group: perGroup.map((r) => ({
        group_id: r.groupId,
        group_name: r.groupName,
        group_url: r.groupUrl,
        child_slug: r.childSlug,
        posts_count: r.postsCount,
        total_clicks: r.totalClicks,
        unique_clickers: r.uniqueClickers,
        bot_clicks: r.botClicks,
      })),
      recent_clicks: recent.map((r) => ({
        clicked_at: r.clickedAt,
        is_bot: r.isBot,
        device_type: r.deviceType,
        country: r.country,
        referrer: r.referrer,
        group_name: r.groupName,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const ok = await setShortlinkActive(userId, id, false);
    if (!ok) throw new HttpError(404, 'Shortlink not found');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
