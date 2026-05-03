/* eslint-disable no-console */
/**
 * E2E production smoke tests for WizardPosts.
 *
 * Run with:  npx tsx web/__tests__/e2e-production.test.ts
 *
 * Hits the live deployment at https://wizardposts.vercel.app using only
 * fetch + a known test worker token. Does NOT touch the DB or any local code.
 *
 * Each test prints PASS/FAIL with the request and response so a human can
 * skim the output. We avoid any test runner so this can be invoked from
 * CI or a one-off shell without dev deps.
 */

const BASE = process.env.E2E_BASE_URL ?? "https://wizardposts.vercel.app";
const TOKEN =
  process.env.E2E_WORKER_TOKEN ??
  "wp_NdpMQq3UzgO2ie83zEyfXlaA_BMGdNPDXI_yi4BiNhA";
const USER_ID = "e001ba0f-01bb-408f-98df-70a053f0f018";

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${name} :: ${detail}`);
}

async function readBody(res: Response) {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return (await res.text()).slice(0, 400);
}

// ---------------- Public endpoints ----------------

async function testLanding() {
  const res = await fetch(`${BASE}/`);
  const ct = res.headers.get("content-type") ?? "";
  const ok = res.status === 200 && ct.startsWith("text/html");
  record("GET /", ok, `status=${res.status} ct=${ct}`);
}

async function testHealth() {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/health`);
  const ms = Date.now() - t0;
  const body = await readBody(res);
  const ok =
    res.status === 200 &&
    typeof body === "object" &&
    body !== null &&
    (body as { ok?: unknown }).ok === true;
  record(
    "GET /api/health",
    ok,
    `status=${res.status} ms=${ms} body=${JSON.stringify(body)}`,
  );
}

async function testWorkerZip() {
  const res = await fetch(`${BASE}/downloads/wizardposts-worker.zip`, {
    method: "HEAD",
  });
  const ct = res.headers.get("content-type") ?? "";
  const len = Number(res.headers.get("content-length") ?? "0");
  const ok = res.status === 200 && ct === "application/zip" && len > 1000;
  record(
    "GET /downloads/wizardposts-worker.zip",
    ok,
    `status=${res.status} ct=${ct} len=${len}`,
  );
}

async function testSignin() {
  const res = await fetch(`${BASE}/auth/signin`);
  const ct = res.headers.get("content-type") ?? "";
  const ok = res.status === 200 && ct.startsWith("text/html");
  record("GET /auth/signin", ok, `status=${res.status} ct=${ct}`);
}

// ---------------- Worker endpoints (valid token) ----------------

async function testHeartbeat() {
  const res = await fetch(`${BASE}/api/worker/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const body = (await readBody(res)) as Record<string, unknown> | string | null;
  const ok =
    res.status === 200 &&
    typeof body === "object" &&
    body !== null &&
    (body as { userId?: unknown }).userId === USER_ID &&
    "fbConnected" in (body as object) &&
    "settings" in (body as object);
  record(
    "POST /api/worker/heartbeat",
    ok,
    `status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`,
  );
}

async function testNextJob() {
  const res = await fetch(`${BASE}/api/worker/next-job`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  // Either 204 (no work) or 200 with a job payload is acceptable.
  let body: unknown = null;
  if (res.status === 200) body = await readBody(res);
  const ok = res.status === 204 || res.status === 200;
  record(
    "GET /api/worker/next-job",
    ok,
    `status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`,
  );
}

async function testConnectionStatus() {
  const res = await fetch(`${BASE}/api/worker/connection-status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ connected: true, userName: "E2E Test" }),
  });
  const body = await readBody(res);
  const ok = res.status === 200;
  record(
    "POST /api/worker/connection-status",
    ok,
    `status=${res.status} body=${JSON.stringify(body)}`,
  );
}

async function testPatchFakeJob() {
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const res = await fetch(`${BASE}/api/worker/jobs/${fakeId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ success: false, message: "e2e fake" }),
  });
  const ct = res.headers.get("content-type") ?? "";
  // Route should EXIST: status 404 is fine if it's a JSON 404, but a
  // Next.js HTML 404 page means the route is missing entirely.
  const ok = res.status !== 404 || ct.includes("application/json");
  const body = await readBody(res);
  record(
    "PATCH /api/worker/jobs/<id>",
    ok,
    `status=${res.status} ct=${ct} body=${typeof body === "string" ? body.slice(0, 80) : JSON.stringify(body)}`,
  );
}

async function testUploadScreenshot() {
  // 1x1 PNG
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  const fd = new FormData();
  fd.append("screenshot", new Blob([png], { type: "image/png" }), "test.png");
  const res = await fetch(`${BASE}/api/worker/upload-screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  const body = (await readBody(res)) as Record<string, unknown> | string | null;
  const ok =
    res.status === 200 &&
    typeof body === "object" &&
    body !== null &&
    typeof (body as { url?: unknown }).url === "string";
  record(
    "POST /api/worker/upload-screenshot",
    ok,
    `status=${res.status} body=${JSON.stringify(body).slice(0, 200)}`,
  );
}

// ---------------- Auth-required endpoints (no session → 401) ----------------

const authGets = [
  "/api/me",
  "/api/dashboard",
  "/api/posts",
  "/api/groups",
  "/api/campaigns",
  "/api/settings",
  "/api/logs",
  "/api/worker-tokens",
  "/api/events/recent",
  "/api/events/stream",
];

const authPosts = [
  "/api/posts",
  "/api/groups",
  "/api/campaigns",
  "/api/worker-tokens",
];

async function testAuthGets() {
  for (const path of authGets) {
    const res = await fetch(`${BASE}${path}`);
    const ct = res.headers.get("content-type") ?? "";
    const body = await readBody(res);
    const ok =
      res.status === 401 &&
      ct.includes("application/json") &&
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: unknown }).error === "string";
    record(
      `GET ${path} (no auth)`,
      ok,
      `status=${res.status} ct=${ct} body=${JSON.stringify(body).slice(0, 120)}`,
    );
  }
}

async function testAuthPosts() {
  for (const path of authPosts) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await readBody(res);
    const ok = res.status === 401;
    record(
      `POST ${path} (no auth)`,
      ok,
      `status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`,
    );
  }
}

// ---------------- Negative tests ----------------

async function testBadHeartbeatBodies() {
  const cases: Array<{ name: string; body: string }> = [
    { name: "garbage JSON", body: "not json {{{" },
    { name: "missing body", body: "" },
    { name: "huge 1MB body", body: '{"x":"' + "A".repeat(1_000_000) + '"}' },
  ];
  for (const c of cases) {
    const res = await fetch(`${BASE}/api/worker/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: c.body,
    });
    const ok = res.status !== 500;
    record(
      `POST /api/worker/heartbeat (${c.name})`,
      ok,
      `status=${res.status} (must not be 500)`,
    );
  }
}

async function testInvalidTokens() {
  const cases: Array<{ name: string; header?: string }> = [
    { name: "no header" },
    { name: "wrong format", header: "Bearer NOT-A-VALID-TOKEN" },
    {
      name: "wp_-shaped invalid",
      header:
        "Bearer wp_AAAAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBB",
    },
  ];
  for (const c of cases) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (c.header) headers.Authorization = c.header;
    const res = await fetch(`${BASE}/api/worker/heartbeat`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const body = await readBody(res);
    const ok = res.status === 401;
    record(
      `POST /api/worker/heartbeat (${c.name})`,
      ok,
      `status=${res.status} body=${JSON.stringify(body).slice(0, 100)}`,
    );
  }
}

// ---------------- Performance ----------------

async function testRapidHeartbeats() {
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${BASE}/api/worker/heartbeat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    codes.push(res.status);
  }
  const ok = codes.every((c) => c === 200);
  record("5x rapid heartbeat", ok, `codes=${codes.join(",")}`);
}

async function testParallelNextJob() {
  const promises = Array.from({ length: 5 }, () =>
    fetch(`${BASE}/api/worker/next-job`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.status),
  );
  const codes = await Promise.all(promises);
  const ok = codes.every((c) => c === 200 || c === 204);
  record(
    "5x parallel next-job",
    ok,
    `codes=${codes.join(",")} (200 or 204 expected; FOR UPDATE SKIP LOCKED behavior)`,
  );
}

async function testHealthLatency() {
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/health`);
    samples.push(Date.now() - t0);
    if (res.status !== 200) {
      record("health latency", false, `non-200: ${res.status}`);
      return;
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const ok = p50 < 500;
  record("health p50 latency < 500ms", ok, `samples=${samples.join(",")}ms p50=${p50}ms`);
}

// ---------------- Runner ----------------

async function main() {
  console.log(`[E2E] base=${BASE} userId=${USER_ID}`);
  await testLanding();
  await testHealth();
  await testWorkerZip();
  await testSignin();

  await testHeartbeat();
  await testNextJob();
  await testConnectionStatus();
  await testPatchFakeJob();
  await testUploadScreenshot();

  await testAuthGets();
  await testAuthPosts();

  await testBadHeartbeatBodies();
  await testInvalidTokens();

  await testRapidHeartbeats();
  await testParallelNextJob();
  await testHealthLatency();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("");
  console.log(`[SUMMARY] ${passed}/${results.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log("[FAILURES]");
    for (const f of failed) console.log(`  - ${f.name} :: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[E2E] fatal", err);
  process.exitCode = 2;
});
