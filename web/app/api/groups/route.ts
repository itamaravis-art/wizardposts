// User-scoped groups: list with optional ?tag=&active= filters, and create one.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listGroupsForUser,
  createGroupForUser,
} from '@/lib/db/queries/groups';
import {
  getUserId,
  handleRouteError,
  HttpError,
} from '../_lib/route-helpers';

export const runtime = 'nodejs';

const FB_GROUP_FRAGMENT = 'facebook.com/groups/';

function isValidGroupUrl(url: string): boolean {
  return typeof url === 'string' && url.includes(FB_GROUP_FRAGMENT);
}

const createSchema = z.object({
  url: z.string().min(1),
  name: z.string().nullable().optional(),
  tag: z.string().nullable().optional(),
});

// GET /api/groups?tag=foo&active=1
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(req.url);
    const tagParam = searchParams.get('tag');
    const activeParam = searchParams.get('active');

    const tag = tagParam && tagParam.length > 0 ? tagParam : undefined;
    const activeOnly =
      typeof activeParam === 'string' &&
      ['1', 'true', 'yes'].includes(activeParam.toLowerCase());

    const groups = await listGroupsForUser(userId, { tag, activeOnly });
    return NextResponse.json(groups);
  } catch (err) {
    return handleRouteError(err);
  }
}

// POST /api/groups — create one group. UNIQUE (user_id, url) → 409 on dupe.
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = createSchema.parse(await req.json());
    if (!isValidGroupUrl(body.url)) {
      throw new HttpError(
        400,
        'Invalid Facebook group URL (must contain facebook.com/groups/)',
      );
    }
    try {
      const group = await createGroupForUser(userId, {
        url: body.url,
        name: body.name ?? null,
        tag: body.tag ?? null,
      });
      return NextResponse.json(group, { status: 201 });
    } catch (e) {
      // Postgres unique-violation surfaces with code '23505' on the underlying
      // error. Drizzle re-throws it as-is on `postgres-js`.
      const code = (e as { code?: string })?.code;
      const msg = e instanceof Error ? e.message : String(e);
      if (code === '23505' || /unique/i.test(msg)) {
        throw new HttpError(409, 'Group URL already exists for this user');
      }
      throw e;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
