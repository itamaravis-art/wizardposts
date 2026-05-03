// User-facing settings API. Backs the /settings page in the dashboard.
//
// GET   → current settings (and FB connection status)
// PATCH → update one or more safety defaults
//
// Both require an authenticated user session.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import {
  getUserSettings,
  updateUserSettings,
} from '@/lib/db/queries/settings';
import { handleRouteError } from '../_lib/route-helpers';

export const runtime = 'nodejs';

/**
 * Validation rules mirror the legacy desktop project's bounds so a campaign
 * built with these settings can never violate Facebook's anti-spam thresholds
 * by an order of magnitude.
 *
 *  - daily_cap         : 1..100        (FB tolerates ~50/day for warmed accounts)
 *  - min/max_delay_ms  : ≥ 60 000 ms   (anything tighter looks bot-like)
 *  - work hours        : 0..23, start < end
 *  - typing min/max    : ≥ 0,  min ≤ max
 */
const settingsPatchSchema = z
  .object({
    daily_cap: z.number().int().min(1).max(100).optional(),
    min_delay_ms: z.number().int().min(60_000).optional(),
    max_delay_ms: z.number().int().min(60_000).optional(),
    work_hours_start: z.number().int().min(0).max(23).optional(),
    work_hours_end: z.number().int().min(0).max(23).optional(),
    max_consecutive_fails: z.number().int().min(1).max(20).optional(),
    typing_min_ms: z.number().int().min(0).max(5_000).optional(),
    typing_max_ms: z.number().int().min(0).max(5_000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.min_delay_ms === undefined ||
      v.max_delay_ms === undefined ||
      v.min_delay_ms <= v.max_delay_ms,
    { message: 'min_delay_ms must be ≤ max_delay_ms' },
  )
  .refine(
    (v) =>
      v.work_hours_start === undefined ||
      v.work_hours_end === undefined ||
      v.work_hours_start < v.work_hours_end,
    { message: 'work_hours_start must be < work_hours_end' },
  )
  .refine(
    (v) =>
      v.typing_min_ms === undefined ||
      v.typing_max_ms === undefined ||
      v.typing_min_ms <= v.typing_max_ms,
    { message: 'typing_min_ms must be ≤ typing_max_ms' },
  );

export async function GET() {
  try {
    const user = await requireUser();
    const settings = await getUserSettings(user.id);
    return NextResponse.json({ settings });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const json = await req.json().catch(() => ({}));
    const patch = settingsPatchSchema.parse(json);
    const settings = await updateUserSettings(user.id, patch);
    return NextResponse.json({ settings });
  } catch (err) {
    return handleRouteError(err);
  }
}
