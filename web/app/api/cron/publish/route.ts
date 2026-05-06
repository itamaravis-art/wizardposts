// Publisher — runs every 5 minutes.
//
// For each post WHERE channel='page' AND approval_status='approved'
// AND scheduled_at <= now() AND fb_post_id IS NULL:
//   1. Decrypt the page's access token.
//   2. POST /{pageId}/photos with the image URL + caption.
//   3. On success: store fbPostId, mark approval_status='published'.
//   4. On failure: bumpRetryCount; >= 3 → mark 'failed' + WhatsApp alert.

import { NextRequest } from 'next/server';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import {
  listPostsReadyToPublish,
  bumpRetryCount,
  markPostFailed,
  markPostPublished,
} from '@/lib/db/queries/pagePosts';
import { getPageWithTokenForUser } from '@/lib/db/queries/pages';
import { publishPhoto, GraphError } from '@/lib/fb/graph';
import { addLog } from '@/lib/db/queries/logs';
import { notifyOwner } from '@/lib/notifications/greenApi';
import { db } from '@/lib/db';
import { pages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RETRIES = 3;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const ready = await listPostsReadyToPublish();
  const results: Array<{
    postId: string;
    ok: boolean;
    fbPostId?: string;
    error?: string;
    retried?: boolean;
    failedTerminally?: boolean;
  }> = [];

  for (const post of ready) {
    if (!post.pageId) {
      // page deleted under us — mark failed, move on
      await markPostFailed(post.id);
      results.push({ postId: post.id, ok: false, error: 'no-page', failedTerminally: true });
      continue;
    }
    if (!post.imageUrl) {
      await markPostFailed(post.id);
      results.push({ postId: post.id, ok: false, error: 'no-image', failedTerminally: true });
      continue;
    }

    // Look up the page directly (cron-internal — bypasses userId scoping
    // since we're system-driven and need the token).
    const [pageRow] = await db.select().from(pages).where(eq(pages.id, post.pageId)).limit(1);
    if (!pageRow) {
      await markPostFailed(post.id);
      results.push({ postId: post.id, ok: false, error: 'page-row-gone', failedTerminally: true });
      continue;
    }

    let token: string;
    try {
      token = decrypt(pageRow.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markPostFailed(post.id);
      results.push({ postId: post.id, ok: false, error: `decrypt-failed: ${msg}`, failedTerminally: true });
      continue;
    }

    try {
      const { postId: fbPostId } = await publishPhoto({
        pageId: pageRow.fbPageId,
        pageAccessToken: token,
        imageUrl: post.imageUrl,
        caption: post.text,
      });
      await markPostPublished(post.id, fbPostId);
      await addLog({
        userId: post.userId,
        level: 'info',
        source: 'page-publish-cron',
        message: 'published to FB Page',
        meta: { postId: post.id, pageId: post.pageId, fbPostId },
      }).catch(() => {});
      results.push({ postId: post.id, ok: true, fbPostId });
    } catch (err) {
      const msg =
        err instanceof GraphError
          ? `Graph[${err.status}/${err.metaCode ?? '-'}]: ${err.userMessage}`
          : err instanceof Error
            ? err.message
            : String(err);
      const newRetryCount = await bumpRetryCount(post.id);
      const terminal = newRetryCount >= MAX_RETRIES;
      if (terminal) {
        await markPostFailed(post.id);
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://wizardposts.vercel.app';
        await notifyOwner(
          `❌ פוסט נכשל ב-Facebook אחרי ${MAX_RETRIES} ניסיונות.\n\nשגיאה: ${msg.slice(0, 200)}\n\nהיומן: ${baseUrl}/logs`,
        );
      }
      await addLog({
        userId: post.userId,
        level: terminal ? 'error' : 'warn',
        source: 'page-publish-cron',
        message: terminal ? 'publish failed terminally' : 'publish failed, will retry',
        meta: {
          postId: post.id,
          pageId: post.pageId,
          retryCount: newRetryCount,
          error: msg,
        },
      }).catch(() => {});
      results.push({
        postId: post.id,
        ok: false,
        error: msg,
        retried: !terminal,
        failedTerminally: terminal,
      });
    }
  }

  return Response.json({
    ok: true,
    consideredCount: ready.length,
    publishedCount: results.filter((r) => r.ok).length,
    failedTerminallyCount: results.filter((r) => r.failedTerminally).length,
    retriedCount: results.filter((r) => r.retried).length,
    results,
  });
}
