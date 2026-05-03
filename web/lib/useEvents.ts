/**
 * web/lib/useEvents.ts
 * React hook that subscribes to the API's SSE event stream and exposes a
 * rolling buffer of recent events plus a connection status flag.
 *
 *   const { events, lastEvent, status } = useEvents();
 *   const { events } = useEvents({ types: ['job.started', 'job.succeeded'] });
 *
 * Reconnection: EventSource's built-in auto-reconnect is fine for transient
 * network blips, but we also handle hard `error -> close` edges with our own
 * exponential backoff (capped at 10s) to avoid hot-looping when the API is
 * down for an extended period.
 */
'use client';

import { useEffect, useRef, useState } from 'react';

import type { AppEvent, AppEventType } from './events';

export type EventStreamStatus = 'connecting' | 'open' | 'closed';

export interface UseEventsOptions {
  /** Optional allowlist of event types. Other types are dropped client-side. */
  types?: AppEventType[] | string[];
  /** Cap the in-memory buffer; default 200 to mirror the server ring. */
  bufferSize?: number;
  /** Optional callback fired for every event that passes the type filter. */
  onEvent?: (event: AppEvent) => void;
}

export interface UseEventsResult {
  events: AppEvent[];
  lastEvent: AppEvent | null;
  status: EventStreamStatus;
}

/**
 * Normalise the various overload shapes callers use:
 *   - useEvents()                       -> all events, no callback
 *   - useEvents({ types, bufferSize })  -> options object
 *   - useEvents(['job.started', ...])   -> shorthand for { types }
 *   - useEvents((event) => { ... })     -> shorthand for { onEvent }
 */
function normalize(
  arg?: UseEventsOptions | string[] | ((event: AppEvent) => void),
): UseEventsOptions {
  if (!arg) return {};
  if (typeof arg === 'function') return { onEvent: arg };
  if (Array.isArray(arg)) return { types: arg };
  return arg;
}

const DEFAULT_BUFFER_SIZE = 200;
const STREAM_PATH = '/api/events/stream';

export function useEvents(
  arg?: UseEventsOptions | string[] | ((event: AppEvent) => void),
): UseEventsResult {
  const { types, bufferSize = DEFAULT_BUFFER_SIZE, onEvent } = normalize(arg);

  const [events, setEvents] = useState<AppEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<AppEvent | null>(null);
  const [status, setStatus] = useState<EventStreamStatus>('connecting');

  // Capture the latest filter set + callback in refs so the effect doesn't
  // recreate the EventSource every time the caller passes a new literal.
  const typesRef = useRef<readonly string[] | undefined>(types);
  typesRef.current = types;
  const onEventRef = useRef<typeof onEvent>(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let backoffMs = 500;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const handle = (ev: MessageEvent): void => {
      if (cancelled) return;
      let parsed: AppEvent;
      try {
        parsed = JSON.parse(ev.data) as AppEvent;
      } catch {
        return;
      }
      const allowed = typesRef.current;
      if (allowed && allowed.length > 0 && !allowed.includes(parsed.type)) {
        return;
      }
      setLastEvent(parsed);
      setEvents((prev) => {
        const next = prev.length >= bufferSize ? prev.slice(prev.length - bufferSize + 1) : prev.slice();
        next.push(parsed);
        return next;
      });
      try {
        onEventRef.current?.(parsed);
      } catch {
        /* swallow consumer errors */
      }
    };

    const open = (): void => {
      if (cancelled) return;
      setStatus('connecting');
      es = new EventSource(STREAM_PATH);

      es.onopen = (): void => {
        if (cancelled) return;
        setStatus('open');
        // Successful connection — reset backoff for the next failure.
        backoffMs = 500;
      };

      es.onmessage = handle;
      // EventSource only routes named events through addEventListener, not
      // onmessage. Wire the discriminator names we care about.
      const eventNames: AppEventType[] = [
        'worker.tick',
        'job.started',
        'job.succeeded',
        'job.failed',
        'campaign.status_changed',
        'campaign.progress',
        'connection.changed',
        'safety.gate_triggered',
        'log.added',
      ];
      for (const name of eventNames) {
        es.addEventListener(name, handle as EventListener);
      }

      es.onerror = (): void => {
        if (cancelled) return;
        // Browser will retry on its own for transient blips, but if the
        // connection is in CLOSED state we tear down and reschedule with
        // capped exponential backoff.
        if (es && es.readyState === EventSource.CLOSED) {
          setStatus('closed');
          es.close();
          es = null;
          const wait = Math.min(backoffMs, 10_000);
          backoffMs = Math.min(backoffMs * 2, 10_000);
          reconnectTimer = setTimeout(open, wait);
        } else {
          setStatus('connecting');
        }
      };
    };

    open();

    return () => {
      cancelled = true;
      setStatus('closed');
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        try {
          es.close();
        } catch {
          /* swallow */
        }
      }
    };
    // bufferSize is intentionally a dep — changing it should re-init.
  }, [bufferSize]);

  return { events, lastEvent, status };
}
