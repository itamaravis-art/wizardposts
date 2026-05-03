// Image upload for posts.
//
// Multipart in → Supabase Storage → public URL out. The upload path namespaces
// every object by userId so a leaked URL still can't be used to enumerate
// other users' images:
//   images/<userId>/<timestamp>-<filename>
//
// Node runtime is required: Edge runtime in Next 15 still has rough corners
// around `request.formData()` with large blobs.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage';
import { getUserId, handleRouteError, HttpError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const STORAGE_BUCKET = 'images';

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();

    const form = await req.formData();
    const file = form.get('image');
    if (!(file instanceof File)) {
      throw new HttpError(400, 'Missing "image" file in form data');
    }
    if (file.size === 0) {
      throw new HttpError(400, 'File is empty');
    }
    if (file.size > MAX_BYTES) {
      throw new HttpError(400, `File too large (max ${MAX_BYTES} bytes)`);
    }
    if (!ALLOWED_MIME.has(file.type)) {
      throw new HttpError(400, `Unsupported file type: ${file.type}`);
    }

    // Sanitize filename: strip path separators and any non-printable chars.
    // Even with userId namespacing, we don't trust client-supplied names.
    const rawName = file.name || 'upload';
    const safeName = rawName
      .replace(/[\\/]/g, '_')
      .replace(/[^\w.\-]/g, '_')
      .slice(0, 120);

    const objectPath = `${userId}/${Date.now()}-${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, arrayBuffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) {
      // Surface as 500 — caller retry is usually safe.
      throw new HttpError(500, `Upload failed: ${uploadErr.message}`);
    }

    const { data } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(objectPath);

    return NextResponse.json({ imageUrl: data.publicUrl, path: objectPath });
  } catch (err) {
    return handleRouteError(err);
  }
}
