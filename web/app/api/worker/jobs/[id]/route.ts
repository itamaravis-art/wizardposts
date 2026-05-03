// PATCH /api/worker/jobs/:id — worker reports job outcome.
//
// The worker's api-client (worker/src/api-client.ts) talks to this exact path
// + method. We also keep /api/worker/jobs/:id/result (POST) for backwards
// compatibility with older worker builds and any test scripts that target it.
//
// Body shape (matches `ReportResultPayload` in worker/src/api-client.ts):
//   { success: boolean, message: string, screenshotUrl?: string, blockerKind?: string }

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireWorker } from '@/lib/auth/worker-auth';
import { recordJobResultForUser } from '@/lib/db/queries/jobs';
import {
  handleRouteError,
  HttpError,
} from '../../../_lib/route-helpers';

export const runtime = 'nodejs';

const bodySchema = z.object({
  success: z.boolean(),
  message: z.string().max(2000).nullable().optional(),
  screenshotUrl: z.string().url().nullable().optional(),
  blockerKind: z.string().max(40).nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { userId, tokenId } = await requireWorker(req);
    const { id } = await params;
    const body = bodySchema.parse(await req.json());

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
