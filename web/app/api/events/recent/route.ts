// Returns recent events for seeding the dashboard live feed.
// Stub: returns an empty array. Real-time events arrive via /api/events/stream.

import { NextResponse } from 'next/server';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await getUserId();
    return NextResponse.json([]);
  } catch (err) {
    return handleRouteError(err);
  }
}
