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
  /**
   * Per-group shortlink replacement map { parent_url: child_url }.
   * When present, every parent_url found in the post text is replaced
   * with the corresponding child_url before typing — this is how the
   * cloud's dashboard knows which group brought a click.
   */
  shortlinks?: Record<string, string>;
}

/**
 * Why a job failed. Used by the cloud to decide whether to count the failure
 * toward `max_consecutive_fails` (campaign auto-pause) and by the worker to
 * decide cooldown duration. Transient kinds (composer_not_found, network)
 * recover on their own once the underlying flake clears; permanent kinds
 * (login_required, fb_blocked) need human attention.
 */
export type FailureKind =
  | 'composer_not_found'   // selectors didn't catch the trigger — DOM drift
  | 'composer_no_textbox'  // clicked trigger but no textbox appeared
  | 'login_required'       // session expired, need /connect
  | 'group_no_permission'  // user can't post in this group
  | 'fb_blocked'           // captcha/checkpoint/temp-block — back off
  | 'network_error'        // navigation/connectivity flake
  | 'image_missing'        // local image path invalid
  | 'submit_failed'        // composer opened but post button never clicked
  | 'submit_blocked'       // submit button intercepted by overlay/tooltip — Bug #9 iter7
  | 'unknown';

/**
 * Failure kinds that should NOT count toward the consecutive-failure streak
 * that triggers campaign auto-pause. These are technical or transient — they
 * resolve on their own and shouldn't freeze a working campaign over a single
 * DOM drift or network blip.
 */
export const TRANSIENT_FAILURE_KINDS: ReadonlySet<FailureKind> = new Set([
  'composer_not_found',
  'composer_no_textbox',
  'network_error',
  // submit_blocked is overlay-shaped (FB sticky banner / tooltip) — not a
  // permanent permission/captcha problem. Don't pause the campaign over it.
  'submit_blocked',
]);

export interface PostToGroupResult {
  success: boolean;
  blocker?: BlockerKind;
  message: string;
  screenshotPath: string | null;
  /** Why it failed. Always set when `success===false`. Omitted on success. */
  kind?: FailureKind;
}

async function safeScreenshot(
  page: Page,
  dir: string,
  jobId: string,
  outcome: 'success' | 'fail',
): Promise<string | null> {
  // Iter6 hardening — bug #8 reported only 1 of 4 success screenshots
  // landed on disk and 0 lines about screenshot/upload appeared in the
  // worker log. Four changes:
  //
  //   1. Get the screenshot as a Buffer first, then fs.writeFile ourselves.
  //      Previously page.screenshot({ path }) did both internally; if
  //      Playwright's path-write silently failed (rare but happens with
  //      page mid-transition or anti-virus interference) we'd get neither
  //      file nor error. Doing the write ourselves makes both halves
  //      observable.
  //   2. Explicit 8s timeout on page.screenshot (Playwright default is
  //      30s) so a hung capture fails fast and visibly.
  //   3. Log info on entry, capture, write, and exit. The previous
  //      version was silent on success which made root-causing
  //      impossible from logs alone.
  //   4. Validate buffer length > 0 BEFORE writing — a 0-byte buffer
  //      means the page wasn't ready to render, retry is hopeless.
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `job-${jobId}-${outcome}.png`);
    logger.info({ jobId, outcome, file }, 'poster: safeScreenshot capturing');

    let buffer: Buffer | null = null;
    try {
      buffer = await page.screenshot({ fullPage: false, timeout: 8000 });
    } catch (err) {
      logger.warn(
        { jobId, outcome, file, err: err instanceof Error ? err.message : String(err) },
        'poster: page.screenshot threw',
      );
      return null;
    }

    if (!buffer || buffer.length === 0) {
      logger.warn(
        { jobId, outcome, file, bufferLen: buffer?.length ?? 0 },
        'poster: screenshot buffer empty (page not rendering?)',
      );
      return null;
    }

    try {
      await fs.promises.writeFile(file, buffer);
    } catch (err) {
      logger.warn(
        { jobId, outcome, file, err: err instanceof Error ? err.message : String(err) },
        'poster: writeFile failed',
      );
      return null;
    }

    if (!fs.existsSync(file)) {
      logger.warn({ jobId, outcome, file }, 'poster: file missing immediately after writeFile');
      return null;
    }
    const stat = fs.statSync(file);
    if (stat.size === 0) {
      logger.warn({ jobId, outcome, file }, 'poster: file is 0 bytes after writeFile');
      return null;
    }

    logger.info(
      { jobId, outcome, file, sizeBytes: stat.size },
      'poster: safeScreenshot saved',
    );
    return file;
  } catch (err) {
    logger.warn(
      { jobId, outcome, err: err instanceof Error ? err.message : String(err) },
      'poster: safeScreenshot threw',
    );
    return null;
  }
}

/**
 * After clicking submit, FB sometimes shows a toast/notice when the group has
 * admin approval enabled — variants observed in Hebrew and English:
 *   - "Pending approval"
 *   - "Your post is pending approval"
 *   - "Pending review by group admins"
 *   - "הפוסט שלך ממתין לאישור"
 *   - "ממתין לאישור"
 *   - "הפוסט שלך ממתין לאישור מנהל הקבוצה"
 *
 * This runs RIGHT AFTER submit returns. We give it a short window (5s) to
 * appear — false negatives are OK (we'll just call it "Posted successfully"
 * when we can't tell), false positives are not (would mark a real post as
 * pending). The phrases are specific enough not to collide with other UI.
 */
async function detectPendingApproval(page: Page): Promise<boolean> {
  // Phrasing observed in production via GPT-4o vision on saved
  // screenshots — FB's actual toast says "Thanks for your post! It's
  // been submitted to group admins for approval" / "for review", which
  // didn't match my original short patterns. Adding the substrings
  // that consistently appear so we catch the toast at submit time
  // instead of relying on the cron-driven recheck.
  const phrases = [
    'pending approval',
    'pending admin approval',
    'pending review',
    'awaiting approval',
    'will be visible after approval',
    'submitted to group admins',
    'submitted to admins',
    'submitted for approval',
    'submitted for review',
    'thanks for your post',
    "it's been submitted",
    'has been submitted',
    'waiting for admin',
    'group admin must approve',
    'ממתין לאישור',
    'ממתינ', // catches "ממתין/ממתינה/ממתינים"
    'ממתינה לאישור',
    'הפוסט שלך ממתין',
    'אישור מנהל',
    'מחכה לאישור',
    'נשלח לאישור',
    'הוגש לאישור',
    'תודה על הפוסט',
    'יוצג לאחר אישור',
  ];
  // Compose a single regex of escaped alternatives to avoid N round-trips.
  const re = new RegExp(
    phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  );
  // 8s window (was 5s) — observed cases where toast appeared ~6s after
  // submit on slow connections. Polling cost is trivial.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const found = await page.evaluate((pattern: string) => {
        const r = new RegExp(pattern, 'i');
        // Look for visible toast/banner-ish elements only (small text blobs).
        const candidates = Array.from(document.querySelectorAll('div, span'));
        for (const el of candidates) {
          const text = (el.textContent || '').trim();
          if (!text || text.length > 200) continue;
          if (!r.test(text)) continue;
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width < 40 || rect.height < 16) continue;
          if (rect.bottom < 0 || rect.top > (window.innerHeight || 800)) continue;
          return text.slice(0, 120);
        }
        return null;
      }, re.source);
      if (found) {
        logger.info({ phrase: found.slice(0, 80) }, 'poster: detected pending-approval toast');
        return true;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  return false;
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
  // Patterns updated iter5: added "כאן כותבים…" / "כותבים כאן" (impersonal
  // plural — gender-neutral form FB uses across many groups), more share/
  // post-here variants, and English "write here" / "post here" / "post to
  // group". The "כאן כותבים…" trigger was the deal-breaker found in iter4
  // dump v2 — a div[role="button" tabindex="0"] with this exact text and
  // no aria-anything.
  const composerTextRe =
    /(?:כת(?:וב|בי|בו)\s*(?:משהו|פוסט|כאן)|כאן\s*כותב(?:ים|ות|ת|י)?|כותב(?:ים|ות|ת|י)?\s*כאן|מה\s*את(?:ה|ם|ן)?\s*חושב|מה\s*ברצונ[ךה]|מה\s*ב?א\s*ל[ךי]\s*לכתוב|פרסמ[יוןן]?\s*(?:כאן|משהו|לקבוצה|בקבוצה)|שתפ[יוןן]?\s*(?:כאן|משהו|לקבוצה)|רוצ[הי]\s*לשתף|פוסט\s+חדש|Write\s+(?:something|here|a\s+post)|What'?s\s+on\s+your\s+mind|Create\s+a(?:\s+public)?\s+post|Start\s+a\s+(?:public\s+)?post|Share\s+(?:something|here)|Post\s+(?:here|to\s+group)|Create\s+post)/i;
  const textScanContainers = [
    '[data-pagelet*="GroupFeed" i]',
    '[data-pagelet*="composer" i]',
    '[role="main"]',
    '[data-pagelet="ProfileTimeline"]',
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
    // Slice raised 80 → 120 (composer can sit deep when group has dense
    // recommendation cards above). Length cap tightened 80 → 40 — real
    // placeholders are short; longer text is a wrapper that bundled a
    // post body (false positive guard).
    for (const el of els.slice(0, 120)) {
      if (!(await el.isVisible({ timeout: 100 }).catch(() => false))) continue;
      const text = ((await el.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 40) continue;
      if (!composerTextRe.test(text)) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;
      // y window 80-1100 (was 80-900: "כאן כותבים…" observed at y=757).
      if (box.width < 200 || box.y < 80 || box.y > 1100) continue;
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

  // Strategy 8 — placeholder leaf → climb to clickable ancestor.
  //
  // FB renders the composer trigger as a div[role="button"] wrapping a tiny
  // leaf node (span/div) holding the placeholder text "כתבי משהו..." —
  // strategies 1-7 miss it because:
  //   - Strategy 3 uses anchored regex (^...$) and the parent's textContent
  //     concatenates avatar/decorations alongside the placeholder.
  //   - Strategy 7 caps textContent at 80 chars; the parent button text
  //     exceeds this when avatar/aria-decorations are concatenated.
  //
  // Approach: use Playwright's getByText() to find the leaf node containing
  // the literal placeholder phrase (substring match — handles "כתבי משהו..."
  // matching the search "כתבי משהו"), then climb to the nearest role=button
  // / contenteditable / role=textbox ancestor. The ancestor is the actual
  // click target.
  const placeholderPhrases = [
    // Hebrew gendered imperatives
    'כתבי משהו',
    'כתוב משהו',
    'כתבו משהו',
    'כתבי פוסט',
    'כתוב פוסט',
    'כתבו פוסט',
    // Hebrew impersonal plural — observed in iter4 dump as the actual trigger
    'כאן כותבים',
    'כאן כותבות',
    'כאן כותבת',
    'כותבים כאן',
    'כותבות כאן',
    'כתבו כאן',
    'כתוב כאן',
    'כתבי כאן',
    // Hebrew questions
    'מה בא לך לכתוב',
    'מה ברצונך לפרסם',
    'מה ברצונך',
    // Hebrew share/post
    'פרסמי כאן',
    'פרסם משהו',
    'פרסם כאן',
    'פרסמו כאן',
    'שתפי משהו',
    'שתף משהו',
    'שתפי כאן',
    // English
    'Write something',
    'Write here',
    "What's on your mind",
    'Create a post',
    'Create a public post',
    'Start a public post',
    'Share something',
    'Share here',
    'Post here',
    'Post to group',
  ];
  for (const phrase of placeholderPhrases) {
    try {
      const textNode = page.getByText(phrase, { exact: false }).first();
      if (!(await textNode.isVisible({ timeout: 500 }).catch(() => false))) continue;
      // Try ancestors in priority order: role=button → contenteditable → role=textbox.
      const ancestorButton = textNode
        .locator('xpath=ancestor-or-self::*[@role="button"][1]')
        .first();
      let added = false;
      if (await ancestorButton.isVisible({ timeout: 400 }).catch(() => false)) {
        const box = await ancestorButton.boundingBox().catch(() => null);
        if (box && box.width >= 150 && box.y >= 80 && box.y <= 1100) {
          logger.info(
            { jobId, phrase, w: Math.round(box.width), y: Math.round(box.y) },
            'poster: composer candidate via Strategy 8 (placeholder leaf → role=button)',
          );
          await tryAdd(ancestorButton);
          added = true;
        }
      }
      if (!added) {
        const ancestorEditable = textNode
          .locator('xpath=ancestor-or-self::*[@contenteditable or @role="textbox"][1]')
          .first();
        if (await ancestorEditable.isVisible({ timeout: 400 }).catch(() => false)) {
          logger.info(
            { jobId, phrase },
            'poster: composer candidate via Strategy 8 (placeholder leaf → contenteditable/textbox)',
          );
          await tryAdd(ancestorEditable);
          added = true;
        }
      }
      if (!added) {
        // No clickable ancestor; the leaf itself often works (FB sometimes
        // attaches the click handler directly).
        logger.info(
          { jobId, phrase },
          'poster: composer candidate via Strategy 8 (placeholder leaf, no clickable ancestor)',
        );
        await tryAdd(textNode);
      }
    } catch {
      /* ignore */
    }
  }

  // Strategy 9 — aria-placeholder match on any element, climb to clickable.
  //
  // Catches the FB layout variant where the composer is a div with
  // aria-placeholder set on the textbox/button itself but no role=textbox
  // (Strategy 6 required role=textbox; this one doesn't).
  const ariaPlaceholderSelectors = [
    '[aria-placeholder*="כתבי משהו"]',
    '[aria-placeholder*="כתוב משהו"]',
    '[aria-placeholder*="כתבו משהו"]',
    '[aria-placeholder*="כתבי פוסט"]',
    '[aria-placeholder*="פרסמי" i]',
    '[aria-placeholder*="פרסם משהו"]',
    '[aria-placeholder*="מה ברצונ" i]',
    '[aria-placeholder*="מה בא לך"]',
    '[aria-placeholder*="Write something" i]',
    '[aria-placeholder*="What\'s on your mind" i]',
    '[aria-placeholder*="Create a post" i]',
    '[aria-placeholder*="Share something" i]',
  ];
  for (const sel of ariaPlaceholderSelectors) {
    try {
      const el = page.locator(sel).first();
      if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
      const ancestor = el
        .locator(
          'xpath=ancestor-or-self::*[@role="button" or @contenteditable or @role="textbox"][1]',
        )
        .first();
      if (await ancestor.isVisible({ timeout: 300 }).catch(() => false)) {
        logger.info({ jobId, selector: sel }, 'poster: composer candidate via Strategy 9 (aria-placeholder)');
        await tryAdd(ancestor);
      } else {
        await tryAdd(el);
      }
    } catch {
      /* ignore */
    }
  }

  if (out.length === 0) {
    await dumpClickableElements(page, jobId);
  } else {
    logger.info({ jobId, candidateCount: out.length }, 'poster: composer trigger candidates ranked');
  }
  return out;
}

/**
 * Extended diagnostic v2: smarter sampling that actually shows the composer
 * area when our selectors fail.
 *
 * Iteration 3 in the field hit `sampleCount: 40` but the composer at y=622
 * was absent from the dump — 22 of the 40 entries were empty `<a tabindex="0">`
 * avatar links above the composer in DOM order, and the cap of 40 cut off
 * before reaching it. This version:
 *
 *   1. Scrolls the page mid-feed first to force lazy-rendered elements
 *      (FB only mounts the composer once it's near the viewport).
 *   2. Filters out tiny / off-screen / obviously-decorative elements
 *      (avatars are typically w<80, h<32, empty text, no aria-label).
 *   3. Sorts by y ascending so vertically-clustered groups (header, then
 *      composer area, then feed) appear in spatial order, not DOM order.
 *   4. Caps at 100 (was 40).
 *   5. Includes aria-placeholder and data-text attributes — common
 *      placeholder carriers on FB's contenteditable composer.
 *
 * Single page.evaluate to avoid N+1 roundtrip storm.
 */
async function dumpClickableElements(page: Page, jobId?: string): Promise<void> {
  // Scroll to force lazy-mounted composer to render before we sample.
  try {
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(300);
  } catch {
    /* ignore */
  }

  try {
    const sample = await page
      .evaluate(() => {
        const els = Array.from(
          document.querySelectorAll(
            'div[role="button"], a[role="button"], button, [tabindex="0"], [contenteditable], [aria-placeholder], [role="textbox"]',
          ),
        );
        const seen = new Set<Element>();
        const enriched: Array<{ el: HTMLElement; r: DOMRect }> = [];
        for (const el of els) {
          if (seen.has(el)) continue;
          seen.add(el);
          enriched.push({ el: el as HTMLElement, r: (el as HTMLElement).getBoundingClientRect() });
        }
        // Filter: drop tiny avatars, off-screen, or empty leaf links.
        const filtered = enriched.filter(({ el, r }) => {
          if (r.width < 80 || r.height < 20) return false;
          if (r.x < -200 || r.y < -200) return false;
          if (r.y > 2200) return false;
          const text = (el.textContent || '').trim();
          const aria = el.getAttribute('aria-label') || '';
          const placeholder = el.getAttribute('aria-placeholder') || '';
          // Empty <a> with no aria-label is almost certainly a member-avatar link
          if (!text && !aria && !placeholder && el.tagName.toLowerCase() === 'a') {
            return false;
          }
          return true;
        });
        // Sort by y ascending so the composer row (y ~ 400-700) shows up
        // alongside its neighbors, not buried after a sea of avatars.
        filtered.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
        return filtered.slice(0, 100).map(({ el, r }) => {
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
          return {
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute('aria-label'),
            text,
            role: el.getAttribute('role'),
            contentEditable: el.getAttribute('contenteditable'),
            tabindex: el.getAttribute('tabindex'),
            ariaPlaceholder: el.getAttribute('aria-placeholder'),
            dataText: el.getAttribute('data-text'),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            visible: r.width > 0 && r.height > 0,
          };
        });
      })
      .catch(() => [] as never[]);
    logger.warn(
      { jobId, sampleCount: sample.length, sample },
      'poster: composer trigger not found — extended dump v2 (filtered, y-sorted, cap 100)',
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
    return { success: false, message, screenshotPath: null, kind: 'network_error' };
  }

  // Apply spinner first (so a {a|b} variation doesn't accidentally produce
  // a parent_url string we wouldn't otherwise replace), then swap parent
  // shortlinks for their group-specific children. If neither feature is
  // configured this is a no-op.
  let text = spinVariations ? spinText(opts.text) : opts.text;
  if (opts.shortlinks) {
    let replacements = 0;
    for (const [parentUrl, childUrl] of Object.entries(opts.shortlinks)) {
      if (!parentUrl || !childUrl || parentUrl === childUrl) continue;
      if (text.includes(parentUrl)) {
        text = text.split(parentUrl).join(childUrl);
        replacements += 1;
      }
    }
    if (replacements > 0) {
      logger.info(
        { jobId, replacements },
        'poster: swapped parent shortlinks for group-specific children',
      );
    }
  }

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
        kind: blockerCheck.kind === 'login-required' ? 'login_required' : 'fb_blocked',
      };
    }

    await humanScroll(page, { steps: 2 });
    await readingPause(1000, 2500);

    const candidates = await findComposerTriggerCandidates(page, jobId);
    if (candidates.length === 0) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = 'Composer trigger not found (FB DOM may have changed)';
      logger.warn({ jobId }, `poster: ${msg}`);
      return { success: false, message: msg, screenshotPath, kind: 'composer_not_found' };
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
      return { success: false, message: msg, screenshotPath, kind: 'composer_no_textbox' };
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
        return { success: false, message: msg, screenshotPath, kind: 'image_missing' };
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
        return { success: false, message: msg, screenshotPath, kind: 'submit_failed' };
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
      return { success: false, message: msg, screenshotPath, kind: 'submit_failed' };
    }

    // Bug #9 (iter7) — FB sometimes layers an overlay div on top of the
    // submit button (notification banners, sticky headers, tooltips).
    // The default click waits for pointer-events to be free; that wait
    // never resolves and we time out at 30s, scoring ~90 consecutive
    // failures. Approach: scroll into view, click with force:true on a
    // 5s budget, fall back to Ctrl+Enter (FB composer accepts it).
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
    let submitted = false;
    let submitErrMsg = '';
    try {
      await submitBtn.click({ force: true, timeout: 5000, delay: randomBetween(40, 120) });
      submitted = true;
    } catch (clickErr) {
      submitErrMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
      logger.warn(
        { jobId, err: submitErrMsg.slice(0, 200) },
        'poster: forced submit click failed, trying Ctrl+Enter fallback',
      );
      try {
        await textbox.focus();
        await page.keyboard.press('Control+Enter');
        submitted = true;
      } catch (kbErr) {
        const kbErrMsg = kbErr instanceof Error ? kbErr.message : String(kbErr);
        logger.warn(
          { jobId, err: kbErrMsg.slice(0, 200) },
          'poster: Ctrl+Enter fallback also failed',
        );
      }
    }

    if (!submitted) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg =
        'Submit button blocked by overlay (pointer-events intercept) — neither force-click nor Ctrl+Enter worked';
      logger.warn({ jobId, originalErr: submitErrMsg.slice(0, 300) }, `poster: ${msg}`);
      return {
        success: false,
        message: msg,
        screenshotPath,
        kind: 'submit_blocked',
      };
    }

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
        kind: blockerCheck.kind === 'login-required' ? 'login_required' : 'fb_blocked',
      };
    }

    const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'success');

    // Detect "Pending moderator approval" — FB shows a toast/notice after
    // submit when the group has admin-approval enabled. Without this check
    // we'd return success even though the post never becomes visible.
    const pendingApproval = await detectPendingApproval(page).catch(() => false);
    if (pendingApproval) {
      logger.info({ jobId, groupUrl }, 'poster: post submitted — pending moderator approval');
      return {
        success: true,
        message: 'Pending moderator approval',
        screenshotPath,
      };
    }

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
    // Network/timeout errors thrown by Playwright look like "Timeout 45000ms
    // exceeded" or "net::ERR_*" — bucket those as transient.
    const isNetworkLike = /timeout|net::|ERR_|ECONN|ENOTFOUND|navigation/i.test(message);
    return {
      success: false,
      message,
      screenshotPath,
      kind: isNetworkLike ? 'network_error' : 'unknown',
    };
  }
}
