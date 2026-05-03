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

// POST /api/posts — create a post. Accepts EITHER:
//   1. application/json: { text, imageUrl? }
//   2. multipart/form-data: text + optional image file (uploaded inline)
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const contentType = req.headers.get('content-type') || '';

    let text: string;
    let imageUrl: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const fd = await req.formData();
      const t = fd.get('text');
      if (typeof t !== 'string') {
        return NextResponse.json({ error: 'text is required' }, { status: 400 });
      }
      text = t;
      const image = fd.get('image');
      if (image && image instanceof File && image.size > 0) {
        const { uploadImage } = await import('@/lib/storage');
        imageUrl = await uploadImage(userId, image, image.name || 'image.jpg');
      }
    } else {
      const body = createSchema.parse(await req.json());
      text = body.text;
      imageUrl = body.imageUrl ?? null;
    }

    const post = await createPostForUser(userId, { text, imageUrl });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
