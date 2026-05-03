import type { NextRequest } from 'next/server';
import { getUserIdByToken } from '@/lib/db/queries/workerTokens';

export interface WorkerAuthContext {
  userId: string;
  /**
   * The token prefix (e.g. `wt_xxxxxxxx`) — useful for logs / audit trails.
   * Never the full secret.
   */
  tokenId: string;
}

/**
 * Thrown to short-circuit a route handler with a 401 JSON response.
 * Catch with `instanceof Response` or rethrow from your handler.
 */
function unauthorized(reason: string): Response {
  return new Response(
    JSON.stringify({ error: 'unauthorized', message: reason }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="worker"',
      },
    },
  );
}

// Accept both legacy (wt_<32hex>) and current (wp_<base64url>) token formats.
const TOKEN_REGEX = /^(wt_[a-f0-9]{32}|wp_[A-Za-z0-9_-]{32,})$/;

/**
 * Validate a worker bearer token from the `Authorization` header.
 *
 * Throws a `Response` (401) on any failure — call sites should let it
 * propagate or wrap with try/catch and return it directly.
 *
 * Format: `Authorization: Bearer wt_<32-hex>`
 */
export async function requireWorker(
  req: Request | NextRequest,
): Promise<WorkerAuthContext> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');

  if (!header) {
    throw unauthorized('Missing Authorization header');
  }

  const [scheme, raw] = header.split(' ', 2);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !raw) {
    throw unauthorized('Authorization header must be "Bearer <token>"');
  }

  const token = raw.trim();
  if (!TOKEN_REGEX.test(token)) {
    throw unauthorized('Malformed worker token');
  }

  const result = await getUserIdByToken(token);
  if (!result) {
    throw unauthorized('Invalid or revoked worker token');
  }

  // The query returns the actual DB token row id, which downstream helpers
  // (`touchWorkerToken`, `recordJobResultForUser`) need to verify the same
  // worker is reporting that originally claimed a job.
  return { userId: result.userId, tokenId: result.tokenId };
}
