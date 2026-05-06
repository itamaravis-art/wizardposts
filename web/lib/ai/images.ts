/**
 * AI image generation for page-channel posts.
 *
 * Two-step pipeline:
 *   1. GPT-4o builds a tight English image prompt grounded in the
 *      pillar + brandKit.imageStyle. Hebrew→English here (gpt-image-1
 *      is much stronger on English prompts) but the source-of-truth
 *      style description is still in Hebrew on the brand kit, so the
 *      LLM does the translation each time.
 *   2. gpt-image-1 renders 1024×1024 quality=medium. The plan caps
 *      cost at ~$0.04/image; medium quality is the sweet spot.
 *
 * Returns the prompt + the public Supabase Storage URL of the saved
 * PNG (so Graph API can fetch it when we publish).
 */
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
 * Build the English image prompt from the pillar + brand style.
 * Pure GPT-4o call, no image model yet.
 */
async function buildImagePrompt(
  pillar: PillarId,
  brandKit: BrandKit,
  caption: string,
): Promise<string> {
  const openai = getOpenAI();
  const sys = [
    'You write tight image-generation prompts for gpt-image-1.',
    'Output is one paragraph, English, 60-120 words.',
    'No bullets, no labels, no quotes around the result.',
    'Always describe a still scene with no humans visible (the brand prefers',
    'object/atmosphere shots for spa/wellness).',
    `Brand image style: ${brandKit.imageStyle}`,
    `Hard rules: never include text, logos, watermarks, or readable letters in the image.`,
    `Style notes that ALWAYS apply: natural soft light, warm earthy palette,`,
    `boutique-spa atmosphere, photographic, shallow depth of field.`,
  ].join(' ');

  const user = [
    `Pillar: ${PILLAR_LABELS[pillar]}`,
    `Caption excerpt (Hebrew, for context only — do NOT include in image):`,
    caption.slice(0, 400),
    ``,
    `Return only the English image prompt.`,
  ].join('\n');

  const res = await openai.chat.completions.create({
    model: MODELS.text,
    temperature: 0.7,
    max_tokens: 400,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  });
  let prompt = (res.choices[0]?.message?.content ?? '').trim();
  prompt = prompt.replace(/^["']+|["']+$/g, '');
  // Belt-and-braces — strip any obvious "include text" leakage.
  for (const kw of FORBIDDEN_IN_PROMPT) {
    const re = new RegExp(`\\b${kw}\\b`, 'gi');
    prompt = prompt.replace(re, '');
  }
  return prompt;
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

  // gpt-image-1 returns base64 PNG by default in the data field.
  const result = await openai.images.generate({
    model: MODELS.image,
    prompt,
    size: '1024x1024',
    quality: 'medium',
    n: 1,
    // Background is already implied by the prompt; explicit "auto" is fine.
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('generateImage: model returned no image data');
  }
  const buffer = Buffer.from(b64, 'base64');
  const url = await uploadPageImage({
    pageId: opts.pageId,
    postId: opts.postId,
    buffer,
    contentType: 'image/png',
  });

  return { url, prompt };
}
