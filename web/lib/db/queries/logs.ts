import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index';
import { logs, type Log, type LogLevel } from '../schema';

export interface AddLogArgs {
  userId?: string | null;
  level: LogLevel;
  source: string;
  message: string;
  meta?: unknown;
}

export async function addLog(args: AddLogArgs): Promise<Log> {
  const [row] = await db
    .insert(logs)
    .values({
      userId: args.userId ?? null,
      level: args.level,
      source: args.source,
      message: args.message,
      meta: args.meta === undefined ? null : (args.meta as object),
    })
    .returning();
  if (!row) throw new Error('Failed to insert log');
  return row;
}

export interface ListLogsOpts {
  level?: LogLevel;
  source?: string;
  limit?: number;
}

export async function listLogsForUser(
  userId: string,
  opts: ListLogsOpts = {},
): Promise<Log[]> {
  const conditions = [eq(logs.userId, userId)];
  if (opts.level) conditions.push(eq(logs.level, opts.level));
  if (opts.source) conditions.push(eq(logs.source, opts.source));

  return db
    .select()
    .from(logs)
    .where(and(...conditions))
    .orderBy(desc(logs.createdAt))
    .limit(Math.min(opts.limit ?? 200, 1000));
}
