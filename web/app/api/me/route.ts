// Returns the currently logged-in user's profile + FB connection status.
// Used by the client shell to render avatar/name and gate features.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getUserId, handleRouteError } from '../_lib/route-helpers';

export const runtime = 'nodejs';
// /connect polls this every 5s — fb_connected status must NEVER come from a cache.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const userId = await getUserId();

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        fbConnected: users.fbConnected,
        fbUserName: users.fbUserName,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    // UI consumes snake_case (`me.fb_connected`, `me.fb_user_name`); see
    // app/connect/page.tsx, app/onboarding/page.tsx etc. Convert at the
    // boundary so we don't have to rename Drizzle's column accessors.
    return NextResponse.json({
      id: row.id,
      email: row.email,
      name: row.name,
      image: row.image,
      fb_connected: row.fbConnected,
      fb_user_name: row.fbUserName,
      created_at: row.createdAt,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
