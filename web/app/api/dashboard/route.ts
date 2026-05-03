// Aggregated dashboard payload — one request, everything the home page needs.
//
// All sub-queries are user-scoped via *ForUser variants. The query layer is
// expected to do the joins (jobs ↔ campaigns ↔ groups) so we don't pay an
// N+1 here.

import { NextResponse } from 'next/server';
import { getDashboardForUser } from '@/lib/db/queries/dashboard';
import { getUserId, handleRouteError } from '../_lib/route-helpers';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const userId = await getUserId();
    const data = await getDashboardForUser(userId);
    return NextResponse.json(data);
  } catch (err) {
    return handleRouteError(err);
  }
}
