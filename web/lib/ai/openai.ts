/**
 * Singleton OpenAI client. Constructed lazily on first use so cold-start
 * cost is paid only by routes that actually call AI (not every request).
 *
 * The API key comes from the standard `OPENAI_API_KEY` env var. Falls
 * back to a clear error if missing — better than the SDK's generic
 * "401 Unauthorized" 30s into the request.
 */
import OpenAI from 'openai';

let client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY env var is not set. Add it in Vercel project settings or .env.local.',
    );
  }
  client = new OpenAI({ apiKey });
  return client;
}

/** Models pinned via env so we can roll forward without redeploying code. */
export const MODELS = {
  text: process.env.OPENAI_TEXT_MODEL ?? 'gpt-4o',
  image: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
} as const;
