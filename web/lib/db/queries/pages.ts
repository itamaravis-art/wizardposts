/**
 * Query layer for the `pages` table — Facebook Pages connected via
 * Graph API, scoped to a single user.
 *
 * Access tokens are stored encrypted (see lib/crypto.ts). All helpers
 * here that EXPOSE the token to the caller decrypt it just-in-time and
 * never persist or log the plaintext. Use `accessTokenPlain` only at
 * the moment you're about to call Graph API.
 *
 * Conventions match the rest of the codebase:
 *   - All `*ForUser` helpers verify ownership upfront and return null
 *     (or empty array) on auth failure — never throw for "not yours".
 *   - DB inserts validate the brandKit shape via Zod at the route layer,
 *     not here, so this stays plumbing.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../index';
import { pages, type Page, type NewPage } from '../schema';
import { encrypt, decrypt } from '@/lib/crypto';
import type { BrandKit } from '@/lib/ai/types';

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export interface CreatePageInput {
  userId: string;
  fbPageId: string;
  pageName: string;
  /** Plaintext access token — encrypted before insert. */
  accessTokenPlain: string;
  tokenExpiresAt: Date | null;
  brandKit: BrandKit;
}

export async function createPage(input: CreatePageInput): Promise<Page> {
  const row: NewPage = {
    userId: input.userId,
    fbPageId: input.fbPageId,
    pageName: input.pageName,
    accessToken: encrypt(input.accessTokenPlain),
    tokenExpiresAt: input.tokenExpiresAt,
    brandKit: input.brandKit,
  };
  const [created] = await db.insert(pages).values(row).returning();
  if (!created) throw new Error('Insert returned no row');
  return created;
}

export async function listPagesForUser(userId: string): Promise<Page[]> {
  return db
    .select()
    .from(pages)
    .where(eq(pages.userId, userId))
    .orderBy(desc(pages.createdAt));
}

export async function getPageForUser(
  userId: string,
  pageId: string,
): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Same as `getPageForUser` but also decrypts the access token in
 * memory and returns it on a separate field. Use only at call sites
 * that are about to hit Graph API. Never log `accessTokenPlain`.
 */
export async function getPageWithTokenForUser(
  userId: string,
  pageId: string,
): Promise<(Page & { accessTokenPlain: string }) | null> {
  const page = await getPageForUser(userId, pageId);
  if (!page) return null;
  return { ...page, accessTokenPlain: decrypt(page.accessToken) };
}

/**
 * Lookup by `fbPageId` for a given user (used during connect to
 * detect "already connected" and update vs insert).
 */
export async function getPageByFbIdForUser(
  userId: string,
  fbPageId: string,
): Promise<Page | null> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.userId, userId), eq(pages.fbPageId, fbPageId)))
    .limit(1);
  return row ?? null;
}

export async function updatePageBrandKit(
  userId: string,
  pageId: string,
  brandKit: BrandKit,
): Promise<Page | null> {
  const [row] = await db
    .update(pages)
    .set({ brandKit, updatedAt: new Date() })
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .returning();
  return row ?? null;
}

export async function updatePageToken(
  userId: string,
  pageId: string,
  accessTokenPlain: string,
  expiresAt: Date | null,
): Promise<Page | null> {
  const [row] = await db
    .update(pages)
    .set({
      accessToken: encrypt(accessTokenPlain),
      tokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .returning();
  return row ?? null;
}

export async function setPageActive(
  userId: string,
  pageId: string,
  active: boolean,
): Promise<boolean> {
  const result = await db
    .update(pages)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(pages.id, pageId), eq(pages.userId, userId)))
    .returning({ id: pages.id });
  return result.length > 0;
}

/* ------------------------------------------------------------------ */
/* Cron-driven helpers (no userId scoping — system-wide)               */
/* ------------------------------------------------------------------ */

/**
 * Used by the daily generation cron and the token-refresh cron.
 * Returns ALL active pages across all users, with tokens decrypted
 * ready for Graph API calls.
 */
export async function listActivePagesWithTokens(): Promise<
  Array<Page & { accessTokenPlain: string }>
> {
  const rows = await db.select().from(pages).where(eq(pages.active, true));
  return rows.map((p) => ({ ...p, accessTokenPlain: decrypt(p.accessToken) }));
}

/**
 * Pages whose token is about to expire within `withinDays` days.
 * Includes already-expired tokens (the refresher will try anyway and
 * surface a clear error if Meta has revoked).
 */
export async function listPagesNeedingRefresh(
  withinDays: number,
): Promise<Array<Page & { accessTokenPlain: string }>> {
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(pages).where(eq(pages.active, true));
  return rows
    .filter(
      (p) => p.tokenExpiresAt !== null && p.tokenExpiresAt <= cutoff,
    )
    .map((p) => ({ ...p, accessTokenPlain: decrypt(p.accessToken) }));
}
