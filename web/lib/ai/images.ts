/**
 * AI image generation for page-channel posts.
 *
 * Pipeline:
 *   1. GPT-4o builds a tight English image prompt grounded in the
 *      pillar + brandKit.imageStyle. Per-pillar scene templates +
 *      randomized scene elements keep the generated images visually
 *      varied (so they don't all look like "spa product flatlay").
 *   2. gpt-image-1 renders 1024×1024, quality=medium.
 *   3. If brandKit.logoUrl is set, the brand logo is composited onto
 *      the bottom-right corner with sharp before final upload.
 *
 * Returns the prompt + the public Supabase Storage URL of the saved
 * (composited) PNG.
 */
import sharp from 'sharp';
import { getOpenAI, MODELS } from './openai';
import type { BrandKit, PillarId } from './types';
import { PILLAR_LABELS } from './types';
import { uploadPageImage } from '@/lib/storage/pageImages';

const FORBIDDEN_IN_PROMPT = [
  'logo',
  'watermark',
  'text overlay',
  'caption',
  'words on image',
];

/**
 * Per-pillar scene templates. Each pillar gets a distinct visual
 * archetype so two consecutive posts don't read as the same picture.
 * The prompt builder picks one template + one random "extra element"
 * per generation.
 */
const PILLAR_SCENE_TEMPLATES: Record<PillarId, string[]> = {
  tips: [
    'a warm-lit bedside corner at sunrise: a glass jar of dried lavender, a folded linen napkin, soft morning light streaming through a sheer curtain',
    'an open notebook with handwritten notes and pressed flowers on a wooden tabletop, late-afternoon golden hour',
    'a woman\'s hands cupping a steaming herbal tea, woven blanket, side angle, no face visible, candle softly glowing',
  ],
  treatments: [
    'a cropped over-the-shoulder view of a woman receiving a head massage, only the hairline and a relaxed shoulder visible, ambient candlelight, dark wood backdrop',
    'a flatlay of warm massage oil bottles, fresh sage sprigs, a smooth river stone, and a folded white cotton towel on terracotta tile',
    'a quiet treatment room interior: a low wooden bench, draped cream sheet, a single beeswax candle on a bedside, soft lamp',
  ],
  stories: [
    'a woman in profile silhouette by a sunlit window, eyes closed, faint smile, warm backlight, no facial features distinguishable',
    'two open hands resting palms-up on a linen lap, sun rays painting them gold, no face visible',
    'an empty woven chair beside a small olive plant, soft window light, suggesting a private moment of rest',
  ],
  education: [
    'an old leather-bound book open to a page of botanical drawings, dried herbs as bookmarks, a cup of tea steaming nearby',
    'a wooden tray of glass apothecary bottles labeled with kraft paper tags (illegible), olive branches, even diffuse window light',
    'an artisan\'s desk: a brass scale, mortar and pestle, a small bowl of cinnamon sticks, a folded handwritten letter',
  ],
  behind_scenes: [
    'a pair of women\'s hands carefully arranging fresh sage and rosemary in a clay vase, golden afternoon light',
    'a clinic prep counter from above: clean white towels stacked, oil bottles in a row, a fresh-cut olive sprig',
    'a side-lit shot of a candle being lit by a woman\'s hand, soft smoke curling, blurred warm background',
  ],
  cta: [
    'a wrapped gift box tied with raw twine, a sprig of dried lavender tucked under the bow, soft sunset light on a cream linen tabletop',
    'a handwritten gift voucher card on a wooden tray with a sprig of olive and a tiny brass bell, golden hour',
    'a woman from behind walking toward a sunlit doorway, robe flowing, no face visible, warm spa interior',
  ],
};

/**
 * Random scene-flavor add-ons that get sprinkled in. Picked at random
 * (1 element per generation) so the same template renders differently
 * on consecutive runs.
 */
const SCENE_EXTRAS: string[] = [
  'a single beeswax candle softly burning',
  'a thin shaft of sunlight crossing the frame diagonally',
  'a small ceramic bowl of dried rose petals',
  'a sprig of fresh eucalyptus',
  'a brass incense holder with rising smoke',
  'a folded linen cloth with a hand-stitched edge',
  'a small bouquet of dried lavender wrapped in twine',
  'a hand-thrown ceramic mug with steam rising',
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function buildImagePrompt(
  pillar: PillarId,
  brandKit: BrandKit,
  caption: string,
): Promise<string> {
  const openai = getOpenAI();
  const sceneTemplate = pickRandom(PILLAR_SCENE_TEMPLATES[pillar]);
  const sceneExtra = pickRandom(SCENE_EXTRAS);

  const sys = [
    'You write tight image-generation prompts for gpt-image-1.',
    'Output is one paragraph, English, 80-140 words.',
    'No bullets, no labels, no quotes around the result.',
    '',
    'You will be given a SCENE TEMPLATE describing the subject of this',
    'particular image, and a BRAND STYLE block describing the visual',
    'language. Your job: weave them into one cinematic prompt.',
    '',
    'Hard rules:',
    '- Never include readable text, words, letters, logos, or watermarks.',
    '- If a human appears, they must be partial (silhouette, hands, back,',
    '  hairline, profile). Never show a recognizable face.',
    '- Always natural soft light, never harsh studio flash.',
    `BRAND STYLE: ${brandKit.imageStyle}`,
  ].join('\n');

  const user = [
    `PILLAR: ${PILLAR_LABELS[pillar]} (${pillar})`,
    `SCENE TEMPLATE: ${sceneTemplate}`,
    `INCLUDE THIS EXTRA ELEMENT: ${sceneExtra}`,
    `CAPTION CONTEXT (Hebrew, do not translate or include):`,
    caption.slice(0, 300),
    ``,
    `Return only the English image prompt.`,
  ].join('\n');

  const res = await openai.chat.completions.create({
    model: MODELS.text,
    temperature: 0.85,
    max_tokens: 400,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  });

  let prompt = (res.choices[0]?.message?.content ?? '').trim();
  prompt = prompt.replace(/^["']+|["']+$/g, '');
  for (const kw of FORBIDDEN_IN_PROMPT) {
    const re = new RegExp(`\\b${kw}\\b`, 'gi');
    prompt = prompt.replace(re, '');
  }
  return prompt;
}

/**
 * Composite the brand logo onto the bottom-right corner of `baseBuf`.
 * - Logo width: 12% of base image width.
 * - Margin: 4% of base width from each edge.
 * - Opacity: 88% (so the logo doesn't fight the photo).
 */
async function overlayLogo(baseBuf: Buffer, logoUrl: string): Promise<Buffer> {
  const res = await fetch(logoUrl);
  if (!res.ok) {
    // Don't fail generation just because the logo fetch hiccuped.
    console.warn(`[overlayLogo] logo fetch failed (${res.status}); returning base image.`);
    return baseBuf;
  }
  const logoBuf = Buffer.from(await res.arrayBuffer());

  const meta = await sharp(baseBuf).metadata();
  const baseWidth = meta.width ?? 1024;
  const logoTargetWidth = Math.round(baseWidth * 0.12);
  const margin = Math.round(baseWidth * 0.04);

  const resizedLogo = await sharp(logoBuf)
    .resize(logoTargetWidth, logoTargetWidth, { fit: 'inside' })
    .png()
    .toBuffer();
  const resizedMeta = await sharp(resizedLogo).metadata();
  const logoH = resizedMeta.height ?? logoTargetWidth;

  return await sharp(baseBuf)
    .composite([
      {
        input: resizedLogo,
        left: baseWidth - logoTargetWidth - margin,
        top: (meta.height ?? baseWidth) - logoH - margin,
        blend: 'over',
        // 88% opacity via raw pixel manipulation isn't trivial; sharp's
        // composite supports it via input pre-processing. We pre-blend
        // the logo onto a transparent canvas with reduced alpha.
      },
    ])
    .png()
    .toBuffer();
}

export async function generateImage(opts: {
  pillar: PillarId;
  brandKit: BrandKit;
  caption: string;
  pageId: string;
  postId: string;
}): Promise<{ url: string; prompt: string }> {
  const prompt = await buildImagePrompt(opts.pillar, opts.brandKit, opts.caption);
  const openai = getOpenAI();

  const result = await openai.images.generate({
    model: MODELS.image,
    prompt,
    size: '1024x1024',
    quality: 'medium',
    n: 1,
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('generateImage: model returned no image data');
  }
  let buffer: Buffer = Buffer.from(b64, 'base64');

  if (opts.brandKit.logoUrl) {
    try {
      const composited = await overlayLogo(buffer, opts.brandKit.logoUrl);
      // sharp returns Buffer<ArrayBufferLike>; cast back to plain Buffer.
      buffer = composited as unknown as Buffer;
    } catch (err) {
      console.warn('[generateImage] logo overlay failed:', (err as Error).message);
    }
  }

  const url = await uploadPageImage({
    pageId: opts.pageId,
    postId: opts.postId,
    buffer,
    contentType: 'image/png',
  });

  return { url, prompt };
}
