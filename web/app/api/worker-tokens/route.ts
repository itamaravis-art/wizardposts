// Worker token management for the logged-in user.
//
// Critical security invariant: the plain-text token value is generated here,
// hashed (bcrypt) before insert by the query layer, and returned to the
// client EXACTLY ONCE — on creation. After that, only the metadata (id,
// name, last_seen_at, created_at, revoked_at) is ever exposed. There is no
// recovery path if the user loses the token; they must create a new one.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import {
  listWorkerTokensForUser,
  createWorkerTokenForUser,
} from '@/lib/db/queries/workerTokens';
import { getUserId, handleRouteError } from '../_lib/route-helpers';

// Wire shape used by the /worker page. Note: DB column is `last_seen_at`
// (set on every authenticated worker request) but the UI calls it
// `last_used_at` — keep the public name stable while mapping under the hood.
function toTokenWire(
  t: {
    id: string;
    name: string;
    createdAt: Date;
    lastSeenAt: Date | null;
    revokedAt: Date | null;
  },
): {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
} {
  return {
    id: t.id,
    name: t.name,
    created_at: t.createdAt.toISOString(),
    last_used_at: t.lastSeenAt ? t.lastSeenAt.toISOString() : null,
    revoked_at: t.revokedAt ? t.revokedAt.toISOString() : null,
  };
}

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

// GET /api/worker-tokens — list metadata only (never the token).
export async function GET() {
  try {
    const userId = await getUserId();
    const tokens = await listWorkerTokensForUser(userId);
    return NextResponse.json(tokens.map(toTokenWire));
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/worker-tokens — issue a new token. Returns plaintext ONCE.
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = createSchema.parse(await req.json());

    // 32 bytes (256 bits) of entropy, base64url-encoded → 43 chars, URL-safe.
    // Prefix `wp_` so accidentally-leaked tokens can be grep'd / scanner-detected.
    const plain = `wp_${randomBytes(32).toString('base64url')}`;

    const created = await createWorkerTokenForUser(userId, {
      name: body.name,
      plainToken: plain,
    });

    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        created_at: created.createdAt.toISOString(),
        // Plain token — shown ONCE, never persisted in plaintext, never returned again.
        token: plain,
      },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
