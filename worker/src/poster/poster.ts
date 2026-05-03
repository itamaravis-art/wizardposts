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

async function findComposerTrigger(page: Page): Promise<Locator | null> {
  try {
    await page.evaluate(() => window.scrollTo(0, 350));
    await page.waitForTimeout(800);
  } catch {
    /* ignore */
  }

  const reTexts = /(Write something|What's on your mind|Create a (?:public )?post|כתבו? משהו|מה בא לך לכתוב|צור פוסט)/i;
  try {
    const byRole = page.getByRole('button', { name: reTexts }).first();
    if (await byRole.isVisible({ timeout: 4000 }).catch(() => false)) return byRole;
  } catch {
    /* ignore */
  }

  const ariaSelectors = [
    '[role="button"][aria-label*="Write something" i]',
    '[role="button"][aria-label*="Create a post" i]',
    '[role="button"][aria-label*="What\'s on your mind" i]',
    '[role="button"][aria-label*="כתוב משהו"]',
    '[role="button"][aria-label*="כתבו משהו"]',
    '[role="button"][aria-label*="צור פוסט"]',
  ];
  const byAria = await findFirstVisible(page, ariaSelectors, 2000);
  if (byAria) return byAria;

  try {
    const textNode = page
      .getByText(/^\s*(Write something\.\.\.|What's on your mind\?|כתבו? משהו\.\.\.|מה בא לך לכתוב\?)\s*$/i)
      .first();
    if (await textNode.isVisible({ timeout: 2000 }).catch(() => false)) {
      const button = textNode.locator('xpath=ancestor::*[@role="button"][1]').first();
      if (await button.isVisible({ timeout: 1000 }).catch(() => false)) return button;
      return textNode;
    }
  } catch {
    /* ignore */
  }

  return null;
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

    const trigger = await findComposerTrigger(page);
    if (!trigger) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = 'Composer trigger not found (FB DOM may have changed)';
      logger.warn({ jobId }, `poster: ${msg}`);
      return { success: false, message: msg, screenshotPath };
    }

    await trigger.click({ delay: randomBetween(40, 120) });
    await sleep(1500);

    let scope: Locator | Page = page;
    const dialog = page.locator('[role="dialog"]').first();
    const dialogVisible = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    if (dialogVisible) {
      scope = dialog;
      logger.info({ jobId }, 'poster: using modal-dialog composer');
    } else {
      logger.info({ jobId }, 'poster: using inline composer (no dialog)');
    }
    await readingPause(800, 1800);

    const textbox = await findComposerTextbox(scope);
    if (!textbox) {
      const screenshotPath = await safeScreenshot(page, screenshotDir, jobId, 'fail');
      const msg = 'Composer textbox not found';
      logger.warn({ jobId }, `poster: ${msg}`);
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
      dialogVisible
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
