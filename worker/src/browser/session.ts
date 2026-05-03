// Page session helpers — page reuse, login state checks, profile name read.
// Copied from FACEBOOKPOST/src/browser/session.ts.

import type { BrowserContext, Page } from 'playwright';
import { launchBrowser, closeBrowser as launcherCloseBrowser } from './launcher.js';

let singletonCtx: BrowserContext | null = null;

export async function getBrowserContext(): Promise<BrowserContext> {
  if (singletonCtx && !isContextClosed(singletonCtx)) {
    return singletonCtx;
  }
  singletonCtx = await launchBrowser();
  singletonCtx.on('close', () => {
    singletonCtx = null;
  });
  return singletonCtx;
}

export async function closeBrowser(): Promise<void> {
  if (!singletonCtx) return;
  const ctx = singletonCtx;
  singletonCtx = null;
  await launcherCloseBrowser(ctx);
}

function isContextClosed(ctx: BrowserContext): boolean {
  try {
    ctx.pages();
    return false;
  } catch {
    return true;
  }
}

export async function getOrCreatePage(ctx: BrowserContext): Promise<Page> {
  const pages = ctx.pages();
  if (pages.length > 0) {
    return pages[0]!;
  }
  return ctx.newPage();
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    if (!/facebook\.com/i.test(page.url())) {
      await page.goto('https://www.facebook.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    }

    const emailInput = page.locator('input[name="email"]').first();
    const passInput = page.locator('input[name="pass"]').first();
    const emailVisible = await emailInput.isVisible({ timeout: 1500 }).catch(() => false);
    const passVisible = await passInput.isVisible({ timeout: 1500 }).catch(() => false);
    if (emailVisible || passVisible) return false;

    if (/\/login(\/|\?|$)/i.test(page.url())) return false;

    const nav = page.locator('[role="navigation"]').first();
    const navVisible = await nav.isVisible({ timeout: 3000 }).catch(() => false);
    if (!navVisible) return false;

    const accountControl = page
      .locator(
        [
          '[aria-label="Your profile"]',
          '[aria-label="הפרופיל שלך"]',
          '[aria-label="Account"]',
          '[aria-label="חשבון"]',
          '[aria-label="Account Controls and Settings"]',
        ].join(', '),
      )
      .first();
    const accountVisible = await accountControl.isVisible({ timeout: 2000 }).catch(() => false);

    return accountVisible || navVisible;
  } catch {
    return false;
  }
}

export async function getLoggedInUserName(page: Page): Promise<string | null> {
  try {
    const candidates = [
      '[aria-label^="Your profile,"]',
      '[aria-label^="הפרופיל שלך,"]',
      '[role="navigation"] [aria-label*="profile" i]',
      '[role="navigation"] [aria-label*="פרופיל"]',
    ];
    for (const sel of candidates) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
        const aria = await loc.getAttribute('aria-label').catch(() => null);
        if (aria) {
          const m = aria.match(/[,،]\s*(.+)$/);
          if (m && m[1]) return m[1].trim();
          return aria.trim();
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
