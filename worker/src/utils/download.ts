// Downloads a remote URL (typically a signed Supabase Storage URL) into the
// worker's local TEMP_DIR and returns the absolute path.

import fs from 'node:fs';
import path from 'node:path';
import { TEMP_DIR } from './paths.js';
import { logger } from './logger.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  // Short videos — uploaded via the same `imagePath` slot in poster.ts;
  // Playwright's setInputFiles doesn't care about the extension as long
  // as the content matches FB's accept filter.
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
};

function safeRandomBase(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferExt(url: string, contentType: string | null): string {
  if (contentType) {
    const norm = contentType.split(';', 1)[0]!.trim().toLowerCase();
    if (EXT_BY_MIME[norm]) return EXT_BY_MIME[norm]!;
  }
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.(jpe?g|png|webp|gif|mp4|mov|webm|m4v)$/i);
    if (m) return `.${m[1]!.toLowerCase().replace('jpeg', 'jpg')}`;
  } catch {
    /* ignore */
  }
  return '.img';
}

/**
 * Download `url` to TEMP_DIR. Returns absolute path on success; throws on failure.
 */
export async function downloadImageToTemp(url: string): Promise<string> {
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        logger.warn(
          { status: res.status, body: body.slice(0, 500), attempt },
          'download: non-OK response',
        );
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`download: ${res.status} (non-retriable)`);
        }
        lastErr = new Error(`download: ${res.status}`);
      } else {
        const ext = inferExt(url, res.headers.get('content-type'));
        const dest = path.join(TEMP_DIR, `${safeRandomBase()}${ext}`);
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.promises.writeFile(dest, buf);
        return dest;
      }
    } catch (err) {
      lastErr = err;
      logger.warn(
        { attempt, err: err instanceof Error ? err.message : String(err) },
        'download: error, will retry',
      );
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * Math.pow(3, attempt - 1)));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error('download: failed after retries');
}

export function safeUnlink(filePath: string | null | undefined): void {
  if (!filePath) return;
  fs.promises
    .unlink(filePath)
    .catch((err) => logger.debug({ err, filePath }, 'safeUnlink: ignored'));
}
