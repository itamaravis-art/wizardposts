// SSE event stream.
//
// Vercel Hobby kills serverless functions at 10s — an open-ended SSE stream
// guarantees a 504 every connection, the browser auto-reconnects, and we end
// up in a tight loop of FUNCTION_INVOCATION_TIMEOUT errors that also burn
// concurrent-execution quota for the whole project.
//
// Fix: cap each connection well under the platform timeout (8 s here, 2 s of
// headroom) and end cleanly. The client EventSource auto-reconnects and we
// just hand it a fresh stream. We also wire up `req.signal` so we stop work
// the instant the client disconnects, rather than leaking timers until GC.
//
// Real per-event broadcasting can be added later; for now a single `open`
// event plus a couple of heartbeat comments is enough to satisfy the UI.

import { NextRequest } from 'next/server';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hard cap below Vercel Hobby's 10 s function timeout.
const STREAM_LIFETIME_MS = 8_000;
const HEARTBEAT_INTERVAL_MS = 3_000;

export async function GET(req: NextRequest) {
  try {
    await getUserId();
  } catch (err) {
    return handleRouteError(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: heartbeat\n\n`));
      }, HEARTBEAT_INTERVAL_MS);

      const lifetime = setTimeout(() => {
        // Polite end-of-stream — client will reconnect.
        safeEnqueue(encoder.encode(`event: bye\ndata: {"reason":"lifetime"}\n\n`));
        cleanup();
      }, STREAM_LIFETIME_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Stop the moment the client disconnects.
      req.signal.addEventListener('abort', cleanup);

      // Initial connection event.
      safeEnqueue(encoder.encode(`event: open\ndata: {"ok":true}\n\n`));
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
