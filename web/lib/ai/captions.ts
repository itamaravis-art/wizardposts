/**
 * Caption generation. Produces 3 distinct Hebrew captions for a given
 * pillar, all consistent with the brand kit's voice, audience and CTA.
 *
 * The model returns JSON with a `variants` array — we parse that
 * defensively (sometimes models add prose around it) and validate
 * each variant's length/structure.
 */
import { getOpenAI, MODELS } from './openai';
import type { BrandKit, PillarId } from './types';
import { PILLAR_LABELS } from './types';

interface RawResponse {
  variants?: string[];
}

const MIN_WORDS = 30;
const MAX_WORDS = 200;

export async function generateCaptions(opts: {
  pillar: PillarId;
  brandKit: BrandKit;
  count?: number;
}): Promise<string[]> {
  const count = opts.count ?? 3;
  const openai = getOpenAI();

  const sys = [
    `אתה כותב/ת תוכן בעברית עבור עמוד פייסבוק עסקי בתחום הרווחה ההוליסטית.`,
    `הקול: ${opts.brandKit.tone}`,
    `הקהל: ${opts.brandKit.audience}`,
    `כללי כתיבה:`,
    `- כתוב/י בעברית בלבד.`,
    `- אורך כל וריאציה ${MIN_WORDS}-${MAX_WORDS} מילים.`,
    `- שילוב של 1-3 אמוג'ים רלוונטיים, לא יותר.`,
    `- אסור: "מהפכני", "פורץ דרך", "בלעדי", "הזדמנות פעם בחיים", או כל קלישאה שיווקית.`,
    `- אסור: סימני קריאה כפולים (!!) או הבטחות מוגזמות.`,
    `- מבנה: שורת hook חזקה → תוכן/ערך → קריאה לפעולה.`,
    `- האשטגים בסוף הטקסט: ${opts.brandKit.hashtags.join(' ')}`,
    `- קריאה לפעולה ברירת מחדל: ${opts.brandKit.cta}`,
    ``,
    `החזר/י תשובה JSON תקנית בלבד בפורמט: { "variants": ["...", "...", "..."] }`,
    `אסור טקסט נוסף לפני או אחרי ה-JSON. אסור סימוני markdown סביב.`,
  ].join('\n');

  const user = [
    `העמוד תוכן: ${PILLAR_LABELS[opts.pillar]} (קוד: ${opts.pillar})`,
    `כתוב/י ${count} וריאציות שונות זו מזו, שכל אחת עומדת בכל הכללים מעל.`,
    `כל וריאציה היא טקסט אחד מלא — אל תפצל לחלקים.`,
  ].join('\n');

  const response = await openai.chat.completions.create({
    model: MODELS.text,
    response_format: { type: 'json_object' },
    temperature: 0.85,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';
  let parsed: RawResponse;
  try {
    parsed = JSON.parse(raw) as RawResponse;
  } catch {
    throw new Error(`generateCaptions: model returned non-JSON. Raw start: ${raw.slice(0, 80)}…`);
  }

  const variants = Array.isArray(parsed.variants)
    ? parsed.variants.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];

  if (variants.length === 0) {
    throw new Error('generateCaptions: model returned 0 variants');
  }

  // Best-effort length sanity. Don't reject — log so we can tune.
  const tooShort = variants.filter((v) => v.split(/\s+/).length < MIN_WORDS).length;
  const tooLong = variants.filter((v) => v.split(/\s+/).length > MAX_WORDS).length;
  if (tooShort + tooLong > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[captions] ${tooShort} too short, ${tooLong} too long, kept anyway.`,
    );
  }

  // Pad with the first variant if the model returned fewer than asked
  // (rare, but keeps the 3-variant contract for the UI).
  while (variants.length < count) variants.push(variants[0]!);
  const trimmed = variants.slice(0, count);

  // Append the action URL (e.g. WhatsApp shortlink) on its own line so
  // every published post ends with a clickable link. We do this AFTER
  // generation so we don't depend on the LLM remembering the exact URL.
  const actionUrl = opts.brandKit.actionUrl?.trim();
  if (actionUrl) {
    return trimmed.map((v) => `${v.trimEnd()}\n\n${actionUrl}`);
  }
  return trimmed;
}
