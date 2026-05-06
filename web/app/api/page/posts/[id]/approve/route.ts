// POST /api/page/posts/:id/approve
// Body: { selectedVariantIndex?: number, finalCaption: string }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../../../../_lib/route-helpers';
import { approvePagePost } from '@/lib/db/queries/pagePosts';

export const runtime = 'nodejs';

const bodySchema = z.object({
  selectedVariantIndex: z.number().int().min(0).max(10).optional(),
  finalCaption: z.string().min(1).max(5000),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const body = bodySchema.parse(await req.json());
    const updated = await approvePagePost(userId, id, body.finalCaption);
    if (!updated) {
      throw new HttpError(404, 'Post not found, not yours, or not pending');
    }
    return NextResponse.json({ ok: true, post: { id: updated.id, approvedAt: updated.approvedAt } });
  } catch (err) {
    return handleRouteError(err);
  }
}
