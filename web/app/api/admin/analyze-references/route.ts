/**
 * One-shot admin endpoint: take an array of public image URLs (already
 * uploaded to Supabase Storage by the local
 * `scripts/upload-brand-references.ts` helper), feed them to GPT-4o
 * vision, extract a dense visual style description, and write it to
 * the active page's `brandKit.imageStyle` field.
 *
 * Auth: Bearer CRON_SECRET. This is admin-grade — it rewrites brand
 * settings — so it stays on the cron auth path rather than a user
 * session.
 *
 * Why an endpoint and not a script:
 *   - OPENAI_API_KEY in Vercel was created as Sensitive, so
 *     `vercel env pull` cannot retrieve it. Running on Vercel's
 *     runtime is the only place the key is actually available.
 *
 * Body:
 *   { urls: string[], pageFbId?: string }
 *   - If `pageFbId` is omitted, we update the first active page.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { isAuthorizedCron, cronUnauthorized } from '../../_lib/cronAuth';
import { db } from '@/lib/db';
import { pages } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getOpenAI } from '@/lib/ai/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(40),
  pageFbId: z.string().min(1).max(50).optional(),
});

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) return cronUnauthorized();

  const body = bodySchema.parse(await req.json());

  const sysPrompt = [
    'You are a brand visual analyst.',
    'You will be shown multiple reference images representing a single',
    'wellness/spa brand "Einatural" (Hebrew massage clinic).',
    'Your job: extract a tight, dense visual style description in ENGLISH',
    'that another AI image generator (gpt-image-1) can use to produce new',
    'images that match this brand visually.',
    '',
    'OUTPUT FORMAT — exactly this structure, no markdown:',
    'Palette: <5-7 HEX colors with one-word labels, e.g. "#D4A574 warm sand">',
    'Mood: <2-3 short descriptors, comma-separated>',
    'Lighting: <one sentence>',
    'Composition: <one sentence — framing tendency, depth-of-field, perspective>',
    'Materials & textures: <comma-separated list of recurring physical items>',
    'Recurring objects: <comma-separated list of objects that appear often>',
    'Avoid: <things that would NOT match this brand>',
    '',
    'Total length: 80-150 words. Be specific. No marketing language.',
    'No "luxurious", "premium", "elevated" — describe what is actually there.',
  ].join('\n');

  const openai = getOpenAI();

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' | 'auto' } }
  > = [
    {
      type: 'text',
      text: `${body.urls.length} reference images attached. Look across all of them and extract the unified visual style — palette, mood, lighting, recurring elements — that defines this brand.`,
    },
  ];
  for (const url of body.urls) {
    content.push({
      type: 'image_url',
      image_url: { url, detail: 'low' },
    });
  }

  const start = Date.now();
  const res = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 600,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: content as never },
    ],
  });
  const elapsedMs = Date.now() - start;

  const styleDescription = res.choices[0]?.message?.content?.trim() ?? '';
  if (!styleDescription) {
    return Response.json(
      { ok: false, error: 'Vision returned empty content' },
      { status: 502 },
    );
  }

  // Update the target page's brandKit.imageStyle.
  const where = body.pageFbId
    ? and(eq(pages.fbPageId, body.pageFbId), eq(pages.active, true))
    : eq(pages.active, true);

  // jsonb merge — keep all other brandKit fields, only replace imageStyle.
  const result = await db
    .update(pages)
    .set({
      brandKit: sql`COALESCE(${pages.brandKit}, '{}'::jsonb) || jsonb_build_object('imageStyle', ${styleDescription}::text)`,
      updatedAt: new Date(),
    })
    .where(where)
    .returning({
      id: pages.id,
      fbPageId: pages.fbPageId,
      pageName: pages.pageName,
    });

  return Response.json({
    ok: true,
    elapsedMs,
    tokens: {
      prompt: res.usage?.prompt_tokens ?? null,
      completion: res.usage?.completion_tokens ?? null,
    },
    imagesAnalyzed: body.urls.length,
    pagesUpdated: result.length,
    page: result[0] ?? null,
    styleDescription,
  });
}
