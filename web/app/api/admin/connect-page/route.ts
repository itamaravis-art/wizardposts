/**
 * Admin endpoint: connect or reconnect a Facebook Page given a User
 * Access Token + a target fbPageId. Bypasses NextAuth (uses
 * CRON_SECRET) so we can refresh page tokens after re-issuing them in
 * Graph Explorer without going through the UI.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import {
  exchangeShortLivedUserToken,
  listPagesWithTokens,
  debugToken,
  GraphError,
} from '@/lib/fb/graph';
import { db } from '@/lib/db';
import { pages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  token: z.string().min(20).max(500),
  pageFbId: z.string().min(1).max(50),
});

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const body = bodySchema.parse(await req.json());
  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    return Response.json(
      { ok: false, error: 'FB_APP_ID/FB_APP_SECRET not set in Vercel runtime' },
      { status: 500 },
    );
  }

  try {
    const longUser = await exchangeShortLivedUserToken(body.token, appId, appSecret);
    const allPages = await listPagesWithTokens(longUser.accessToken);
    const target = allPages.find((p) => p.id === body.pageFbId);
    if (!target) {
      return Response.json(
        {
          ok: false,
          error: `Page ${body.pageFbId} not found in /me/accounts`,
          available: allPages.map((p) => ({ id: p.id, name: p.name })),
        },
        { status: 404 },
      );
    }

    let expiresAt: Date | null = null;
    try {
      const dbg = await debugToken(target.accessToken, appId, appSecret);
      expiresAt = dbg.expiresAt;
    } catch {
      /* non-fatal */
    }

    const updated = await db
      .update(pages)
      .set({
        accessToken: encrypt(target.accessToken),
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(pages.fbPageId, body.pageFbId))
      .returning({
        id: pages.id,
        fbPageId: pages.fbPageId,
        pageName: pages.pageName,
        tokenExpiresAt: pages.tokenExpiresAt,
      });

    return Response.json({
      ok: true,
      updated: updated.length,
      page: updated[0] ?? null,
    });
  } catch (err) {
    if (err instanceof GraphError) {
      return Response.json(
        { ok: false, error: err.userMessage, status: err.status, metaCode: err.metaCode },
        { status: err.status === 400 ? 400 : 502 },
      );
    }
    throw err;
  }
}
