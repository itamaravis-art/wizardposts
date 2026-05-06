/**
 * Create the `page-images` Supabase Storage bucket via SQL.
 *
 * Why SQL: Supabase Storage stores its bucket metadata in the
 * `storage.buckets` table, so we can create a bucket without going
 * through the dashboard UI. The actual file upload still goes through
 * the Storage API at runtime, but the bucket needs to exist first.
 *
 * Idempotent (uses ON CONFLICT). Safe to re-run.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const masked = url.replace(/(postgres(?:ql)?:\/\/[^:]+):[^@]+@/, '$1:****@');
console.log('Target:', masked);

const sql = postgres(url, { ssl: 'require', prepare: false, max: 1 });

const BUCKET_ID = 'page-images';

async function main() {
  // Check existing
  const before = await sql`
    SELECT id, name, public, created_at
    FROM storage.buckets
    WHERE id = ${BUCKET_ID}
  `;
  if (before.length > 0) {
    console.log('Bucket already exists:', before[0]);
    return;
  }

  // Create bucket as public-read.
  await sql`
    INSERT INTO storage.buckets (id, name, public)
    VALUES (${BUCKET_ID}, ${BUCKET_ID}, true)
  `;
  console.log(`✓ Created bucket "${BUCKET_ID}" (public read)`);

  // Public read RLS policy on storage.objects for this bucket. Without
  // this, even a public bucket might not serve images. The dashboard
  // sets this automatically when you tick "Public", but DDL doesn't.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'page-images public read'
      ) THEN
        CREATE POLICY "page-images public read"
        ON storage.objects FOR SELECT
        TO public
        USING (bucket_id = 'page-images');
      END IF;
    END$$
  `;
  console.log('✓ Public-read RLS policy on storage.objects');

  // Allow service role to write (it can already, but explicit policy
  // documents intent and helps if RLS is later tightened).
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'page-images service_role write'
      ) THEN
        CREATE POLICY "page-images service_role write"
        ON storage.objects FOR ALL
        TO service_role
        USING (bucket_id = 'page-images')
        WITH CHECK (bucket_id = 'page-images');
      END IF;
    END$$
  `;
  console.log('✓ Service-role write policy');

  // Verify
  const after = await sql`
    SELECT id, name, public, created_at
    FROM storage.buckets
    WHERE id = ${BUCKET_ID}
  `;
  console.log('\nBucket row:', after[0]);
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
    console.log('\nDone.');
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Failed:', err);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
