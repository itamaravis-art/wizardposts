/**
 * Brand kit + content-pillar types for the page-channel module.
 *
 * The brand kit is stored as a single jsonb on `pages.brand_kit`. It
 * drives both caption generation (tone, hashtags, CTA) and image
 * generation (image style block fed to the image-prompt builder).
 *
 * The schema is intentionally loose (jsonb) so we can iterate copy
 * without migrations. The runtime validation happens via Zod where
 * the brand kit is read or written (settings API + AI generation).
 */
import { z } from 'zod';

/**
 * Pillar id → human-readable label. Mapped by the weekly schedule
 * (lib/ai/pillarSchedule.ts) to figure out what kind of post to
 * generate for a given (date, slot) pair.
 */
export const PILLAR_IDS = [
  'tips',
  'treatments',
  'stories',
  'education',
  'behind_scenes',
  'cta',
] as const;
export type PillarId = (typeof PILLAR_IDS)[number];

export const PILLAR_LABELS: Record<PillarId, string> = {
  tips: 'טיפים יומיומיים לבריאות ורווחה',
  treatments: 'סוגי טיפולים בקליניקה',
  stories: 'סיפורי לקוחות',
  education: 'חינוך הוליסטי',
  behind_scenes: 'מאחורי הקלעים',
  cta: 'הזמנה לפעולה / מבצעים',
};

/**
 * Default einatural brand kit. Used as initial value when a new page
 * is connected. The owner can edit any field via /page/settings.
 */
export const EINATURAL_DEFAULT_BRAND_KIT: BrandKit = {
  tone:
    'חמים, רגוע, נשי, חיבור גוף-נפש. ללא מילים גנריות כמו "מהפכני", "פורץ דרך", "בלעדי". ללא קלישאות שיווקיות.',
  audience:
    'נשים בנות 28-55 המחפשות איזון, הקלה על מתח, רווחה הוליסטית, חיבור לעצמן.',
  pillars: [...PILLAR_IDS],
  hashtags: [
    '#עיסוי_הוליסטי',
    '#einatural',
    '#רווחה_לאישה',
    '#איזון',
    '#מגע_מרפא',
    '#רפואה_משלימה',
  ],
  imageStyle:
    'טבעי, אור רך, גוונים אדמתיים (terracotta, sage green, sand, cream), נרות, אבנים חלקות, שמנים אתריים בבקבוקי זכוכית, צמחי מרפא, מגבות לבנות. ללא אנשים זרים בתמונה. ללא טקסט בתמונה. אווירת ספא יוקרתי בוטיק.',
  cta: 'להזמנת טיפול: WhatsApp / לפרטים נוספים בהודעה פרטית',
  publishSlots: ['10:00', '18:00'],
};

export interface BrandKit {
  /** Voice / tone guidance for the caption LLM. */
  tone: string;
  /** Target audience description (informs caption framing). */
  audience: string;
  /** Pillars the AI rotates through. Subset/superset of PILLAR_IDS. */
  pillars: PillarId[];
  /** Hashtags appended to every caption. */
  hashtags: string[];
  /** Style guidance for the image-prompt builder. */
  imageStyle: string;
  /** Default CTA copy ending the caption when no slot-specific override. */
  cta: string;
  /** Daily publish slots in `HH:mm` (24-hour) format, Asia/Jerusalem. */
  publishSlots: string[];
}

export const brandKitSchema = z.object({
  tone: z.string().min(1).max(2000),
  audience: z.string().min(1).max(2000),
  pillars: z.array(z.enum(PILLAR_IDS)).min(1).max(PILLAR_IDS.length),
  hashtags: z.array(z.string().min(1).max(60)).max(15),
  imageStyle: z.string().min(1).max(2000),
  cta: z.string().min(1).max(500),
  publishSlots: z
    .array(z.string().regex(/^([0-1]\d|2[0-3]):[0-5]\d$/))
    .min(1)
    .max(6),
});
