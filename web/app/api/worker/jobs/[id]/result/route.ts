// Worker reports the outcome of a job it previously claimed.
//
// Side effects on top of marking the job:
//   - On success: increment posted counter, group success_count, last_posted_at
//   - On failure: increment group fail_count; if N consecutive failures, the
//     query helper will pause the campaign and set last_error
//   - Either way, emit a job event for any UI subscribers (SSE/WebSocket)
//
// Authorization: `recordJobResultForUser` must reject if the job is not in
// any of the user's campaigns OR if the job was claimed by a different token.
// That second check stops a malicious/buggy worker from "completing" a job
// that another worker is still processing.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorker } from '@/lib/auth/worker-auth';
import { recordJobResultForUser } from '@/lib/db/queries/jobs';
import {
  handleRouteError,
  HttpError,
} from '../../../../_lib/route-helpers';

export const runtime = 'nodejs';

const bodySchema = z.object({
  success: z.boolean(),
  message: z.string().max(2000).nullable().optional(),
  screenshotUrl: z.string().url().nullable().optional(),
  // Optional classification of the failure (e.g. "captcha", "rate_limited",
  // "checkpoint", "post_blocked"). The query helper uses this to decide
  // whether to pause the campaign.
  blockerKind: z.string().max(40).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { userId, tokenId } = await requireWorker(req);
    const { id } = await params;

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await req.json());
    } catch (e) {
      throw e;
    }

    const result = await recordJobResultForUser(userId, {
      jobId: id,
      tokenId,
      success: body.success,
      message: body.message ?? null,
      screenshotUrl: body.screenshotUrl ?? null,
      blockerKind: body.blockerKind ?? null,
    });

    if (!result) {
      throw new HttpError(404, 'Job not found or not claimed by this worker');
    }

    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
