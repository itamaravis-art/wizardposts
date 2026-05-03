// Read-only logs endpoint. Writes go through dbLog on the server side.
// Optional filters: ?limit=&level=&source=

import { NextRequest, NextResponse } from 'next/server';
import { listLogsForUser } from '@/lib/db/queries/logs';
import {
  getUserId,
  handleRouteError,
  HttpError,
  toSnake,
} from '../_lib/route-helpers';

export const runtime = 'nodejs';

const ALLOWED_LEVELS = new Set(['info', 'warn', 'error'] as const);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserId();
    const { searchParams } = new URL(req.url);

    const rawLimit = searchParams.get('limit');
    const limit = rawLimit
      ? Math.min(
          Math.max(1, Math.floor(Number(rawLimit))),
          MAX_LIMIT,
        )
      : DEFAULT_LIMIT;
    if (rawLimit && !Number.isFinite(Number(rawLimit))) {
      throw new HttpError(400, 'limit must be a number');
    }

    const levelParam = searchParams.get('level');
    if (levelParam && !ALLOWED_LEVELS.has(levelParam as 'info')) {
      throw new HttpError(400, 'level must be one of: info, warn, error');
    }

    const sourceParam = searchParams.get('source');
    const source = sourceParam && sourceParam.length > 0 ? sourceParam : undefined;

    const logs = await listLogsForUser(userId, {
      limit,
      level: (levelParam ?? undefined) as 'info' | 'warn' | 'error' | undefined,
      source,
    });
    // Logs page reads `l.created_at` — return snake_case wire shape.
    return NextResponse.json(toSnake(logs));
  } catch (err) {
    return handleRouteError(err);
  }
}
