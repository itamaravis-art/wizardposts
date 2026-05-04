// User-facing shortlink CRUD.
//
// GET  /api/shortlinks               — list this user's parent shortlinks
// POST /api/shortlinks               — create a parent shortlink
//
// Children (auto-generated per group at campaign time) are not exposed
// here — they're an internal detail of the click-attribution machinery.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../_lib/route-helpers';
import {
  createParentShortlink,
  listParentShortlinksForUser,
} from '@/lib/db/queries/shortlinks';
import { validateCustomSlug, validateTargetUrl } from '@/lib/shortlinks/slug';
import { shortlinkUrl } from '@/lib/shortlinks/urls';

export const runtime = 'nodejs';

const createSchema = z.object({
  targetUrl: z.string().min(1).max(2000),
  customSlug: z.string().max(30).optional().nullable(),
  label: z.string().max(120).optional().nullable(),
});

export async function GET() {
  try {
    const userId = await getUserId();
    const rows = await listParentShortlinksForUser(userId);
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        url: shortlinkUrl(r.slug),
        target_url: r.targetUrl,
        label: r.label,
        is_active: r.isActive,
        click_count: r.clickCount,
        bot_click_count: r.botClickCount,
        campaign_count: r.campaignCount,
        created_at: r.createdAt,
      })),
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = createSchema.parse(await req.json());

    const targetErr = validateTargetUrl(body.targetUrl);
    if (targetErr) throw new HttpError(400, targetErr);

    const customSlug = body.customSlug?.trim() || null;
    if (customSlug) {
      const slugErr = validateCustomSlug(customSlug);
      if (slugErr) throw new HttpError(400, slugErr);
    }

    try {
      const row = await createParentShortlink({
        userId,
        targetUrl: body.targetUrl.trim(),
        customSlug,
        label: body.label?.trim() || null,
      });
      return NextResponse.json(
        {
          id: row.id,
          slug: row.slug,
          url: shortlinkUrl(row.slug),
          target_url: row.targetUrl,
          label: row.label,
          is_active: row.isActive,
          click_count: row.clickCount,
          created_at: row.createdAt,
        },
        { status: 201 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg)) {
        throw new HttpError(409, 'הקישור הקצר הזה תפוס — בחר אחר');
      }
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
