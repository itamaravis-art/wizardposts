// Launches a persistent Chromium context for Facebook automation.
// Copied from FACEBOOKPOST/src/browser/launcher.ts.

import { chromium, type BrowserContext } from 'playwright';
import { SESSION_DIR } from '../utils/paths.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export async function launchBrowser(): Promise<BrowserContext> {
  const headless = process.env.BROWSER_HEADLESS === 'true';
  const locale = process.env.BROWSER_LOCALE || 'he-IL';
  const timezoneId = process.env.BROWSER_TIMEZONE || 'Asia/Jerusalem';
  const userAgent = process.env.BROWSER_USER_AGENT || DEFAULT_USER_AGENT;

  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    locale,
    timezoneId,
    // 1440x900 matches a typical modern laptop and gives Facebook's React layout
    // enough horizontal space to render the desktop composer trigger; at 1280px
    // wide some Hebrew RTL group views collapse the inline composer area, hiding
    // the trigger button entirely.
    viewport: { width: 1440, height: 900 },
    userAgent,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  return ctx;
}

export async function closeBrowser(ctx: BrowserContext): Promise<void> {
  try {
    await ctx.close();
  } catch {
    /* ignore */
  }
}
