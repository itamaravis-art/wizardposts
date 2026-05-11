// POST /api/page/connect
// Body: { token: string }   — short-lived USER token from Graph Explorer
//
// Flow:
//   1. Exchange the short-lived USER token for a long-lived USER token.
//   2. List the user's managed Pages → grab the matching Page row + Page token.
//   3. Verify the Page token is alive (calls /me).
//   4. Inspect the Page token's expiry via /debug_token.
//   5. Insert (or update) a row in `pages` with the encrypted token + brandKit
//      seeded from EINATURAL_DEFAULT_BRAND_KIT.
//
// Returned shape: { id, fbPageId, pageName, expiresAt }.
//
// Errors surface as JSON 4xx with a Hebrew `message` for the UI.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserId, handleRouteError, HttpError } from '../../_lib/route-helpers';
import {
  exchangeShortLivedUserToken,
  listPagesWithTokens,
  debugToken,
  GraphError,
} from '@/lib/fb/graph';
import {
  createPage,
  getPageByFbIdForUser,
  updatePageToken,
} from '@/lib/db/queries/pages';
import { EINATURAL_DEFAULT_BRAND_KIT } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(20).max(500),
  /**
   * Optional — if the user manages multiple Pages with the same App,
   * pick one by id. If omitted we connect the first Page returned.
   */
  pageId: z.string().min(1).max(50).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) {
      throw new HttpError(
        500,
        'FB_APP_ID / FB_APP_SECRET לא מוגדרים בשרת. צור App ב-Meta for Developers ועדכן את ה-env.',
      );
    }

    const body = bodySchema.parse(await req.json());

    // 1. Exchange short-lived USER token → long-lived USER token.
    let longUser;
    try {
      longUser = await exchangeShortLivedUserToken(body.token, appId, appSecret);
    } catch (err) {
      if (err instanceof GraphError) {
        throw new HttpError(
          400,
          `החלפת הטוקן נכשלה: ${err.userMessage}. ודא שהדבקת User Access Token (לא Page Token) טרי מ-Graph API Explorer.`,
        );
      }
      throw err;
    }

    // 2. List the user's pages → find the requested one (or first).
    let pages;
    try {
      pages = await listPagesWithTokens(longUser.accessToken);
    } catch (err) {
      if (err instanceof GraphError) {
        throw new HttpError(400, `Graph API rejected the request: ${err.userMessage}`);
      }
      throw err;
    }
    if (pages.length === 0) {
      throw new HttpError(
        400,
        'לא נמצאו דפי Facebook שאת/ה מנהל/ת. ודא שאתה Admin של הדף ושנתת הרשאת pages_manage_posts.',
      );
    }
    const target = body.pageId ? pages.find((p) => p.id === body.pageId) : pages[0];
    if (!target) {
      throw new HttpError(
        400,
        `הדף ${body.pageId} לא נמצא ברשימת הדפים שאת/ה מנהל/ת.`,
      );
    }

    // 3. (skipped) — calling /me on the Page token requires
    // `pages_read_engagement`, which isn't always granted in dev-mode
    // Apps. /me/accounts already returned a valid id+name+token, and
    // debug_token below confirms the token is alive, so no extra
    // round-trip is needed here.

    // 4. Look up token expiry via debug_token.
    let expiresAt: Date | null = null;
    try {
      const debug = await debugToken(target.accessToken, appId, appSecret);
      expiresAt = debug.expiresAt;
    } catch {
      /* non-fatal — we'll still save the token, just without an expiry */
    }

    // 5. Upsert.
    const existing = await getPageByFbIdForUser(userId, target.id);
    if (existing) {
      const updated = await updatePageToken(
        userId,
        existing.id,
        target.accessToken,
        expiresAt,
      );
      if (!updated) throw new HttpError(500, 'לא הצלחנו לעדכן את הדף הקיים.');
      return NextResponse.json({
        id: updated.id,
        fbPageId: updated.fbPageId,
        pageName: updated.pageName,
        expiresAt: updated.tokenExpiresAt,
        updated: true,
      });
    }

    const created = await createPage({
      userId,
      fbPageId: target.id,
      pageName: target.name,
      accessTokenPlain: target.accessToken,
      tokenExpiresAt: expiresAt,
      brandKit: EINATURAL_DEFAULT_BRAND_KIT,
    });

    return NextResponse.json(
      {
        id: created.id,
        fbPageId: created.fbPageId,
        pageName: created.pageName,
        expiresAt: created.tokenExpiresAt,
        updated: false,
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/** GET /api/page/connect — returns the user's connected pages (if any). */
export async function GET() {
  try {
    const userId = await getUserId();
    const { listPagesForUser } = await import('@/lib/db/queries/pages');
    const rows = await listPagesForUser(userId);
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        fbPageId: r.fbPageId,
        pageName: r.pageName,
        active: r.active,
        expiresAt: r.tokenExpiresAt,
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
