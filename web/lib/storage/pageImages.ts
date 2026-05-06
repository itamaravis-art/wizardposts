/**
 * Supabase Storage helper for AI-generated page images.
 *
 * The bucket (`page-images` by default — overridable via
 * SUPABASE_PAGE_IMAGES_BUCKET) is created manually with PUBLIC READ
 * so Graph API can fetch the image when we publish a post.
 *
 * One file per post: `{pageId}/{postId}.png`. Re-upload overwrites
 * (used when the user clicks "regenerate image" in the queue UI).
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = process.env.SUPABASE_PAGE_IMAGES_BUCKET ?? 'page-images';

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for page-image upload',
    );
  }
  client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  return client;
}

export async function uploadPageImage(opts: {
  pageId: string;
  postId: string;
  buffer: Buffer;
  contentType?: string;
}): Promise<string> {
  const supabase = getClient();
  const path = `${opts.pageId}/${opts.postId}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, opts.buffer, {
    contentType: opts.contentType ?? 'image/png',
    upsert: true,
  });
  if (error) {
    throw new Error(`uploadPageImage failed: ${error.message}`);
  }
  // Public URL — bucket must be set to public read in Supabase Storage UI.
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
