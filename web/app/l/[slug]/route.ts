// Public redirect endpoint for shortlinks: /l/<slug> → 302 → target_url.
//
// Runs on Node.js runtime (not edge) because we need the postgres-js
// driver and the existing drizzle DB client. Latency is still in the
// 100-400ms range from Frankfurt — fine for a redirect.
//
// Behaviour:
//   - Unknown slug → 404 plain text.
//   - Inactive parent → 410 Gone (so the user can revoke a leaked link).
//   - FB / IG / WA / LinkedIn / Twitter / Slack scraper UA → still 302
//     to target so they can fetch the target's OG meta tags for the
//     preview card, but we mark the click is_bot=true so it doesn't
//     pollute human counts in the dashboard.
//   - Everyone else → 302 to target, click counted, attribution recorded.
//
// All DB writes are best-effort and fire-and-forget (`void`d) so a slow
// or failed write never delays the redirect. Failures are swallowed at
// the query layer to keep the request hot path resilient.

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import {
  getShortlinkBySlug,
  bumpClickCount,
  recordClick,
} from '@/lib/db/queries/shortlinks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOT_RE =
  /(facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|Pinterestbot|redditbot|Applebot|Googlebot|bingbot|YandexBot|DuckDuckBot|baiduspider)/i;

function deviceTypeFrom(ua: string): string {
  if (/tablet|iPad/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function hashIp(ip: string): string {
  // Daily salt rotation keeps unique-visitor counts honest within a day
  // while preventing cross-day re-identification.
  const dailySalt = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${ip}:${dailySalt}`).digest('hex').slice(0, 32);
}

type GetCtx = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: GetCtx) {
  const { slug } = await params;

  const link = await getShortlinkBySlug(slug).catch(() => null);
  if (!link) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Inactive parent → refuse so a revoked link stops working. Children
  // inherit their parent's active flag at click time via the
  // getShortlinkBySlug query (which checks parent.is_active when this
  // is a child).
  if (!link.isActive) {
    return new NextResponse('This link has been disabled', { status: 410 });
  }

  const ua = req.headers.get('user-agent') ?? '';
  const isBot = BOT_RE.test(ua);

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0';

  // Vercel injects `request.geo` in middleware; on edge runtime it would
  // be available directly, but on Node runtime we can read the headers
  // Vercel sets even there.
  const country =
    req.headers.get('x-vercel-ip-country') ??
    req.headers.get('cf-ipcountry') ??
    null;

  const referrer = req.headers.get('referer') ?? null;

  // Fire-and-forget — never block the redirect on logging.
  void recordClick({
    shortlinkId: link.id,
    ipHash: hashIp(ip),
    userAgent: ua.slice(0, 200),
    country,
    deviceType: deviceTypeFrom(ua),
    referrer: referrer ? referrer.slice(0, 500) : null,
    isBot,
  }).catch(() => {});

  void bumpClickCount(link.id, isBot).catch(() => {});

  return NextResponse.redirect(link.targetUrl, 302);
}
