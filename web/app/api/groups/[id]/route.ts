// PATCH/DELETE a single group. Ownership is verified by *ForUser queries.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  updateGroupForUser,
  deleteGroupForUser,
} from '@/lib/db/queries/groups';
import { getUserId, handleRouteError, toSnake } from '../../_lib/route-helpers';

function toGroupWire(g: Record<string, unknown>): Record<string, unknown> {
  const snake = toSnake<Record<string, unknown>>(g);
  return { ...snake, active: snake.active ? 1 : 0 };
}

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

// UI legitimately sends either `true/false` or `1/0` for `active` (the Group
// type is `0 | 1` but most call sites use a plain boolean). Coerce both.
const patchSchema = z
  .object({
    name: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
    active: z
      .union([z.boolean(), z.number().int().min(0).max(1)])
      .transform((v) => (typeof v === 'boolean' ? v : v === 1))
      .optional(),
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
    return NextResponse.json(toGroupWire(updated));
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
