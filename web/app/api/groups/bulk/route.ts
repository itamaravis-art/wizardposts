// Bulk-import groups by URL list. Dedupes input, validates the URL shape,
// and reports counts of created / skipped / invalid.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { bulkCreateGroupsForUser } from '@/lib/db/queries/groups';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';

const FB_GROUP_FRAGMENT = 'facebook.com/groups/';
function isValidGroupUrl(url: string): boolean {
  return typeof url === 'string' && url.includes(FB_GROUP_FRAGMENT);
}

const bulkSchema = z.object({
  urls: z.array(z.string()).min(1).max(1000),
  tag: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserId();
    const body = bulkSchema.parse(await req.json());

    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of body.urls) {
      const u = raw.trim();
      if (u.length === 0 || seen.has(u)) continue;
      seen.add(u);
      cleaned.push(u);
    }
    const valid = cleaned.filter(isValidGroupUrl);
    const invalid = cleaned.length - valid.length;

    const inputs = valid.map((url) => ({ url, tag: body.tag ?? null }));
    const { created, skipped } = await bulkCreateGroupsForUser(userId, inputs);

    return NextResponse.json({ created, skipped, invalid }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
