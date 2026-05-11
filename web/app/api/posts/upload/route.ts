// Image + short-video upload for posts.
//
// One multipart endpoint, two file kinds, decided by the file's MIME:
//   - image/* → bucket `images`, response { imageUrl, kind: 'image' }
//   - video/* → bucket `videos`, response { videoUrl, kind: 'video' }
//
// Field name accepted: 'file' (preferred), or 'image' / 'video' (legacy).
// The kind is detected from the file's MIME, not the field name, so a
// client that uses the old 'image' field name with a real video MIME
// still works.
//
// Node runtime is required: Edge runtime in Next 15 still has rough
// corners around `request.formData()` with large blobs.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/storage';
import { getUserId, handleRouteError, HttpError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';
// Videos can take longer to stream into Supabase than the default 10s.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB — FB accepts up to ~4 GB but >100 MB on Vercel-Hobby is risky
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
]);

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();

    const form = await req.formData();
    const file =
      form.get('file') ?? form.get('image') ?? form.get('video');
    if (!(file instanceof File)) {
      throw new HttpError(400, 'Missing file in form data (field "file" / "image" / "video")');
    }
    if (file.size === 0) {
      throw new HttpError(400, 'File is empty');
    }

    const isImage = ALLOWED_IMAGE_MIME.has(file.type);
    const isVideo = ALLOWED_VIDEO_MIME.has(file.type);
    if (!isImage && !isVideo) {
      throw new HttpError(
        400,
        `Unsupported file type: ${file.type}. Allowed images: ${[...ALLOWED_IMAGE_MIME].join(', ')}. Allowed videos: ${[...ALLOWED_VIDEO_MIME].join(', ')}.`,
      );
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > maxBytes) {
      throw new HttpError(
        400,
        `File too large (${Math.round(file.size / 1024 / 1024)} MB; max ${Math.round(maxBytes / 1024 / 1024)} MB for ${isVideo ? 'video' : 'image'})`,
      );
    }

    const rawName = file.name || (isVideo ? 'upload.mp4' : 'upload.jpg');
    const safeName = rawName
      .replace(/[\\/]/g, '_')
      .replace(/[^\w.\-]/g, '_')
      .slice(0, 120);

    const bucket = isVideo ? 'videos' : 'images';
    const objectPath = `${userId}/${Date.now()}-${safeName}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(bucket)
      .upload(objectPath, arrayBuffer, {
        contentType: file.type,
        cacheControl: '3600',
        upsert: false,
      });
    if (uploadErr) {
      throw new HttpError(500, `Upload failed: ${uploadErr.message}`);
    }

    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);
    const url = data.publicUrl;

    if (isVideo) {
      return NextResponse.json({
        kind: 'video',
        videoUrl: url,
        // Back-compat alias so the existing /posts/new fetcher that
        // reads `imageUrl` keeps working for video uploads. The post
        // schema accepts both and the worker prefers videoUrl when set.
        url,
        path: objectPath,
      });
    }
    return NextResponse.json({
      kind: 'image',
      imageUrl: url,
      url,
      path: objectPath,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
