// CLI entry: opens a visible browser, polls until the user logs in, persists state
// to the cloud API (no local DB).

import { launchBrowser } from './launcher.js';
import { getOrCreatePage, isLoggedIn, getLoggedInUserName } from './session.js';
import { logger } from '../utils/logger.js';
import { setConnectionStatus } from '../api-client.js';

async function main(): Promise<void> {
  const token = process.env.WORKER_TOKEN;
  const apiBase = process.env.API_BASE_URL;
  if (!token || !apiBase) {
    logger.error(
      'connect: WORKER_TOKEN and API_BASE_URL must be set in .env before connecting Facebook',
    );
    process.exit(1);
  }

  logger.info('connect: launching browser');
  const ctx = await launchBrowser();
  const page = await getOrCreatePage(ctx);

  let exited = false;
  const exit = (code: number): void => {
    if (exited) return;
    exited = true;
    process.exit(code);
  };

  ctx.on('close', () => {
    logger.info('connect: browser context closed');
    exit(0);
  });
  page.on('close', () => {
    logger.info('connect: page closed');
    setTimeout(() => exit(0), 200);
  });

  try {
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
  } catch (err) {
    logger.warn({ err }, 'connect: initial navigation failed, will continue polling');
  }

  logger.info('connect: waiting for manual login...');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (exited) return;
    const ok = await isLoggedIn(page).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 3000));
  }

  const name = await getLoggedInUserName(page).catch(() => null);
  logger.info({ name }, 'connect: login detected');

  // Persist connected state via cloud API (replaces old local-DB write).
  try {
    await setConnectionStatus({ connected: true, userName: name ?? undefined });
    logger.info('connect: cloud API updated with fb_connected=true');
  } catch (err) {
    logger.error({ err }, 'connect: failed to persist fb_connected to cloud API');
  }

  // eslint-disable-next-line no-console
  console.log(
    `Logged in as ${name ?? 'Facebook user'}. Cookies saved. You can close this window.`,
  );
}

main().catch((err) => {
  logger.error({ err }, 'connect: fatal error');
  process.exit(1);
});
