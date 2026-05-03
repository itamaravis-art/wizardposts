// POST /api/campaigns/:id/pause — running -> paused.
import { lifecycleHandler } from '../../../_lib/campaign-lifecycle';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return lifecycleHandler(id, 'paused', ['running']);
}
