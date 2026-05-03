// Spintax processor — replaces {a|b|c} groups with one random option. Supports 1-level nesting.
// Copied from FACEBOOKPOST/src/poster/text-spinner.ts.

import { logger } from '../utils/logger.js';

function pickOne(options: string[]): string {
  if (options.length === 0) return '';
  const idx = Math.floor(Math.random() * options.length);
  return options[idx] ?? '';
}

export function spinText(template: string): string {
  if (!template || (!template.includes('{') && !template.includes('}'))) {
    return template;
  }

  const innermost = /\{([^{}]*)\}/g;

  let out = template;
  for (let pass = 0; pass < 2; pass++) {
    if (!innermost.test(out)) break;
    innermost.lastIndex = 0;
    out = out.replace(innermost, (_full, body: string) => {
      const options = body.split('|');
      return pickOne(options);
    });
  }

  if (out.includes('{') || out.includes('}')) {
    logger.warn({ template }, 'spinText: unmatched braces left intact');
  }

  return out;
}
