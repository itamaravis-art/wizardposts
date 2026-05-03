/**
 * Worker token queries.
 *
 * Plain token format: `wt_` + 32 random hex chars (16 random bytes).
 * Stored as a bcrypt hash, never plain. The plain token is returned to the
 * caller exactly once (at creation). On verification we hash-compare candidates
 * against the stored hashes.
 *
 * Because bcrypt produces a different hash for the same input every time, we
 * can't index on the hash alone — we must scan candidate rows. To keep this
 * cheap we scan only non-revoked rows; in practice token counts per user are
 * tiny (single digits).
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { workerTokens, type WorkerToken } from '../schema';

const TOKEN_PREFIX = 'wt_';
const BCRYPT_ROUNDS = 10;

function generatePlainToken(): string {
  return TOKEN_PREFIX + randomBytes(16).toString('hex');
}

export async function createWorkerToken(
  userId: string,
  name: string,
): Promise<{ token: WorkerToken; plainToken: string }> {
  const plainToken = generatePlainToken();
  const hash = await bcrypt.hash(plainToken, BCRYPT_ROUNDS);
  const [row] = await db
    .insert(workerTokens)
    .values({ userId, name, token: hash })
    .returning();
  if (!row) throw new Error('Failed to create worker token');
  return { token: row, plainToken };
}

export async function listTokensForUser(userId: string): Promise<WorkerToken[]> {
  return db
    .select()
    .from(workerTokens)
    .where(eq(workerTokens.userId, userId))
    .orderBy(workerTokens.createdAt);
}

export async function revokeToken(
  id: string,
  userId: string,
): Promise<WorkerToken | null> {
  const [row] = await db
    .update(workerTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(workerTokens.id, id), eq(workerTokens.userId, userId)))
    .returning();
  return row ?? null;
}

/**
 * Look up the user_id for a plain worker token.
 *
 * Returns `null` if no active token matches. Also bumps `last_seen_at` on the
 * matching token so the UI can show liveness.
 */
export async function getUserIdByToken(plainToken: string): Promise<{
  userId: string;
  tokenId: string;
} | null> {
  if (!plainToken) return null;
  // Accept any prefix (legacy wt_, current wp_) — bcrypt.compare is the real check.

  // Only consider non-revoked rows.
  const candidates = await db
    .select()
    .from(workerTokens)
    .where(isNull(workerTokens.revokedAt));

  for (const row of candidates) {
    // bcrypt.compare is constant-time per call.
    const ok = await bcrypt.compare(plainToken, row.token);
    if (ok) {
      // Touch last_seen_at — fire-and-forget would be tempting, but we await
      // to keep the query layer side-effect-explicit.
      await db
        .update(workerTokens)
        .set({ lastSeenAt: new Date() })
        .where(eq(workerTokens.id, row.id));
      return { userId: row.userId, tokenId: row.id };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Aliases — *ForUser naming used by the API layer.                   */
/* ------------------------------------------------------------------ */

export const listWorkerTokensForUser = listTokensForUser;

/**
 * API-layer variant: takes a pre-generated plain token from the caller
 * (so the route can return it once) and stores its bcrypt hash.
 */
export async function createWorkerTokenForUser(
  userId: string,
  input: { name: string; plainToken: string },
): Promise<WorkerToken> {
  const hash = await bcrypt.hash(input.plainToken, BCRYPT_ROUNDS);
  const [row] = await db
    .insert(workerTokens)
    .values({ userId, name: input.name, token: hash })
    .returning();
  if (!row) throw new Error('Failed to create worker token');
  return row;
}

export async function revokeWorkerTokenForUser(
  userId: string,
  id: string,
): Promise<boolean> {
  const row = await revokeToken(id, userId);
  return row !== null;
}

/** Update last_seen_at on the token row. */
export async function touchWorkerToken(tokenId: string): Promise<void> {
  await db
    .update(workerTokens)
    .set({ lastSeenAt: new Date() })
    .where(eq(workerTokens.id, tokenId));
}

/** Update the token's display name (used when the worker self-identifies). */
export async function setWorkerTokenName(
  tokenId: string,
  name: string,
): Promise<void> {
  await db
    .update(workerTokens)
    .set({ name })
    .where(eq(workerTokens.id, tokenId));
}
