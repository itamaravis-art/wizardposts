/**
 * Slug generation + validation for the URL shortener.
 *
 * Auto slugs use a 56-char alphabet that omits the look-alikes 0/O, 1/l/I.
 * 6 chars × 56 = ~30B combinations — collisions vanishingly rare for any
 * realistic per-user shortlink count. Generation does collision-retry at
 * the DB layer just in case.
 *
 * Custom slugs accept a-z, A-Z, 0-9, dash, underscore, 3-30 chars,
 * not in the reserved set (which collides with our routes / health /
 * static asset paths).
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AUTO_LEN = 6;

/** Reserved slugs that would collide with site routes or asset paths. */
const RESERVED = new Set([
  'new',
  'api',
  'l',
  'health',
  'admin',
  'app',
  'www',
  'login',
  'signup',
  'signin',
  'auth',
  'dashboard',
  'campaigns',
  'groups',
  'posts',
  'logs',
  'settings',
  'connect',
  'worker',
  'shortlinks',
  'analytics',
  'static',
  'public',
  'favicon',
  'robots',
  'sitemap',
  'manifest',
  'help',
  'about',
  'privacy',
  'terms',
]);

/** Generate a fresh auto slug. */
export function autoSlug(len = AUTO_LEN): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Validate a custom slug. Returns null if valid, or an error message. */
export function validateCustomSlug(slug: string): string | null {
  if (typeof slug !== 'string') return 'הקישור הקצר חייב להיות טקסט';
  const trimmed = slug.trim();
  if (trimmed.length < 3) return 'הקישור הקצר חייב להיות לפחות 3 תווים';
  if (trimmed.length > 30) return 'הקישור הקצר ארוך מדי (מקסימום 30)';
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return 'הקישור הקצר יכול לכלול רק אותיות, ספרות, מקף וקו תחתון';
  }
  if (RESERVED.has(trimmed.toLowerCase())) {
    return 'הקישור הקצר הזה שמור — בחר אחר';
  }
  return null;
}

/** Validate a target URL. Returns null if valid, or an error message. */
export function validateTargetUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return 'נא להדביק כתובת';
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return 'הכתובת לא תקינה';
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return 'רק קישורי http או https נתמכים';
  }
  if (rawUrl.length > 2000) {
    return 'הכתובת ארוכה מדי';
  }
  return null;
}
