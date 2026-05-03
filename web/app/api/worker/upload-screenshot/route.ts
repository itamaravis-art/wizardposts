// Workers upload screenshots (e.g. of a post that succeeded, or a captcha
// that blocked it). Stored under screenshots/<userId>/<timestamp>-<name>.

import { NextRequest, NextResponse } from 'next/server';
import { requireWorker } from '@/lib/auth/worker-auth';
import { supabaseAdmin } from '@/lib/storage';
import { handleRouteError, HttpError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STORAGE_BUCKET = 'screenshots';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireWorker(req);

    const form = await req.formData();
    const file = form.get('screenshot') ?? form.get('image');
    if (!(file instanceof File)) {
      throw new HttpError(
        400,
        'Missing "screenshot" file in form data',
      );
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

    const rawName = file.name || 'screenshot.png';
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
      throw new HttpError(500, `Upload failed: ${uploadErr.message}`);
    }

    const { data } = supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(objectPath);

    return NextResponse.json({ url: data.publicUrl, path: objectPath });
  } catch (err) {
    return handleRouteError(err);
  }
}
