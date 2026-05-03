// Returns the currently logged-in user's profile + FB connection status.
// Used by the client shell to render avatar/name and gate features.

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getUserId, handleRouteError } from '../_lib/route-helpers';

export const runtime = 'nodejs';

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
    return NextResponse.json(row);
  } catch (err) {
    return handleRouteError(err);
  }
}
