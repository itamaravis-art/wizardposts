// Core posting flow: navigate -> open composer -> type -> attach image -> submit -> verify.
// Copied from FACEBOOKPOST/src/poster/poster.ts and kept in sync with the latest
// inline-composer fixes.

import path from 'node:path';
import fs from 'node:fs';
import type { BrowserContext, Page, Locator } from 'playwright';
import { getOrCreatePage } from '../browser/session.js';
import { detectBlocker, type BlockerKind } from './detectors.js';
import { humanType, humanScroll, readingPause, sleep, randomBetween } from './humanize.js';
import { spinText } from './text-spinner.js';
import { logger } from '../utils/logger.js';

export interface PostToGroupOpts {
  ctx: BrowserContext;
  groupUrl: string;
  text: string;
  imagePath: string | null;
  spinVariations: boolean;
  typingMinMs: number;
  typingMaxMs: number;
  screenshotDir: string;
  jobId: string;
}

export interface PostToGroupResult {
  success: boolean;
  blocker?: BlockerKind;
  message: string;
  screenshotPath: string | null;
}

async function safeScreenshot(
  page: Page,
  dir: string,
  jobId: string,
  outcome: 'success' | 'fail',
): Promise<string | null> {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `job-${jobId}-${outcome}.png`);
    let captured = true;
    await page.screenshot({ path: file, fullPage: false }).catch((err) => {
      captured = false;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), file },
        'poster: screenshot capture failed',
      );
    });
    if (!captured) return null;
    // Verify the file actually landed on disk (some headless modes fail silently).
    if (!fs.existsSync(file)) {
      logger.warn({ file }, 'poster: screenshot file missing after capture');
      return null;
    }
    return file;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'poster: safeScreenshot threw',
    );
    return null;
  }
}

async function findFirstVisible(
  scope: Page | Locator,
  selectors: string[],
  timeoutMs = 4000,
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      if (await loc.isVisible({ timeout: 250 }).catch(() => false)) {
        return loc;
      }
    }
    await sleep(200);
  }
  return null;
}

/**
 * Returns up to N composer-trigger candidates ranked by confidence.
 *
 * Why a list and not a single locator: in the wild we sometimes match a button
 * that *looks* like a composer trigger but actually opens an unrelated modal
 * (e.g. the FB groups "פוסט אנונימי" feature button — its aria-label contains
 * "פוסט" so a broad keyword match grabs it, but clicking it shows an info
 * modal with no textbox). The caller tries each candidate in order until one
 * yields a visible textbox after the click, ESC-ing any wrong modal between
 * attempts. This makes the selector logic robust to a single false-positive
 * without giving up on the whole post.
 */
async function findComposerTriggerCandidates(
  page: Page,
  jobId?: string,
): Promise<Locator[]> {
  // FB's group feed React tree settles slowly: domcontentloaded fires long
  // before the inline composer mounts. Give networkidle more headroom and
  // a hydration buffer before any selectors run.
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 200));
    await page.waitForTimeout(1200);
  } catch {
    /* ignore */
  }

  const out: Locator[] = [];
  const seen = new Set<string>();
  // Dedup by element-handle identity using evaluate, so the same DOM node
  // matched by two strategies isn't tried twice.
  const tryAdd = async (loc: Locator | null) => {
    if (!loc) return;
    try {
      if (!(await loc.isVisible({ timeout: 200 }).catch(() => false))) return;
      const fingerprint = await loc.evaluate((el) => {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        return `${e.tagName}|${e.getAttribute('aria-label') ?? ''}|${Math.round(r.x)}x${Math.round(r.y)}|${Math.round(r.width)}x${Math.round(r.height)}`;
      }).catch(() => null);
      if (!fingerprint || seen.has(fingerprint)) return;
      seen.add(fingerprint);
      out.push(loc);
    } catch {
      /* ignore */
    }
  };

  // Strategy 1 — getByRole + name regex (most resilient).
  const reTexts =
    /(Write something|Write a post|What's on your mind|Create a (?:public )?post|Start a public post|Create post|Share something|כתבו? משהו|כתוב משהו|מה בא לך לכתוב|מה ברצונך לפרסם|צור פוסט|כתוב פוסט|פרסם משהו)/i;
  try {
    const byRole = page.getByRole('button', { name: reTexts }).first();
    if (await byRole.isVisible({ timeout: 6000 }).catch(() => false)) {
      await tryAdd(byRole);
    }
  } catch {
    /* ignore */
  }

  // Strategy 2 — aria-label substring match (older + Hebrew layouts).
  const ariaSelectors = [
    '[role="button"][aria-label*="Write something" i]',
    '[role="button"][aria-label*="Write a post" i]',
    '[role="button"][aria-label*="Create a post" i]',
    '[role="button"][aria-label*="Create post" i]',
    '[role="button"][aria-label*="What\'s on your mind" i]',
    '[role="button"][aria-label*="Start a post" i]',
    '[role="button"][aria-label*="Share something" i]',
    '[role="button"][aria-label*="כתוב משהו"]',
    '[role="button"][aria-label*="כתבו משהו"]',
    '[role="button"][aria-label*="כתוב פוסט"]',
    '[role="button"][aria-label*="צור פוסט"]',
    '[role="button"][aria-label*="פרסם משהו"]',
    '[role="button"][aria-label*="מה ברצונך"]',
  ];
  const byAria = await findFirstVisible(page, ariaSelectors, 3000);
  await tryAdd(byAria);

  // Strategy 3 — locate the literal text, climb to the nearest button.
  const textRegex =
    /^\s*(Write something\.{0,3}|What's on your mind\??|Create a (?:public )?post\.{0,3}|Start a public post\.{0,3}|Share something\.{0,3}|כתבו? משהו\.{0,3}|כתוב משהו\.{0,3}|מה בא לך לכתוב\??|צור פוסט\.{0,3}|פרסם משהו\.{0,3})\s*$/i;
  try {
    const textNode = page.getByText(textRegex).first();
    if (await textNode.isVisible({ timeout: 2000 }).catch(() => false)) {
      const button = textNode.locator('xpath=ancestor::*[@role="button"][1]').first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
        await tryAdd(button);
      } else {
        await tryAdd(textNode);
      }
    }
  } catch {
    /* ignore */
  }

  // Strategy 4 — read-only contenteditable that opens composer on click.
  try {
    const fakeBox = page
      .locator('[role="textbox"][contenteditable], [contenteditable="false"][role="textbox"]')
      .filter({ hasText: textRegex })
      .first();
    await tryAdd(fakeBox);
  } catch {
    /* ignore */
  }

  // Strategy 5 — broader keyword scan, scoped + size + position + blacklist.
  //
  // FB ships icon-only or A/B-tested composer triggers whose aria-label we
  // haven't enumerated, so a broad keyword fallback is necessary. To avoid
  // false-positives like the groups "פוסט אנונימי" / "Anonymous Post"
  // feature button (matches "פוסט" but opens an info modal, no textbox),
  // we filter aggressively:
  //   1. Container scope: must be inside a likely composer pagelet.
  //   2. Keyword inclusion: aria-label contains a compose verb/noun.
  //   3. Keyword EXCLUSION (blacklist): obvious non-composer features —
  //      anonymous post, report, save, search, join, mute, etc.
  //   4. Size: width >= 250px (real composer triggers are wide; the
  //      anonymous-post button observed at w=216 is below this floor).
  //   5. Position: y between 80 and 800 — composer is below the navbar
  //      and above the first post, never deep in the feed.
  //   6. Multiple candidates ranked by width descending: a wider button
  //      is more likely the real composer than a narrow icon-only one.
  const broadHebrew = /כתוב|כתבו|כתיבת|פרסם|שתף|חולק|פוסט/;
  const broadEnglish = /\b(write|post|share|create)\b/i;
  const blacklist =
    /(אנונימ|anonymous|דווח|report|מועדפים|saved|חיפוש|search|הצטרף|join|הזמ|invite|התחבר|sign\s*in|התחל|signup|sign\s*up|השתק|mute|חסום|block|בטל\s*חבר|leave|מעקב|follow|הסתר|hide|מחק|delete|ערוך|edit\s+post|תגובה|comment|שמור|save\s+post)/i;
  const containerSelectors = [
    '[data-pagelet*="GroupFeed" i]',
    '[data-pagelet*="GroupInlineComposer" i]',
    '[data-pagelet*="composer" i]',
    '[role="main"]',
  ];
  type Scored = { loc: Locator; aria: string; width: number; y: number };
  const scored: Scored[] = [];
  for (const containerSel of containerSelectors) {
    const container = page.locator(containerSel).first();
    if (!(await container.isVisible({ timeout: 500 }).catch(() => false))) continue;
    const candidates = await container.locator('[role="button"][aria-label]').all().catch(() => []);
    for (const c of candidates.slice(0, 30)) {
      const aria = (await c.getAttribute('aria-label').catch(() => null)) || '';
      if (!aria) continue;
      if (blacklist.test(aria)) continue;
      if (!broadHebrew.test(aria) && !broadEnglish.test(aria)) continue;
      if (!(await c.isVisible({ timeout: 200 }).catch(() => false))) continue;
      const box = await c.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.width < 250 || box.y < 80 || box.y > 800) continue;
      scored.push({ loc: c, aria, width: box.width, y: box.y });
    }
    if (scored.length > 0) break; // first container with hits wins
  }
  scored.sort((a, b) => b.width - a.width); // widest first
  for (const s of scored.slice(0, 4)) {
    logger.info(
      { jobId, ariaLabel: s.aria.slice(0, 120), w: Math.round(s.width), y: Math.round(s.y) },
      'poster: composer candidate via Strategy 5 (broad+filtered)',
    );
    await tryAdd(s.loc);
  }

  // Strategy 6 — visible composer textbox by placeholder.
  // Some FB layouts render the inline textbox directly; clicking it expands
  // the full composer in-place. The placeholder is canonically composer-y
  // ("Write something...") and rarely collides with comment textboxes which
  // use "Write a comment..." (already excluded by our placeholder regex).
  const placeholderRegex =
    /(Write something|Write a post|What's on your mind|Create a (?:public )?post|כתוב משהו|כתבו משהו|כתוב פוסט|מה ברצונך|מה בא לך לכתוב|פרסם משהו|צור פוסט)/i;
  try {
    const placeholderTextboxes = await page
      .locator('[role="textbox"][contenteditable]')
      .all()
      .catch(() => []);
    for (const tb of placeholderTextboxes.slice(0, 10)) {
      const placeholder =
        (await tb.getAttribute('aria-placeholder').catch(() => null)) ||
        (await tb.getAttribute('data-placeholder').catch(() => null)) ||
        (await tb.getAttribute('aria-label').catch(() => null)) ||
        '';
      if (!placeholder || !placeholderRegex.test(placeholder)) continue;
      if (!(await tb.isVisible({ timeout: 200 }).catch(() => false))) continue;
      logger.info({ jobId, placeholder: placeholder.slice(0, 120) }, 'poster: composer candidate via Strategy 6 (textbox placeholder)');
      await tryAdd(tb);
    }
  } catch {
    /* ignore */
  }

  // Strategy 7 — textContent match on clickable divs / tabindex elements.
  //
  // The current FB groups layout (observed across multiple groups) ships the
  // primary composer trigger as a div[role="button"] (or just tabindex=0)
  // whose only accessible content is a child span saying "כתבי משהו..." /
  // "Write something..." — no aria-label, no contenteditable role=textbox.
  // Strategies 1-6 all miss it. We walk clickable elements inside the feed
  // pagelet, match their textContent against a composer-phrase regex with a
  // tight length cap (so we don't match a full post body), and rank by width.
  //
  // Hebrew variants we cover: gendered imperatives (כתוב/כתבי/כתבו),
  // "מה את/אתה/אתם חושב…", "מה ברצונך…", "מה בא לך לכתוב", "פרסמי כאן",
  // "שתפי משהו", "רוצה לשתף". English: standard FB phrases.
  const composerTextRe =
    /(?:כת(?:וב|בי|בו)\s*משהו|כת(?:וב|בי|בו)\s*פוסט|מה\s*את[הם]?\s*חושב|מה\s*ברצונ[ךה]|מה\s*ב?א\s*ל[ךך]\s*לכתוב|פרסמ[יו]?\s*כאן|פרסמ[יו]?\s*משהו|שתפ[יו]?\s*משהו|רוצ[הי]\s*לשתף|Write\s+something|What'?s\s+on\s+your\s+mind|Create\s+a(?:\s+public)?\s+post|Start\s+a\s+(?:public\s+)?post|Share\s+something|Create\s+post)/i;
  const textScanContainers = [
    '[data-pagelet*="GroupFeed" i]',
    '[data-pagelet*="composer" i]',
    '[role="main"]',
  ];
  type ScoredText = { loc: Locator; text: string; width: number; y: number };
  for (const containerSel of textScanContainers) {
    const container = page.locator(containerSel).first();
    if (!(await container.isVisible({ timeout: 500 }).catch(() => false))) continue;
    const els = await container
      .locator('[role="button"], [tabindex="0"], [contenteditable]')
      .all()
      .catch(() => []);
    const textScored: ScoredText[] = [];
    for (const el of els.slice(0, 80)) {
      if (!(await el.isVisible({ timeout: 100 }).catch(() => false))) continue;
      const text = ((await el.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 80) continue;
      if (!composerTextRe.test(text)) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.width < 200 || box.y < 80 || box.y > 900) continue;
      textScored.push({ loc: el, text, width: box.width, y: box.y });
    }
    // Largest first — the parent composer trigger has wider bounds than
    // any inner span that also matches the same text.
    textScored.sort((a, b) => b.width - a.width);
    for (const s of textScored.slice(0, 4)) {
      logger.info(
        { jobId, text: s.text.slice(0, 100), w: Math.round(s.width), y: Math.round(s.y) },
        'poster: composer candidate via Strategy 7 (textContent match)',
      );
      await tryAdd(s.loc);
    }
    if (textScored.length > 0) break; // first container with hits wins
  }

  if (out.length === 0) {
    await dumpClickableElements(page, jobId);
  } else {
    logger.info({ jobId, candidateCount: out.length }, 'poster: composer trigger candidates ranked');
  }
  return out;
}

/**
 * Extended diagnostic: dump up to 40 visible clickable elements with both
 * aria-label AND textContent, plus tag/role/tabindex/contenteditable, so the
 * next selector iteration can match by text when aria-label is absent.
 *
 * The previous version only dumped aria-labels — that missed the actual
 * composer trigger entirely on layouts where it's a div[role="button"] with
 * a child span text "כתבי משהו..." and no aria-label of its own.
 *
 * Done in a single page.evaluate to avoid an N+1 round-trip storm on a page
 * that may have hundreds of clickable elements.
 *
 * Best-effort: any failure is swallowed — this runs on the failure path,
 * shouldn't mask the real error.
 */
async function dumpClickableElements(page: Page, jobId?: string): Promise<void> {
  try {
    const sample = await page
      .evaluate(() => {
        const els = Array.from(
          document.querySelectorAll(
            'div[role="button"], a[role="button"], button, [tabindex="0"], [contenteditable]',
          ),
        );
        const out: Array<{
          tag: string;
          ariaLabel: string | null;
          text: string;
          role: string | null;
          contentEditable: string | null;
          tabindex: string | null;
          x: number;
          y: number;
          w: number;
          h: number;
          visible: boolean;
        }> = [];
        const seen = new Set<Element>();
        for (const el of els) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (out.length >= 40) break;
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          const visible = r.width > 0 && r.height > 0;
          const text = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
          out.push({
            tag: e.tagName.toLowerCase(),
            ariaLabel: e.getAttribute('aria-label'),
            text,
            role: e.getAttribute('role'),
            contentEditable: e.getAttribute('contenteditable'),
            tabindex: e.getAttribute('tabindex'),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            visible,
          });
        }
        return out;
      })
      .catch(() => [] as never[]);
    logger.warn(
      { jobId, sampleCount: sample.length, sample },
      'poster: composer trigger not found — extended dump (button/role/tabindex/contenteditable)',
    );
  } catch {
    /* swallow — diagnostic only */
  }
}

async function findComposerTextbox(scope: Locator | Page): Promise<Locator | null> {
  const composerSelectors = [
    '[contenteditable="true"][role="textbox"][aria-placeholder*="post" i]',
    '[contenteditable="true"][role="textbox"][aria-placeholder*="public post" i]',
    '[contenteditable="true"][role="textbox"][aria-placeholder*="פוסט"]',
    '[contenteditable="true"][role="textbox"][aria-placeholder*="What\'s on your mind" i]',
    '[contenteditable="true"][role="textbox"][aria-placeholder*="מה בא לך לכתוב"]',
    '[contenteditable="true"][role="textbox"][aria-label*="What" i]',
    '[contenteditable="true"][role="textbox"][aria-label*="מה"]',
  ];
  const specific = await findFirstVisible(scope, composerSelectors, 6000);
  if (specific) return specific;

  try {
    const all = scope.locator('[contenteditable="true"][role="textbox"]');
    const count = await all.count().catch(() => 0);
    let best: Locator | null = null;
    let bestWidth = 0;
    for (let i = 0; i < Math.min(count, 6); i++) {
      const el = all.nth(i);
      const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
      if (!visible) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;
      if (box.width > bestWidth && box.width >= 250) {
        best = el;
        bestWidth = box.width;
      }
    }
    if (best) return best;
  } catch {
    /* ignore */
  }
  return null;
}

async function findPhotoButton(scope: Locator | Page): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Photo/video"]',
    '[aria-label="תמונה/וידאו"]',
    '[aria-label*="Attach a photo" i]',
    '[aria-label*="צרף תמונה"]',
    '[aria-label*="Photo" i][role="button"]',
    '[aria-label*="תמונה"][role="button"]',
  ];
  return findFirstVisible(scope, selectors, 4000);
}

async function findFileInput(scope: Locator | Page): Promise<Locator | null> {
  const candidates = [
    'input[type="file"][accept*="image"][multiple]',
    'input[type="file"][accept*="image"]',
    'input[type="file"][multiple]',
    'input[type="file"]',
  ];
  for (const sel of candidates) {
    const all = scope.locator(sel);
    const count = await all.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = all.nth(i);
      const accept = (await el.getAttribute('accept').catch(() => '')) || '';
      if (accept && !/image|\*/i.test(accept)) continue;
      return el;
    }
  }
  return null;
}

async function findPostSubmitButton(scope: Locator | Page): Promise<Locator | null> {
  const selectors = [
    '[aria-label="Post"]:not([aria-disabled="true"])',
    '[aria-label="פרסום"]:not([aria-disabled="true"])',
    '[aria-label="פרסם"]:not([aria-disabled="true"])',
    'div[role="button"][aria-label="Post"]',
    'div[role="button"][aria-label="פרסום"]',
    'div[role="button"][aria-label="פרסם"]',
  ];
  const direct = await findFirstVisible(scope, selectors, 4000);
  if (direct) return direct;

  try {
    const page = ('locator' in scope ? (scope as Locator).page() : (scope as Page));
    const byRole = page.getByRole('button', { name: /^(Post|פרסום|פרסם)$/i }).first();
    if (await byRole.isVisible({ timeout: 2000 }).catch(() => false)) return byRole;
  } catch {
    /* ignore */
  }
  return null;
}

export async function postToGroup(opts: PostToGroupOpts): Promise<PostToGroupResult> {
  const {
    ctx,
    groupUrl,
    imagePath,
    spinVariations,
    typingMinMs,
    typingMaxMs,
    screenshotDir,
    jobId,
  } = opts;

  let page: Page;
  try {
    page = await getOrCreatePage(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId }, 'poster: failed to acquire page');
    return { success: false, message, screenshotPath: null };
  }

  const text = spinVariations ? spinText(opts.text) : opts.text;

  try {
    logger.info({ jobId, groupUrl }, 'poster: navigating to group');
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await readingPause(1500, 3500);

    let blockerCheck = await detectBlocker(page);
    if (blockerCheck.blocked) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      logger.warn({ jobId, ...blockerCheck }, 'poster: blocked before composing');
      return {
        success: false,
        blocker: blockerCheck.kind,
        message: `Blocked: ${blockerCheck.kind} (${blockerCheck.evidence ?? 'n/a'})`,
        screenshotPath,
      };
    }

    await humanScroll(page, { steps: 2 });
    await readingPause(1000, 2500);

    const candidates = await findComposerTriggerCandidates(page, jobId);
    if (candidates.length === 0) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = 'Composer trigger not found (FB DOM may have changed)';
      logger.warn({ jobId }, `poster: ${msg}`);
      return { success: false, message: msg, screenshotPath };
    }

    // Try each candidate in rank order. A "wrong" trigger (e.g. anonymous-
    // post info button) opens a modal but has no textbox; on that signal we
    // ESC the modal and try the next-best candidate. Cap at 4 attempts so
    // a totally wrong page can't loop forever.
    let textbox: Locator | null = null;
    let scope: Locator | Page = page;
    // Reference to the dialog locator IF the successful candidate opened one.
    // Used by the post-submit wait to detect close-of-dialog as a success signal.
    let dialog: Locator | null = null;
    let dialogVisible = false;
    const maxAttempts = Math.min(candidates.length, 4);
    for (let i = 0; i < maxAttempts; i++) {
      const trigger = candidates[i];
      logger.info({ jobId, attempt: i + 1, of: maxAttempts }, 'poster: trying composer candidate');
      await trigger.click({ delay: randomBetween(40, 120) }).catch(() => {});
      await sleep(1500);

      const attemptDialog = page.locator('[role="dialog"]').first();
      const attemptDialogVisible = await attemptDialog.isVisible({ timeout: 3000 }).catch(() => false);
      const attemptScope: Locator | Page = attemptDialogVisible ? attemptDialog : page;
      if (attemptDialogVisible) {
        logger.info({ jobId, attempt: i + 1 }, 'poster: dialog opened, looking for textbox');
      } else {
        logger.info({ jobId, attempt: i + 1 }, 'poster: no dialog, looking for inline textbox');
      }
      await readingPause(600, 1200);

      const found = await findComposerTextbox(attemptScope);
      if (found) {
        textbox = found;
        scope = attemptScope;
        dialog = attemptDialogVisible ? attemptDialog : null;
        dialogVisible = attemptDialogVisible;
        logger.info({ jobId, attempt: i + 1 }, 'poster: composer textbox confirmed — proceeding');
        break;
      }

      // Wrong candidate. Close any modal it opened and continue.
      logger.warn({ jobId, attempt: i + 1 }, 'poster: candidate did not yield a textbox, trying next');
      if (attemptDialogVisible) {
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(800);
        // Sometimes ESC is intercepted; click outside as a fallback.
        const stillOpen = await attemptDialog.isVisible({ timeout: 500 }).catch(() => false);
        if (stillOpen) {
          await page.mouse.click(20, 20).catch(() => {});
          await sleep(500);
        }
      }
    }

    if (!textbox) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = `Composer textbox not found after trying ${maxAttempts} candidate(s)`;
      logger.warn({ jobId, attemptsTried: maxAttempts }, `poster: ${msg}`);
      return { success: false, message: msg, screenshotPath };
    }

    await textbox.click({ delay: randomBetween(40, 120) }).catch(() => {});
    await sleep(randomBetween(200, 500));
    await humanType(textbox, text, { minMs: typingMinMs, maxMs: typingMaxMs });
    await readingPause(800, 2000);

    if (imagePath) {
      const absImage = path.isAbsolute(imagePath) ? imagePath : path.resolve(imagePath);
      if (!fs.existsSync(absImage)) {
        const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
        const msg = `Image not found at path: ${absImage}`;
        logger.warn({ jobId, absImage }, `poster: ${msg}`);
        return { success: false, message: msg, screenshotPath };
      }

      const photoBtn = await findPhotoButton(scope);
      if (photoBtn) {
        await photoBtn.click({ delay: randomBetween(40, 120) }).catch(() => {});
        await sleep(randomBetween(400, 900));
      }

      const fileInput = await findFileInput(scope);
      if (!fileInput) {
        const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
        const msg = 'Photo file input not found';
        logger.warn({ jobId }, `poster: ${msg}`);
        return { success: false, message: msg, screenshotPath };
      }

      await fileInput.setInputFiles(absImage);

      const previewScope = scope === page ? page : (scope as Locator);
      const preview = previewScope.locator('img[src^="blob:"], img[src*="scontent"]').first();
      await preview.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {
        logger.warn({ jobId }, 'poster: image preview did not appear in 30s, continuing anyway');
      });
      await readingPause(1500, 3000);
    }

    await readingPause(2000, 4000);

    const submitBtn = await findPostSubmitButton(scope);
    if (!submitBtn) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = 'Post/פרסום submit button not found (or disabled)';
      logger.warn({ jobId }, `poster: ${msg}`);
      return { success: false, message: msg, screenshotPath };
    }

    await submitBtn.click({ delay: randomBetween(40, 120) });

    await Promise.race([
      textbox.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}),
      dialogVisible && dialog
        ? dialog.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {})
        : sleep(8000),
    ]);

    await sleep(3000);
    blockerCheck = await detectBlocker(page);
    if (blockerCheck.blocked) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      logger.warn({ jobId, ...blockerCheck }, 'poster: blocked after submit');
      return {
        success: false,
        blocker: blockerCheck.kind,
        message: `Blocked after submit: ${blockerCheck.kind} (${blockerCheck.evidence ?? 'n/a'})`,
        screenshotPath,
      };
    }

    const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'success');
    logger.info({ jobId, groupUrl }, 'poster: post submitted successfully');
    return {
      success: true,
      message: 'Posted successfully',
      screenshotPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId, groupUrl }, 'poster: unexpected error');
    const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
    return { success: false, message, screenshotPath };
  }
}
