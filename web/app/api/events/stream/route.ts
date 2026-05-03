// SSE event stream. Currently a heartbeat-only stream so the UI can establish
// a connection without errors; per-event broadcasting can be added later.

import { NextRequest } from 'next/server';
import { getUserId, handleRouteError } from '../../_lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await getUserId();
  } catch (err) {
    return handleRouteError(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Initial connection event
      controller.enqueue(encoder.encode(`event: open\ndata: {"ok":true}\n\n`));

      // Heartbeat every 30s to keep the connection alive
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(interval);
        }
      }, 30_000);

      // Close cleanly on abort
      const abort = () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      };
      // We don't have access to req.signal here easily; rely on the client closing.
      void abort;
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
