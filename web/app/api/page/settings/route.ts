// GET    /api/page/settings?pageId=...   — read brand kit + page metadata
// PATCH  /api/page/settings?pageId=...   — update brand kit (validated)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../../_lib/route-helpers';
import {
  getPageForUser,
  updatePageBrandKit,
} from '@/lib/db/queries/pages';
import { brandKitSchema, type BrandKit, PILLAR_LABELS } from '@/lib/ai/types';

export const runtime = 'nodejs';

function pageIdFrom(req: NextRequest): string {
  const id = req.nextUrl.searchParams.get('pageId');
  if (!id) throw new HttpError(400, 'pageId query param is required');
  return id;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    const id = pageIdFrom(req);
    const page = await getPageForUser(userId, id);
    if (!page) throw new HttpError(404, 'Page not found');
    return NextResponse.json({
      id: page.id,
      pageName: page.pageName,
      fbPageId: page.fbPageId,
      active: page.active,
      brandKit: page.brandKit as BrandKit,
      // Side-channel: surface human-readable pillar labels so the UI
      // doesn't need to import server-side constants.
      pillarLabels: PILLAR_LABELS,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const userId = await getUserId();
    const id = pageIdFrom(req);
    const body = await req.json();
    const brandKit = brandKitSchema.parse(body.brandKit ?? body);
    const updated = await updatePageBrandKit(userId, id, brandKit);
    if (!updated) throw new HttpError(404, 'Page not found');
    return NextResponse.json({ ok: true, brandKit: updated.brandKit });
  } catch (err) {
    return handleRouteError(err);
  }
}
