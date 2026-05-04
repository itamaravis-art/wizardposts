/**
 * URL extraction + shortlink-aware text manipulation.
 *
 * The patterns here are deliberately strict on the host portion (the
 * domain we own) and loose on path/query — we want to catch every valid
 * shortlink the user might paste, while NOT matching arbitrary URLs
 * that happen to live on subpaths.
 */

/**
 * Match any URL the user might paste in a post. Used to find embedded
 * URLs we should track. Conservative — we don't want to grab a piece of
 * adjacent text.
 */
const URL_RE = /https?:\/\/[^\sא-ת"'<>(){}[\]]+/gi;

/**
 * The host we serve shortlinks from. Computed from env so dev / preview
 * / production all agree.
 */
export function shortlinkHost(): string {
  // Prefer explicit override (custom domain in the future).
  const override = process.env.NEXT_PUBLIC_SHORTLINK_HOST;
  if (override) return override.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Fallback to the Vercel URL.
  const vercel = process.env.NEXT_PUBLIC_BASE_URL;
  if (vercel) return vercel.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return 'wizardposts.vercel.app';
}

/**
 * Return the canonical shortlink URL for a slug.
 * Always https://, no trailing slash.
 */
export function shortlinkUrl(slug: string): string {
  return `https://${shortlinkHost()}/l/${slug}`;
}

/** Extract every absolute http(s) URL out of free text. */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_RE);
  if (!matches) return [];
  // Trim trailing punctuation that isn't typically part of a URL
  // (period at sentence end, comma, closing parens).
  return matches.map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
}

/**
 * Find every shortlink (matching our host + /l/<slug>) in `text`.
 * Returns deduplicated slugs.
 */
export function findShortlinkSlugs(text: string): string[] {
  if (!text) return [];
  const host = shortlinkHost().replace(/\./g, '\\.');
  const re = new RegExp(`https?://${host}/l/([a-zA-Z0-9_-]{3,30})`, 'gi');
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[1]!);
  }
  return Array.from(out);
}

/**
 * Replace every occurrence of `originalUrl` in `text` with `newUrl`.
 * String-based (not regex) so URL special characters are handled
 * literally. Stable for repeated calls.
 */
export function replaceUrl(text: string, originalUrl: string, newUrl: string): string {
  if (!text || !originalUrl || originalUrl === newUrl) return text;
  return text.split(originalUrl).join(newUrl);
}
