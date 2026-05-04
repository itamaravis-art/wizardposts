/**
 * Worker token queries.
 *
 * Plain token format: `wt_` + 32 random hex chars (16 random bytes).
 * Stored as a bcrypt hash, never plain. The plain token is returned to the
 * caller exactly once (at creation). On verification we hash-compare candidates
 * against the stored hashes.
 *
 * Lookup strategy: each token row also stores `token_fp = sha256(plainToken)`
 * in hex. SHA-256 is deterministic, so we can index on it and look up the
 * single matching row in O(log n) before doing the bcrypt-compare. SHA-256
 * is fine here as a *lookup key* (not an auth credential): it identifies
 * which row, and bcrypt is what actually authenticates.
 *
 * Legacy rows (pre-fingerprint) have `token_fp IS NULL` and fall back to the
 * old full-table bcrypt scan, but only over rows that haven't been migrated.
 */
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { workerTokens, type WorkerToken } from '../schema';

const TOKEN_PREFIX = 'wt_';
const BCRYPT_ROUNDS = 10;

function generatePlainToken(): string {
  return TOKEN_PREFIX + randomBytes(16).toString('hex');
}

function fingerprint(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}

export async function createWorkerToken(
  userId: string,
  name: string,
): Promise<{ token: WorkerToken; plainToken: string }> {
  const plainToken = generatePlainToken();
  const hash = await bcrypt.hash(plainToken, BCRYPT_ROUNDS);
  const [row] = await db
    .insert(workerTokens)
    .values({ userId, name, token: hash, tokenFp: fingerprint(plainToken) })
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
 * Returns `null` if no active token matches.
 *
 * Two-stage lookup:
 *   1. Indexed SHA-256 fingerprint lookup → 0 or 1 row, fast.
 *   2. bcrypt.compare on that single row to authenticate (defence-in-depth
 *      in case the fp index ever returns the wrong row).
 *
 * Legacy fallback: rows created before `token_fp` existed have `tokenFp IS NULL`.
 * For those we scan only the legacy subset (typically empty in production after
 * tokens get rotated) and bcrypt-compare each.
 *
 * `last_seen_at` is touched best-effort and fire-and-forget so it never blocks
 * the auth response — it's a liveness indicator, not load-bearing.
 */
export async function getUserIdByToken(plainToken: string): Promise<{
  userId: string;
  tokenId: string;
} | null> {
  if (!plainToken) return null;

  const fp = fingerprint(plainToken);

  // Stage 1: indexed lookup by fingerprint. Returns ≤1 row.
  const [direct] = await db
    .select()
    .from(workerTokens)
    .where(and(eq(workerTokens.tokenFp, fp), isNull(workerTokens.revokedAt)))
    .limit(1);

  if (direct) {
    const ok = await bcrypt.compare(plainToken, direct.token);
    if (ok) {
      touchLastSeen(direct.id);
      return { userId: direct.userId, tokenId: direct.id };
    }
    // Fingerprint matched but bcrypt didn't — extremely unlikely (would mean
    // a SHA-256 collision). Fall through to legacy scan as a safety net.
  }

  // Stage 2: legacy scan over rows that predate the fingerprint column.
  const legacy = await db
    .select()
    .from(workerTokens)
    .where(and(isNull(workerTokens.tokenFp), isNull(workerTokens.revokedAt)));

  for (const row of legacy) {
    const ok = await bcrypt.compare(plainToken, row.token);
    if (ok) {
      // Backfill the fingerprint so the next lookup is fast.
      void db
        .update(workerTokens)
        .set({ tokenFp: fp, lastSeenAt: new Date() })
        .where(eq(workerTokens.id, row.id))
        .catch(() => {});
      return { userId: row.userId, tokenId: row.id };
    }
  }

  return null;
}

/** Best-effort liveness bump. Errors are swallowed so auth never fails on it. */
function touchLastSeen(tokenId: string): void {
  void db
    .update(workerTokens)
    .set({ lastSeenAt: new Date() })
    .where(eq(workerTokens.id, tokenId))
    .catch(() => {});
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
    .values({
      userId,
      name: input.name,
      token: hash,
      tokenFp: fingerprint(input.plainToken),
    })
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
