/**
 * Green API WhatsApp client (https://green-api.com).
 *
 * Used to ping the page owner about queue events: pending posts ready
 * for review, posts about to be skipped, publish failures.
 *
 * Best-effort by design: if Green API is down or env vars are missing,
 * we LOG and return — never throw out, because that would crash a cron
 * just because notifications were broken.
 */

const BASE = 'https://api.green-api.com';

export interface SendWhatsAppOptions {
  /** Phone number in international format, no +. E.g. 972506810353. */
  to: string;
  message: string;
}

export async function sendWhatsApp(opts: SendWhatsAppOptions): Promise<{ ok: boolean; error?: string }> {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!instanceId || !token) {
    return { ok: false, error: 'GREEN_API_INSTANCE_ID / GREEN_API_TOKEN not set' };
  }
  if (!/^\d{8,15}$/.test(opts.to)) {
    return { ok: false, error: `Invalid phone format: ${opts.to}` };
  }

  const chatId = `${opts.to}@c.us`;
  const url = `${BASE}/waInstance${instanceId}/sendMessage/${token}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, message: opts.message }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Green API ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Convenience: send to the configured page-owner number from
 * OWNER_WHATSAPP env. Returns silently on misconfiguration so callers
 * don't need to nullcheck.
 */
export async function notifyOwner(message: string): Promise<void> {
  const to = process.env.OWNER_WHATSAPP;
  if (!to) {
    // eslint-disable-next-line no-console
    console.warn('[notifyOwner] OWNER_WHATSAPP not set, skipping:', message.slice(0, 80));
    return;
  }
  const res = await sendWhatsApp({ to, message });
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.warn('[notifyOwner] failed:', res.error);
  }
}
