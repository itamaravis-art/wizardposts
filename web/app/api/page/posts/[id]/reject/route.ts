// POST /api/page/posts/:id/reject — owner rejects, post never publishes.

import { NextRequest, NextResponse } from 'next/server';
import { getUserId, handleRouteError, HttpError } from '../../../../_lib/route-helpers';
import { rejectPagePost } from '@/lib/db/queries/pagePosts';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const updated = await rejectPagePost(userId, id);
    if (!updated) throw new HttpError(404, 'Post not found, not yours, or not pending');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
