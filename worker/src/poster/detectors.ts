// Detects Facebook obstruction signals: checkpoints, captchas, rate-limits, login walls.
// Copied from FACEBOOKPOST/src/poster/detectors.ts.

import type { Page } from 'playwright';

export type BlockerKind = 'captcha' | 'checkpoint' | 'rate-limit' | 'login-required' | null;

export interface BlockerResult {
  blocked: boolean;
  kind: BlockerKind;
  evidence: string | null;
}

const CHECKPOINT_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /אישור זהות/i,
  /אבטחה/i,
  /Confirm your identity/i,
  /Please confirm/i,
  /We need to confirm/i,
  /Your account has been locked/i,
];

const RATE_LIMIT_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /We've limited/i,
  /You can't use this feature/i,
  /You're Temporarily Blocked/i,
  /מוגבל/i,
  /הגבלנו/i,
  /חרגת/i,
];

const CAPTCHA_TEXT_PATTERNS: ReadonlyArray<RegExp> = [/captcha/i, /אימות אנושי/i, /הוכח שאתה אדם/i];

export async function detectBlocker(page: Page): Promise<BlockerResult> {
  const url = page.url();

  if (/\/checkpoint\//i.test(url)) {
    return { blocked: true, kind: 'checkpoint', evidence: `url:${url}` };
  }
  if (/\/two_step_verification\//i.test(url)) {
    return { blocked: true, kind: 'checkpoint', evidence: `url:${url}` };
  }
  if (/\/login(\/|\?|$)/i.test(url)) {
    return { blocked: true, kind: 'login-required', evidence: `url:${url}` };
  }

  try {
    const recaptcha = page.locator('iframe[src*="recaptcha"], iframe[title*="captcha" i]').first();
    if (await recaptcha.isVisible({ timeout: 800 }).catch(() => false)) {
      return { blocked: true, kind: 'captcha', evidence: 'recaptcha-iframe' };
    }
  } catch {
    /* ignore */
  }

  let bodyText = '';
  try {
    bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '');
  } catch {
    bodyText = '';
  }

  for (const re of CAPTCHA_TEXT_PATTERNS) {
    if (re.test(bodyText)) {
      return { blocked: true, kind: 'captcha', evidence: `text:${re.source}` };
    }
  }
  for (const re of CHECKPOINT_TEXT_PATTERNS) {
    if (re.test(bodyText)) {
      return { blocked: true, kind: 'checkpoint', evidence: `text:${re.source}` };
    }
  }
  for (const re of RATE_LIMIT_TEXT_PATTERNS) {
    if (re.test(bodyText)) {
      return { blocked: true, kind: 'rate-limit', evidence: `text:${re.source}` };
    }
  }

  try {
    const emailInput = page.locator('input[name="email"]').first();
    const passInput = page.locator('input[name="pass"]').first();
    const emailVisible = await emailInput.isVisible({ timeout: 500 }).catch(() => false);
    const passVisible = await passInput.isVisible({ timeout: 500 }).catch(() => false);
    if (emailVisible && passVisible) {
      return { blocked: true, kind: 'login-required', evidence: 'login-form-visible' };
    }
  } catch {
    /* ignore */
  }

  return { blocked: false, kind: null, evidence: null };
}
