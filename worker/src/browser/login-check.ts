// Login-state probes for Facebook.
// Copied from FACEBOOKPOST/src/browser/login-check.ts.

import type { Page } from 'playwright';
import {
  isLoggedIn as sessionIsLoggedIn,
  getLoggedInUserName as sessionGetLoggedInUserName,
} from './session.js';

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page
      .goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => {});

    if (/\/login(\/|\?|\.php|$)/i.test(page.url())) {
      return false;
    }

    return sessionIsLoggedIn(page);
  } catch {
    return false;
  }
}

export async function getCurrentUserName(page: Page): Promise<string | null> {
  try {
    const title = await page.title().catch(() => '');
    if (title) {
      const cleaned = title.replace(/\s*[|·-]\s*Facebook\s*$/i, '').trim();
      if (cleaned && !/^facebook$/i.test(cleaned)) {
        return cleaned;
      }
    }

    return sessionGetLoggedInUserName(page);
  } catch {
    return null;
  }
}
