// Humanization helpers — typing, scrolling, pauses with randomized timing to look human.
// Copied from FACEBOOKPOST/src/poster/humanize.ts.

import type { Page, Locator } from 'playwright';

export interface HumanTypeOpts {
  minMs?: number;
  maxMs?: number;
}

export interface HumanScrollOpts {
  duration?: number;
  distance?: number;
  steps?: number;
}

export function randomInt(min: number, max: number): number {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

export const randomBetween = randomInt;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms | 0)));
}

export function humanPause(minMs: number, maxMs: number): Promise<void> {
  return sleep(randomInt(minMs, maxMs));
}

export const readingPause = humanPause;

function isLocator(v: unknown): v is Locator {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as { click?: unknown }).click === 'function' &&
    typeof (v as { page?: unknown }).page === 'function'
  );
}

export async function humanType(
  pageOrLocator: Page | Locator,
  selectorOrText: string | Locator,
  textOrOpts?: string | HumanTypeOpts,
  maybeOpts?: HumanTypeOpts,
): Promise<void> {
  let locator: Locator;
  let text: string;
  let opts: HumanTypeOpts | undefined;

  if (isLocator(pageOrLocator)) {
    locator = pageOrLocator;
    text = String(selectorOrText);
    opts = textOrOpts as HumanTypeOpts | undefined;
  } else if (isLocator(selectorOrText)) {
    locator = selectorOrText;
    text = String(textOrOpts);
    opts = maybeOpts;
  } else {
    locator = (pageOrLocator as Page).locator(selectorOrText as string).first();
    text = String(textOrOpts);
    opts = maybeOpts;
  }

  const minMs = opts?.minMs ?? 50;
  const maxMs = opts?.maxMs ?? 150;

  await locator.click({ delay: randomInt(20, 80) }).catch(() => {});
  const page = locator.page();
  for (const ch of Array.from(text)) {
    if (ch === '\n') {
      await page.keyboard.press('Shift+Enter').catch(() => {});
    } else {
      await page.keyboard.type(ch, { delay: 0 }).catch(() => {});
    }
    await sleep(randomInt(minMs, maxMs));
  }
}

export async function humanScroll(page: Page, opts: HumanScrollOpts = {}): Promise<void> {
  const distance = opts.distance ?? 1200;
  const duration = opts.duration ?? randomInt(2000, 4000);
  const steps = opts.steps ?? Math.max(4, Math.floor(duration / 250));

  const perStep = Math.floor(distance / steps);
  for (let i = 0; i < steps; i++) {
    const dy = perStep + randomInt(-30, 30);
    await page.mouse.wheel(0, dy).catch(() => {});
    await sleep(Math.max(50, Math.floor(duration / steps) + randomInt(-80, 80)));
  }
}
