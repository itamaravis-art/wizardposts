// POST /api/campaigns/:id/cancel — anything but already-terminal -> cancelled.
import { lifecycleHandler } from '../../../_lib/campaign-lifecycle';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return lifecycleHandler(id, 'cancelled', [
    'draft',
    'running',
    'paused',
    'error',
  ]);
}
