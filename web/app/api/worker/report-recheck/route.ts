/**
 * POST /api/worker/report-recheck
 *
 * Body: { jobId: uuid, screenshotUrl: string }
 *
 * The worker has just visited a group and snapped a fresh screenshot
 * to check whether a previously "Pending moderator approval" post is
 * now visible (admin approved) or still pending. We feed the new
 * screenshot to GPT-4o vision and update the job:
 *
 *   - posted     → result_message = "Posted (admin approved)" + classification verified
 *   - pending    → still pending — keep result_message as-is
 *   - rejected   → result_message = "Removed by admin / not visible"
 *   - unclear    → leave alone
 *
 * In all cases we set last_rechecked_at = NOW() so the next 6-hour
 * window kicks in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireWorker } from '@/lib/auth/worker-auth';
import { db } from '@/lib/db';
import { jobs, campaigns } from '@/lib/db/schema';
import { handleRouteError, HttpError } from '../../_lib/route-helpers';
import { getOpenAI } from '@/lib/ai/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const bodySchema = z.object({
  jobId: z.string().uuid(),
  screenshotUrl: z.string().url(),
});

interface Verdict {
  classification: 'posted' | 'still_pending' | 'rejected' | 'unclear';
  evidence: string;
}

const SYS_PROMPT = [
  'You are looking at a fresh screenshot of a Facebook group taken AFTER a',
  'bot user (Itamar Avisris) tried to post earlier today. The earlier',
  'attempt resulted in "Pending admin approval". This screenshot was taken',
  'now to check whether the admin has since approved the post.',
  '',
  'Decide ONE of:',
  '  - "posted": you can SEE a post by Itamar Avisris in the group feed',
  '    (his name + recent timestamp visible).',
  '  - "still_pending": there is a banner/notice saying the post is still',
  '    pending admin approval, OR the feed shows other posts but Itamar\'s',
  '    is absent (admin hasn\'t approved yet).',
  '  - "rejected": there is a notice that the post was removed/declined,',
  '    OR group access has been revoked.',
  '  - "unclear": none of the above can be determined from the image.',
  '',
  'Output strict JSON: {"classification":"posted|still_pending|rejected|unclear","evidence":"<one short sentence>"}',
  'No markdown.',
].join('\n');

async function classify(url: string): Promise<Verdict> {
  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    max_tokens: 200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYS_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url, detail: 'low' } } as never,
          { type: 'text', text: 'Classify this fresh screenshot.' } as never,
        ] as never,
      },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim() ?? '';
  try {
    const parsed = JSON.parse(text) as Verdict;
    if (!['posted', 'still_pending', 'rejected', 'unclear'].includes(parsed.classification)) {
      return { classification: 'unclear', evidence: 'invalid response' };
    }
    return parsed;
  } catch {
    return { classification: 'unclear', evidence: text.slice(0, 120) };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireWorker(req);
    const body = bodySchema.parse(await req.json());

    // Verify the job belongs to this worker's user.
    const [row] = await db
      .select({
        jobId: jobs.id,
        campaignUserId: campaigns.userId,
        currentMessage: jobs.resultMessage,
      })
      .from(jobs)
      .innerJoin(campaigns, eq(campaigns.id, jobs.campaignId))
      .where(eq(jobs.id, body.jobId))
      .limit(1);
    if (!row) throw new HttpError(404, 'job not found');
    if (row.campaignUserId !== userId) throw new HttpError(403, 'job belongs to another user');

    const verdict = await classify(body.screenshotUrl);

    let newMessage: string | null = null;
    if (verdict.classification === 'posted') {
      newMessage = `Posted (admin approved on recheck): ${verdict.evidence.slice(0, 100)}`;
    } else if (verdict.classification === 'rejected') {
      newMessage = `Removed by admin (recheck): ${verdict.evidence.slice(0, 100)}`;
    }
    // 'still_pending' / 'unclear' → leave message alone, just bump last_rechecked_at.

    await db
      .update(jobs)
      .set({
        ...(newMessage ? { resultMessage: newMessage } : {}),
        ...(body.screenshotUrl ? { screenshotPath: body.screenshotUrl } : {}),
        lastRecheckedAt: new Date(),
      })
      .where(and(eq(jobs.id, body.jobId)));

    return NextResponse.json({
      ok: true,
      classification: verdict.classification,
      evidence: verdict.evidence,
      updated: !!newMessage,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
