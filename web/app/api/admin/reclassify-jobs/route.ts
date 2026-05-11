/**
 * Admin endpoint: re-classify "success" jobs by feeding their saved
 * screenshots to GPT-4o vision. The old worker marked everything as
 * "Posted successfully" without checking for FB's "pending moderator
 * approval" toast — this catches up retroactively.
 *
 * Body: { campaignId?: string, limit?: number }
 *   - campaignId: only re-classify jobs from this campaign (else all
 *     of the requesting user's running campaigns).
 *   - limit: cap how many we send to vision in one call. Default 30.
 *
 * Auth: CRON_SECRET.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import { db } from '@/lib/db';
import { jobs, groups, campaigns } from '@/lib/db/schema';
import { and, eq, isNotNull, sql as drizzleSql } from 'drizzle-orm';
import { getOpenAI } from '@/lib/ai/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  campaignId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(60).default(30),
});

interface VisionVerdict {
  classification: 'posted' | 'pending_mod' | 'failed' | 'unclear';
  evidence: string;
}

const sysPrompt = [
  'You are looking at a post-submit screenshot from a Facebook group.',
  'A worker bot just clicked "Post". Your job: tell whether the post',
  'is actually visible in the group feed, OR sitting in the moderator',
  'approval queue, OR was rejected.',
  '',
  'Decide ONE of:',
  '  - "posted": the post is visible in the feed (you can see the bot',
  '    user\'s name/avatar attached to a fresh post in the feed area).',
  '  - "pending_mod": there is a TOAST/NOTICE near a corner saying',
  '    something like "Your post: It\'s been submitted to group admins',
  '    for review/approval", "ממתין לאישור", "אישור מנהל".',
  '  - "failed": there is an error toast or blocker (login wall,',
  '    captcha, "post couldn\'t be sent", etc.).',
  '  - "unclear": none of the above are visible.',
  '',
  'Output STRICT JSON: { "classification": "posted|pending_mod|failed|unclear",',
  '                       "evidence": "<one short sentence saying what you saw>" }',
  'No markdown, no extra prose.',
].join('\n');

async function classify(
  url: string,
  openai: ReturnType<typeof getOpenAI>,
): Promise<VisionVerdict> {
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sysPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url, detail: 'low' } } as never,
          { type: 'text', text: 'Classify this screenshot.' } as never,
        ] as never,
      },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim() ?? '';
  try {
    const parsed = JSON.parse(text) as VisionVerdict;
    if (!['posted', 'pending_mod', 'failed', 'unclear'].includes(parsed.classification)) {
      return { classification: 'unclear', evidence: 'invalid response' };
    }
    return parsed;
  } catch {
    return { classification: 'unclear', evidence: text.slice(0, 120) };
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();
  const body = bodySchema.parse(await req.json());

  // Pull success jobs that have screenshots, optionally scoped to a campaign.
  const where = body.campaignId
    ? and(
        eq(jobs.campaignId, body.campaignId),
        eq(jobs.status, 'success'),
        isNotNull(jobs.screenshotPath),
      )
    : and(eq(jobs.status, 'success'), isNotNull(jobs.screenshotPath));

  const rows = await db
    .select({
      id: jobs.id,
      screenshotPath: jobs.screenshotPath,
      resultMessage: jobs.resultMessage,
      groupUrl: groups.url,
      campaignId: jobs.campaignId,
    })
    .from(jobs)
    .innerJoin(groups, eq(groups.id, jobs.groupId))
    .innerJoin(campaigns, eq(campaigns.id, jobs.campaignId))
    .where(where)
    .limit(body.limit);

  if (rows.length === 0) {
    return Response.json({ ok: true, processed: 0, message: 'No success+screenshot jobs found' });
  }

  const openai = getOpenAI();

  // Vision calls are independent — fire them all in parallel. Each takes
  // ~1.5-3s; at 30 images that's still ~3-5s wall time, well under the
  // 60s function ceiling. DB writes also parallelize.
  const results = await Promise.all(
    rows.map(async (r) => {
      if (!r.screenshotPath) {
        return {
          jobId: r.id,
          classification: 'error',
          evidence: 'no screenshot',
          updated: false,
        };
      }
      try {
        const verdict = await classify(r.screenshotPath, openai);
        let newMessage: string | null = null;
        if (verdict.classification === 'pending_mod') {
          newMessage = `Pending moderator approval (vision: ${verdict.evidence.slice(0, 100)})`;
        } else if (verdict.classification === 'failed') {
          newMessage = `Failed silently (vision: ${verdict.evidence.slice(0, 100)})`;
        } else if (verdict.classification === 'posted') {
          newMessage = `Posted successfully (vision-verified: ${verdict.evidence.slice(0, 80)})`;
        }
        if (newMessage) {
          await db
            .update(jobs)
            .set({ resultMessage: newMessage })
            .where(eq(jobs.id, r.id));
        }
        return {
          jobId: r.id,
          classification: verdict.classification,
          evidence: verdict.evidence.slice(0, 120),
          updated: !!newMessage,
        };
      } catch (err) {
        return {
          jobId: r.id,
          classification: 'error',
          evidence: (err as Error).message.slice(0, 120),
          updated: false,
        };
      }
    }),
  );

  const summary = results.reduce(
    (acc, r) => {
      acc[r.classification] = (acc[r.classification] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return Response.json({
    ok: true,
    processed: results.length,
    summary,
    results,
  });
}
// Keep drizzleSql referenced to silence unused-import linter on the import line.
void drizzleSql;
