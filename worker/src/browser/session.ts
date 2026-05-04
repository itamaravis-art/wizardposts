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
    if (!/facebook\.com/i.test(page.url())) return null;

    // The unparameterised aria-label on the profile icon/menu is "Your
    // profile" / "הפרופיל שלך" — that's a UI control label, not the
    // user's name. We must reject it explicitly so the cloud doesn't
    // store the placeholder as the user's display name.
    const PLACEHOLDER_LABELS = new Set([
      'הפרופיל שלך',
      'Your profile',
      'Account',
      'חשבון',
    ]);
    const isPlaceholder = (s: string | null | undefined): boolean => {
      if (!s) return true;
      const t = s.trim();
      return t.length === 0 || PLACEHOLDER_LABELS.has(t);
    };

    // Strategy 1 — banner profile link aria-label of form "Label, Name".
    const ariaCandidates = [
      '[role="banner"] [aria-label^="Your profile,"]',
      '[role="banner"] [aria-label^="הפרופיל שלך,"]',
      '[role="banner"] [aria-label*="profile" i][aria-label*=","]',
      '[role="navigation"] [aria-label*="profile" i][aria-label*=","]',
      '[role="navigation"] [aria-label*="פרופיל"][aria-label*=","]',
    ];
    for (const sel of ariaCandidates) {
      const loc = page.locator(sel).first();
      if (!(await loc.isVisible({ timeout: 800 }).catch(() => false))) continue;
      const aria = await loc.getAttribute('aria-label').catch(() => null);
      if (!aria) continue;
      const m = aria.match(/[,،]\s*(.+)$/);
      if (m && m[1] && !isPlaceholder(m[1])) return m[1].trim();
    }

    // Strategy 2 — meta og:title. On facebook.com home this is the name;
    // on a group/page it would be the page name (rejected via Facebook
    // generic check below).
    const ogTitle = await page
      .locator('meta[property="og:title"]')
      .getAttribute('content', { timeout: 800 })
      .catch(() => null);
    if (ogTitle && !isPlaceholder(ogTitle) && !/^facebook$/i.test(ogTitle.trim())) {
      // Only trust og:title when we're on the user's own surface (root host).
      // On group pages og:title is the group name.
      if (/facebook\.com\/?$/i.test(page.url())) return ogTitle.trim();
    }

    // Strategy 3 — read FB's bootstrap data. CurrentUserInitialData.NAME is
    // set by FB's page-init scripts and is the canonical display name.
    const fromBootstrap = await page
      .evaluate<string | null>(() => {
        const w = window as unknown as {
          CurrentUserInitialData?: { NAME?: string; SHORT_NAME?: string };
        };
        const n = w.CurrentUserInitialData?.NAME ?? w.CurrentUserInitialData?.SHORT_NAME;
        return typeof n === 'string' && n.trim().length > 0 ? n.trim() : null;
      })
      .catch(() => null);
    if (fromBootstrap && !isPlaceholder(fromBootstrap)) return fromBootstrap;

    return null;
  } catch {
    return null;
  }
}
