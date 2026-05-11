/**
 * Supabase Storage helpers.
 *
 * Two buckets:
 *  - `images`      — public read; post images are embedded in posts and need
 *                    direct browser-accessible URLs.
 *  - `screenshots` — private; returned as time-limited signed URLs to the
 *                    owning user only.
 *
 * All env reads happen lazily inside `getClient()` / `getAdminClient()` so this
 * module is safe to import in places where env may not be loaded yet (e.g.
 * setup scripts, edge runtime probes).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/* Lazy clients                                                       */
/* ------------------------------------------------------------------ */

let _anonClient: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

function getAnonClient(): SupabaseClient {
  if (_anonClient) return _anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  _anonClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _anonClient;
}

function getAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  _adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

/**
 * Proxy exports — `supabase` and `supabaseAdmin` look like normal clients but
 * resolve env on first property access. Existing call sites can keep using
 * `supabaseAdmin.storage.from(...)` without change.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getAnonClient(), prop, receiver);
  },
});

export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getAdminClient(), prop, receiver);
  },
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const IMAGES_BUCKET = 'images';
const SCREENSHOTS_BUCKET = 'screenshots';
const VIDEOS_BUCKET = 'videos';

export type StorageBucket = 'images' | 'screenshots' | 'videos';

function sanitizeFilename(name: string): string {
  const lower = (name || 'file').toLowerCase();
  // Keep word chars, dot, dash; replace everything else with underscore.
  const cleaned = lower.replace(/[^\w.\-]/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

function buildObjectPath(userId: string, originalName: string): string {
  return `${userId}/${Date.now()}-${sanitizeFilename(originalName)}`;
}

async function toUploadBody(
  file: File | Buffer,
): Promise<{ body: ArrayBuffer | Buffer; contentType: string }> {
  if (Buffer.isBuffer(file)) {
    return { body: file, contentType: 'application/octet-stream' };
  }
  // Web `File`: has `.type` and `.arrayBuffer()`.
  const webFile = file as File;
  const ab = await webFile.arrayBuffer();
  return {
    body: ab,
    contentType: webFile.type || 'application/octet-stream',
  };
}

/**
 * Upload a public-read image. Returns the **public URL** (since the `images`
 * bucket is configured for public reads so post images render in feeds).
 */
export async function uploadImage(
  userId: string,
  file: File | Buffer,
  originalName: string,
): Promise<string> {
  const objectPath = buildObjectPath(userId, originalName);
  const { body, contentType } = await toUploadBody(file);

  const { error } = await getAdminClient()
    .storage.from(IMAGES_BUCKET)
    .upload(objectPath, body, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) throw new Error(`Image upload failed: ${error.message}`);

  const { data } = getAdminClient()
    .storage.from(IMAGES_BUCKET)
    .getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Upload a public-read short video. Same shape as `uploadImage` but a
 * dedicated bucket so MIME restrictions and CDN cache strategy can
 * diverge later (videos are much larger than images).
 */
export async function uploadVideo(
  userId: string,
  file: File | Buffer,
  originalName: string,
): Promise<string> {
  const objectPath = buildObjectPath(userId, originalName);
  const { body, contentType } = await toUploadBody(file);

  const { error } = await getAdminClient()
    .storage.from(VIDEOS_BUCKET)
    .upload(objectPath, body, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) throw new Error(`Video upload failed: ${error.message}`);

  const { data } = getAdminClient()
    .storage.from(VIDEOS_BUCKET)
    .getPublicUrl(objectPath);
  return data.publicUrl;
}

/**
 * Upload a private screenshot. Returns a **signed URL** valid for 1 hour
 * (screenshots may contain account UI / private content, so we never make the
 * bucket public).
 */
export async function uploadScreenshot(
  userId: string,
  file: File | Buffer,
  originalName: string,
): Promise<string> {
  const objectPath = buildObjectPath(userId, originalName);
  const { body, contentType } = await toUploadBody(file);

  const { error } = await getAdminClient()
    .storage.from(SCREENSHOTS_BUCKET)
    .upload(objectPath, body, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);

  const { data, error: signErr } = await getAdminClient()
    .storage.from(SCREENSHOTS_BUCKET)
    .createSignedUrl(objectPath, 60 * 60);
  if (signErr || !data?.signedUrl) {
    throw new Error(
      `Failed to sign screenshot URL: ${signErr?.message ?? 'no url returned'}`,
    );
  }
  return data.signedUrl;
}

/**
 * Get a fresh signed download URL for an existing object. Useful when the UI
 * needs to refresh expired screenshot links.
 */
export async function getSignedDownloadUrl(
  bucket: StorageBucket,
  path: string,
  expiresInSec = 60 * 60,
): Promise<string> {
  const { data, error } = await getAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSec);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign URL for ${bucket}/${path}: ${error?.message ?? 'no url returned'}`,
    );
  }
  return data.signedUrl;
}
