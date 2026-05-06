/**
 * Deterministic mapping from (date, slot) → pillar.
 *
 * The plan specifies a fixed weekly schedule the AI follows so the
 * Page's voice has a predictable rhythm: Sunday morning is tips,
 * Sunday evening is stories, etc. The owner sees the same kind of
 * post on the same day every week.
 *
 * Saturday + Friday-evening are intentionally empty (skip slot) for
 * Israeli context.
 */
import type { BrandKit, PillarId } from './types';

/**
 * Day of week is JS-standard 0=Sunday … 6=Saturday.
 * Slot is the index into brandKit.publishSlots (0=morning, 1=evening).
 *
 * Returns null when this (day, slot) pair is intentionally blank
 * (e.g. Saturday evening). The generation cron skips those.
 */
export function getPillarForSlot(
  date: Date,
  slotIndex: number,
  _brandKit: BrandKit,
): PillarId | null {
  // We compute in Asia/Jerusalem so the schedule lines up with the
  // owner's local week (a Sunday post at 22:00 Israel == Sunday in UTC,
  // but a 02:00 UTC post would be Sunday Israel time too — going via
  // local string keeps both edges right).
  const local = new Date(
    date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }),
  );
  const dow = local.getDay();

  // Hardcoded weekly map (per the approved plan).
  // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  const SCHEDULE: Array<[PillarId | null, PillarId | null]> = [
    /* Sun */ ['tips', 'stories'],
    /* Mon */ ['treatments', 'education'],
    /* Tue */ ['behind_scenes', 'tips'],
    /* Wed */ ['stories', 'treatments'],
    /* Thu */ ['education', 'cta'],
    /* Fri */ ['cta', null], // Friday evening: skip (Shabbat)
    /* Sat */ ['stories', null], // Saturday evening: skip
  ];

  const day = SCHEDULE[dow];
  if (!day) return null;
  if (slotIndex < 0 || slotIndex >= day.length) return null;
  return day[slotIndex] ?? null;
}

/**
 * For a given target date, return ALL slots scheduled to publish on
 * that day. Used by the generation cron at 22:00 the night before to
 * decide what to produce for tomorrow.
 *
 * Returns array aligned with brandKit.publishSlots — items where the
 * pillar is null mean "skip this slot today".
 */
export function getAllPillarsForDate(
  date: Date,
  brandKit: BrandKit,
): Array<{ slotIndex: number; slot: string; pillar: PillarId | null }> {
  return brandKit.publishSlots.map((slot, i) => ({
    slotIndex: i,
    slot,
    pillar: getPillarForSlot(date, i, brandKit),
  }));
}

/**
 * Compute the absolute scheduledAt timestamp for a given date + slot.
 * Returns a Date in UTC corresponding to that slot in Asia/Jerusalem.
 *
 * Why this fiddly: Asia/Jerusalem has DST transitions twice a year,
 * so naive date math breaks. We use a synthetic ISO-with-offset that
 * the JS Date parser handles correctly.
 */
export function dateAtSlot(date: Date, slotHHmm: string): Date {
  const [h, m] = slotHHmm.split(':').map(Number);
  // Pick the date in Israel TZ as Y-M-D, then construct an ISO string
  // with the right offset. This is the simplest correct approach without
  // importing a tz library.
  const y = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
  });
  const mo = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Jerusalem',
    month: '2-digit',
  });
  const d = date.toLocaleString('en-CA', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
  });
  // Extract Israel's current offset from any reference Date in that TZ.
  const offsetMins = -new Date(
    date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }),
  ).getTimezoneOffset();
  const sign = offsetMins >= 0 ? '+' : '-';
  const absMins = Math.abs(offsetMins);
  const oh = String(Math.floor(absMins / 60)).padStart(2, '0');
  const om = String(absMins % 60).padStart(2, '0');
  const iso = `${y}-${mo}-${d}T${String(h ?? 0).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}:00${sign}${oh}:${om}`;
  return new Date(iso);
}
