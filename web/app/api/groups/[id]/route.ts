// PATCH/DELETE a single group. Ownership is verified by *ForUser queries.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  updateGroupForUser,
  deleteGroupForUser,
} from '@/lib/db/queries/groups';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const updated = await updateGroupForUser(userId, id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const userId = await getUserId();
    const { id } = await params;
    const deleted = await deleteGroupForUser(userId, id);
    if (!deleted) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
