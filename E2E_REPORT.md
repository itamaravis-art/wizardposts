# E2E Production Test Report — WizardPosts

- **Target:** `https://wizardposts.vercel.app`
- **Test user:** `cafecafegs@gmail.com` (`e001ba0f-01bb-408f-98df-70a053f0f018`)
- **Date:** 2026-05-03
- **Test file:** `web/__tests__/e2e-production.test.ts`

Legend: PASS / FAIL / WARN

---

## 1. Public endpoints (no auth)

| Check | Result | Detail |
|-------|--------|--------|
| `GET /` | PASS | 200, `text/html`, ~14 KB, ~630ms |
| `GET /api/health` | PASS | 200, `application/json`, body `{"ok":true,"ts":"..."}` |
| `GET /downloads/wizardposts-worker.zip` | PASS | 200, `application/zip`, 22344 bytes, `Content-Disposition: inline; filename="wizardposts-worker.zip"`, served via Vercel cache |
| `GET /auth/signin` | PASS | 200, `text/html`, RTL Hebrew page |

All public endpoints render and serve the expected content type.

---

## 2. Worker endpoints (with valid token)

| Check | Result | Detail |
|-------|--------|--------|
| `POST /api/worker/heartbeat` (single call) | PASS | 200, `{userId,fbConnected,fbUserName,settings:{daily_cap,min_delay_ms,max_delay_ms,work_hours_start,work_hours_end,max_consecutive_fails,typing_min_ms,typing_max_ms,fb_connected,fb_user_name}}` — settings object correctly snake_case |
| `GET /api/worker/next-job` | PASS | 204 No Content (no jobs queued for this user, expected) |
| `POST /api/worker/connection-status` | PASS | 200, `{"ok":true}` — accepts `{connected,userName}` |
| `PATCH /api/worker/jobs/<fakeId>` | **FAIL** | **404 with `text/html` Next.js error page**. Route file is missing entirely (Next 404 HTML, not a JSON 404). The Worker cannot report job results. |
| `POST /api/worker/upload-screenshot` | WARN | 200 with `{url, path}` when field is named `screenshot`. **Returns 400 `Missing "screenshot" file in form data` if Worker uses field name `file`.** Confirm Worker matches field name. |

### Heartbeat response body (sanitized example)

```json
{
  "userId": "e001ba0f-01bb-408f-98df-70a053f0f018",
  "fbConnected": true,
  "fbUserName": "איתמר אביסריס",
  "settings": {
    "daily_cap": 12,
    "min_delay_ms": 300000,
    "max_delay_ms": 900000,
    "work_hours_start": 0,
    "work_hours_end": 23,
    "max_consecutive_fails": 3,
    "typing_min_ms": 50,
    "typing_max_ms": 150,
    "fb_connected": true,
    "fb_user_name": "איתמר אביסריס"
  }
}
```

Settings object is in snake_case as documented.

---

## 3. Auth-required endpoints (no session)

All ten GETs **PASS** — every endpoint returned `401` with `application/json` body shape `{"error":"unauthorized","message":"Authentication required"}`:

```
GET /api/me                  -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/dashboard           -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/posts               -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/groups              -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/campaigns           -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/settings            -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/logs                -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/worker-tokens       -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/events/recent       -> 401 {"error":"unauthorized","message":"Authentication required"}
GET /api/events/stream       -> 401 {"error":"unauthorized","message":"Authentication required"}
```

All four auth-required POSTs **PASS** — 401 with the same JSON shape:

```
POST /api/posts              -> 401
POST /api/groups             -> 401
POST /api/campaigns          -> 401
POST /api/worker-tokens      -> 401
```

Error shape is consistent. No HTML leaks. No stack traces.

---

## 4. Negative tests (with valid worker token)

### 4a. Bad/missing/oversize body to `POST /api/worker/heartbeat`

| Case | Result | Status | Note |
|------|--------|--------|------|
| Garbage JSON `not json {{{` | PASS | 200 | Endpoint silently treats invalid JSON as empty body. No 500. |
| Empty body | PASS | 200 | OK. |
| 1 MB body `{"x":"AAA…"}` | PASS | 200 | Accepted; not 500. |

WARN — accepting garbage JSON as 200 is permissive; not strictly wrong because the body is optional, but a stricter API would 400 on malformed JSON. Not a blocker.

### 4b. Wrong-format / missing token

| Case | Result | Status | Body |
|------|--------|--------|------|
| No `Authorization` header | PASS | 401 | `{"error":"unauthorized"}` |
| `Bearer NOT-A-VALID-TOKEN` | PASS | 401 | `{"error":"unauthorized"}` |
| `Bearer wp_AAAAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBB` (correct shape, fake content) | PASS | 401 | `{"error":"unauthorized"}` |

Note: invalid-token path returns `{"error":"unauthorized"}` (no `message` field), while no-session paths return `{"error":"unauthorized","message":"Authentication required"}`. Cosmetic inconsistency in error shape.

### 4c. Worker token from REVOKED row

Not directly tested (would require DB write to revoke a token). However the worker-token middleware clearly rejects anything not present in `worker_tokens` table — see "wp_-shaped invalid" case above. Suggested follow-up by Backend agent: add a unit test that revokes a row and re-asserts 401.

---

## 5. Error shape consistency

| Source | Shape | Result |
|--------|-------|--------|
| Public auth endpoints | `application/json` `{"error":"unauthorized","message":"Authentication required"}` | PASS |
| Worker token errors | `application/json` `{"error":"unauthorized"}` | PASS but inconsistent (no `message`) |
| `PATCH /api/worker/jobs/<id>` | `text/html` Next.js 404 page | **FAIL** |
| `POST /api/worker/upload-screenshot` (missing `screenshot` field) | `application/json` `{"error":"Missing \"screenshot\" file in form data"}` | PASS |
| Function timeouts under load | `text/plain` `An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\n<vercel-id>` | **FAIL** (HTML/text leak from platform — Backend cannot fully control this, but the underlying timeout is the real bug) |

No DB stack traces leaked. No application stack traces. The only HTML response we observed is the Next.js 404 from the missing PATCH route.

---

## 6. Performance / reliability

### 6a. Sequential 5x `GET /api/worker/next-job` (cold sequential — PASS)

```
iter=1 status=204 time=1.149s
iter=2 status=204 time=1.123s
iter=3 status=204 time=0.864s
iter=4 status=204 time=0.858s
iter=5 status=204 time=1.569s
```

### 6b. Sequential 5x `POST /api/worker/heartbeat` (PASS in isolation)

```
iter=1 status=200 time=2.172s
iter=2 status=200 time=1.430s
iter=3 status=200 time=1.416s
iter=4 status=200 time=1.443s
iter=5 status=200 time=1.421s
```

### 6c. Health p50 latency (PASS)

```
iter=1 status=200 time=0.399s   (cold)
iter=2 status=200 time=0.253s
iter=3 status=200 time=0.247s
iter=4 status=200 time=0.256s
iter=5 status=200 time=0.256s
```

p50 ≈ **256 ms**, well under the 500 ms target.

### 6d. **CRITICAL — concurrency on worker endpoints (FAIL)**

When 5 GET requests to `/api/worker/next-job` are issued in parallel, **3 of 5 timeout at 300 seconds** with Vercel `FUNCTION_INVOCATION_TIMEOUT`:

```
parallel=1 status=204 time=1.240s
parallel=5 status=204 time=2.384s
parallel=3 status=504 time=300.336s   FUNCTION_INVOCATION_TIMEOUT
parallel=2 status=504 time=300.398s   FUNCTION_INVOCATION_TIMEOUT
parallel=4 status=504 time=300.349s   FUNCTION_INVOCATION_TIMEOUT
```

After the parallel storm, **all subsequent worker-token-authenticated requests hang for ~30–60 seconds before recovering**:

```
[after storm] heartbeat              -> hung at 15s timeout
[after storm] connection-status      -> hung at 15s timeout
[after storm] upload-screenshot      -> hung at 15s timeout
[after storm] /api/health            -> 200 in 293ms (unaffected)
[after storm] /api/me (no auth)      -> 401 in 223ms (unaffected)
```

After ~60–90 seconds the worker endpoints recover (heartbeat returns 200 in 2.4s, connection-status 1.2s) but `next-job` remains slow for longer, then also recovers.

The pattern (only DB-touching token-authenticated endpoints hang while no-auth/health are fine) strongly suggests a **DB connection pool exhaustion or a row-level lock contention** in the `next-job` query path:

- `next-job` likely uses `SELECT … FOR UPDATE SKIP LOCKED` on `jobs`. If the implementation holds the connection (and the row lock) across the screenshot upload / external network call, parallel callers will block until each transaction times out at the Vercel 300 s limit.
- Connection pool: Vercel serverless functions reuse a small pool per region (Supabase pooler, default 15 connections). 5 parallel 300 s holds will completely starve the pool for any other DB request from the same function.

**Production impact:** if 2+ Workers come online simultaneously and poll `next-job` together, they will each wait 300 s, all heartbeats from all users will queue up, and the dashboard's auth-protected endpoints could also degrade. **This blocks multi-tenant scaling.**

Suggested fix (Backend):

1. In `/api/worker/next-job`: keep the DB transaction tiny — `BEGIN; SELECT … FOR UPDATE SKIP LOCKED LIMIT 1; UPDATE … SET claimed_by=…, claimed_at=now() WHERE id=…; COMMIT;`. Do all enrichment queries (campaign/post/group joins) **after** commit, in separate fast reads.
2. Add a hard `vercel.json` `maxDuration: 30` to `/api/worker/*` so a stuck function fails fast instead of holding a connection for 5 minutes.
3. Confirm we're using the Supabase **transaction-mode pooler** (`?pgbouncer=true&connection_limit=1`) on serverless. If we're using session mode, every cold start consumes a connection.
4. Add a `pg_advisory_xact_lock(hashtext(user_id))` or per-user index on `(user_id, claimed_at)` so two parallel pollers from the same user don't lock each other for long.

---

## 7. Other observations

- **`PATCH /api/worker/jobs/<id>` route is missing.** The route returns Next.js HTML 404, not a JSON 404. Worker code that POSTs job results will get an unparseable HTML body. **Backend must implement this route.**
- `POST /api/worker/upload-screenshot` expects multipart field name **`screenshot`** (not `file`). Confirm Worker code uploads with that exact name.
- `Set-Cookie` for `__Host-authjs.csrf-token` and `__Secure-authjs.callback-url` is sent on the static download URL `/downloads/wizardposts-worker.zip`. Cookies on a public binary download are wasteful (they're set by the auth middleware running on every request). Cosmetic, low priority — Frontend / middleware tweak.
- The site renders `lang="he" dir="rtl"` correctly even on the 404 page.
- HSTS header `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` is present. Good.

---

## TL;DR

### Production-blocking bugs

1. **`PATCH /api/worker/jobs/<id>` route does not exist** — returns Next.js HTML 404. Worker cannot report job success/failure. **Owner: Backend.**
2. **Worker endpoints serialize/deadlock under concurrent load** — 5 parallel `GET /api/worker/next-job` produce 3× `FUNCTION_INVOCATION_TIMEOUT` (300 s) and stall all worker-authenticated requests for ~1 minute. Almost certainly DB connection-pool exhaustion in the `next-job` `FOR UPDATE` path. **Owner: Backend.**

### Cosmetic / low-priority

3. Auth-error JSON shape is inconsistent — session-required endpoints return `{error,message}`, worker-token endpoints return `{error}` only. **Owner: Backend.**
4. `POST /api/worker/heartbeat` accepts garbage JSON as 200 instead of 400. Fine if body is optional, but stricter validation would be safer. **Owner: Backend.**
5. Static asset `/downloads/wizardposts-worker.zip` has auth cookies set on it. Wasteful but harmless. **Owner: Frontend / middleware.**
6. Verify Worker uploads screenshots with the field name `screenshot` (not `file`); the API will 400 otherwise. **Owner: Worker.**

### Passing

- All 10 auth-required GETs return clean JSON 401s.
- All 4 auth-required POSTs return clean JSON 401s.
- `GET /`, `/auth/signin`, `/api/health`, `/downloads/wizardposts-worker.zip` all PASS.
- Sequential calls to `/api/worker/heartbeat`, `/api/worker/next-job`, `/api/worker/connection-status`, `/api/worker/upload-screenshot` all PASS.
- Health p50 latency ~256 ms (well under 500 ms target).
- Bad-token / no-token negative cases all return clean 401s; no 500s.
