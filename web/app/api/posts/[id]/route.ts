// Single-post GET/DELETE. Ownership is enforced by the *ForUser query layer
// (returns null/throws if the post doesn't belong to userId).

import { NextResponse } from 'next/server';
import {
  getPostForUser,
  deletePostForUser,
} from '@/lib/db/queries/posts';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const post = await getPostForUser(userId, id);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    return NextResponse.json(post);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const deleted = await deletePostForUser(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
