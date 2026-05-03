// User-scoped posts: list + create.
//
// Image upload is a separate two-step flow:
//   1. Client POSTs the file to /api/posts/upload (multipart) → gets back imageUrl
//   2. Client POSTs the metadata here with { text, imageUrl? }
// This keeps the JSON-only path edge-runtime-friendly.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listPostsForUser,
  createPostForUser,
} from '@/lib/db/queries/posts';
import { getUserId, handleRouteError } from '../_lib/route-helpers';

export const runtime = 'nodejs';

const createSchema = z.object({
  text: z.string().min(1).max(5000),
  imageUrl: z.string().url().nullable().optional(),
});

// GET /api/posts — list current user's posts (newest first, query layer's job).
export async function GET() {
  try {
    const userId = await getUserId();
    const posts = await listPostsForUser(userId);
    return NextResponse.json(posts);
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/posts — create a post. Image (if any) must already be uploaded.
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = createSchema.parse(await req.json());
    const post = await createPostForUser(userId, {
      text: body.text,
      imageUrl: body.imageUrl ?? null,
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
