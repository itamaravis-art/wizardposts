/**
 * Thin Facebook Graph API client.
 *
 * Just enough surface area for the page-channel module: token
 * exchange, ownership/permission verification, photo publishing, and
 * basic insights. Everything else can be added when there's a use case.
 *
 * Scoping: this module never reads from the DB. Pass the `accessToken`
 * already-decrypted from `getPageWithTokenForUser`. Same for the
 * Page ID — the caller knows what page they're targeting.
 *
 * Errors: every helper throws `GraphError` (status + Meta's error
 * payload) on non-2xx. Callers should surface `error.userMessage` to
 * the human and log the full payload to `logs`.
 */

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class GraphError extends Error {
  status: number;
  metaCode: number | null;
  metaSubcode: number | null;
  fbtraceId: string | null;
  userMessage: string;

  constructor(opts: {
    status: number;
    body: unknown;
    fallbackMessage: string;
  }) {
    const body =
      typeof opts.body === 'object' && opts.body !== null
        ? (opts.body as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } })
        : null;
    const m = body?.error;
    const msg = m?.message ?? opts.fallbackMessage;
    super(msg);
    this.name = 'GraphError';
    this.status = opts.status;
    this.metaCode = m?.code ?? null;
    this.metaSubcode = m?.error_subcode ?? null;
    this.fbtraceId = m?.fbtrace_id ?? null;
    this.userMessage = msg;
  }
}

async function graphRequest<T>(opts: {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown> | FormData;
  accessToken?: string;
  // GraphError is a useful identifier for callers to filter on
  fallback?: string;
}): Promise<T> {
  const url = new URL(`${GRAPH_BASE}${opts.path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  if (opts.accessToken && !url.searchParams.has('access_token')) {
    url.searchParams.set('access_token', opts.accessToken);
  }

  const init: RequestInit = { method: opts.method };
  if (opts.body) {
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else {
      init.headers = { 'content-type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new GraphError({
      status: res.status,
      body: parsed,
      fallbackMessage: opts.fallback ?? `Graph ${opts.method} ${opts.path} failed (${res.status})`,
    });
  }
  return parsed as T;
}

/* ------------------------------------------------------------------ */
/* Token exchange                                                      */
/* ------------------------------------------------------------------ */

export interface ExchangedToken {
  accessToken: string;
  /** Seconds until expiry from now. Null if Meta omits (rare). */
  expiresIn: number | null;
}

/**
 * Exchange a short-lived USER access token for a long-lived one.
 *
 * Long-lived USER tokens last ~60 days. From there you call
 * `getLongLivedPageToken` to derive a Page token, which (per Meta
 * docs) is then ALSO long-lived — typically ~60 days, sometimes
 * "no expiration" if the user is the page admin.
 */
export async function exchangeShortLivedUserToken(
  shortToken: string,
  appId: string,
  appSecret: string,
): Promise<ExchangedToken> {
  const res = await graphRequest<{
    access_token: string;
    token_type?: string;
    expires_in?: number;
  }>({
    method: 'GET',
    path: '/oauth/access_token',
    query: {
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
    fallback: 'Failed to exchange short-lived token',
  });
  return {
    accessToken: res.access_token,
    expiresIn: typeof res.expires_in === 'number' ? res.expires_in : null,
  };
}

/**
 * Given a long-lived USER token, fetch the user's Pages and the
 * corresponding Page tokens (each Page row has its own access_token
 * field).
 *
 * Returned Page tokens are themselves long-lived when derived from a
 * long-lived USER token.
 */
export async function listPagesWithTokens(
  longLivedUserToken: string,
): Promise<
  Array<{
    id: string;
    name: string;
    accessToken: string;
    category: string | null;
  }>
> {
  const res = await graphRequest<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      category?: string;
    }>;
  }>({
    method: 'GET',
    path: '/me/accounts',
    accessToken: longLivedUserToken,
    fallback: 'Failed to list managed pages',
  });
  return (res.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    category: p.category ?? null,
  }));
}

/**
 * Validate a Page access token by calling /me on it. Returns the page
 * id + name if the token is for a Page; throws otherwise.
 *
 * Used at connect time to make sure the user actually pasted a Page
 * token (not a User token) and that the token is alive.
 */
export async function validatePageToken(
  pageAccessToken: string,
): Promise<{ id: string; name: string }> {
  return graphRequest<{ id: string; name: string }>({
    method: 'GET',
    path: '/me',
    query: { fields: 'id,name' },
    accessToken: pageAccessToken,
    fallback: 'Page token validation failed',
  });
}

/**
 * Inspect a token to see when it expires (Graph API debug_token).
 * Requires the App access token (app_id|app_secret) as the caller —
 * we use that pattern to avoid needing a second OAuth roundtrip.
 */
export async function debugToken(
  accessToken: string,
  appId: string,
  appSecret: string,
): Promise<{
  isValid: boolean;
  expiresAt: Date | null;
  scopes: string[];
  type: string | null;
}> {
  const res = await graphRequest<{
    data?: {
      is_valid: boolean;
      expires_at?: number; // seconds since epoch, 0 = never
      data_access_expires_at?: number;
      scopes?: string[];
      type?: string;
    };
  }>({
    method: 'GET',
    path: '/debug_token',
    query: {
      input_token: accessToken,
      access_token: `${appId}|${appSecret}`,
    },
    fallback: 'debug_token failed',
  });
  const d = res.data;
  return {
    isValid: !!d?.is_valid,
    expiresAt: d?.expires_at && d.expires_at > 0 ? new Date(d.expires_at * 1000) : null,
    scopes: d?.scopes ?? [],
    type: d?.type ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Post a photo with a caption to the user's Page.
 *
 * `imageUrl` must be a publicly-fetchable HTTPS URL — Meta's servers
 * will GET it themselves to attach the photo. (Don't pass a private
 * Supabase URL; use the public bucket URL.)
 *
 * Returns Meta's `post_id` (NOT `id` — `id` is the photo id, post_id
 * is the feed post id we'd link to in /campaigns/X view).
 */
export async function publishPhoto(opts: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
  caption: string;
}): Promise<{ photoId: string; postId: string }> {
  const res = await graphRequest<{ id: string; post_id: string }>({
    method: 'POST',
    path: `/${opts.pageId}/photos`,
    body: {
      url: opts.imageUrl,
      caption: opts.caption,
      published: true,
    },
    accessToken: opts.pageAccessToken,
    fallback: 'publishPhoto failed',
  });
  return { photoId: res.id, postId: res.post_id };
}

/* ------------------------------------------------------------------ */
/* Insights (used in Phase 5 if we expose them)                        */
/* ------------------------------------------------------------------ */

export async function getPostInsights(opts: {
  postId: string;
  pageAccessToken: string;
  metrics?: string[];
}): Promise<Record<string, number>> {
  const metrics =
    opts.metrics ?? [
      'post_impressions',
      'post_impressions_unique',
      'post_clicks',
      'post_reactions_by_type_total',
    ];
  const res = await graphRequest<{
    data: Array<{
      name: string;
      values: Array<{ value: number | Record<string, number> }>;
    }>;
  }>({
    method: 'GET',
    path: `/${opts.postId}/insights`,
    query: { metric: metrics.join(',') },
    accessToken: opts.pageAccessToken,
    fallback: 'getPostInsights failed',
  });
  const out: Record<string, number> = {};
  for (const row of res.data ?? []) {
    const v = row.values?.[0]?.value;
    if (typeof v === 'number') {
      out[row.name] = v;
    } else if (v && typeof v === 'object') {
      out[row.name] = Object.values(v).reduce((a, b) => a + b, 0);
    }
  }
  return out;
}
