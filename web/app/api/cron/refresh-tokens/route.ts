// Refresh-tokens — runs at 03:00 daily.
//
// For every active page whose Page Access Token expires within 7 days:
//   1. Use debug_token to verify it's still valid.
//   2. If valid: skip (Page tokens derived from a long-lived USER token
//      are typically permanent; we can't refresh without a new USER token).
//   3. If invalid: mark page inactive + notify owner so they re-connect.
//
// The plan calls for actual refresh, but Meta's flow requires a fresh
// short-lived USER token from the owner (we don't have a stored
// refresh credential). Best we can do without owner intervention is
// to detect and notify — which is what this does.

import { NextRequest } from 'next/server';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import {
  listPagesNeedingRefresh,
  setPageActive,
} from '@/lib/db/queries/pages';
import { debugToken } from '@/lib/fb/graph';
import { addLog } from '@/lib/db/queries/logs';
import { notifyOwner } from '@/lib/notifications/greenApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const appId = process.env.FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    return Response.json({ ok: false, error: 'FB_APP_ID/SECRET not set' }, { status: 500 });
  }

  const expiringSoon = await listPagesNeedingRefresh(7);
  const results: Array<{
    pageId: string;
    pageName: string;
    isValid: boolean;
    expiresAt: Date | null;
  }> = [];

  for (const page of expiringSoon) {
    let inspection;
    try {
      inspection = await debugToken(page.accessTokenPlain, appId, appSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await addLog({
        userId: page.userId,
        level: 'warn',
        source: 'page-refresh-cron',
        message: 'debug_token call failed',
        meta: { pageId: page.id, error: msg },
      }).catch(() => {});
      continue;
    }
    results.push({
      pageId: page.id,
      pageName: page.pageName,
      isValid: inspection.isValid,
      expiresAt: inspection.expiresAt,
    });

    if (!inspection.isValid) {
      await setPageActive(page.userId, page.id, false);
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
      await notifyOwner(
        `⚠️ הטוקן של דף ${page.pageName} פג תוקף.\nהדף הושבת.\n\nלחיבור מחדש: ${baseUrl}/page/connect`,
      );
      await addLog({
        userId: page.userId,
        level: 'error',
        source: 'page-refresh-cron',
        message: 'token expired, page disabled',
        meta: { pageId: page.id },
      }).catch(() => {});
    }
  }

  return Response.json({ ok: true, checked: results.length, results });
}
