/**
 * Zod schemas for create/update inputs. Used by API routes for request
 * validation before they hit the query layer.
 */
import { z } from 'zod';

/* Posts */
export const createPostInput = z.object({
  text: z.string().min(1).max(10_000),
  imageUrl: z.string().url().optional().nullable(),
});
export type CreatePostInput = z.infer<typeof createPostInput>;

/* Groups */
const fbGroupUrl = z
  .string()
  .url()
  .refine((u) => /facebook\.com\/groups\//i.test(u), {
    message: 'Must be a facebook.com/groups/... URL',
  });

export const createGroupInput = z.object({
  url: fbGroupUrl,
  name: z.string().max(200).optional().nullable(),
  tag: z.string().max(50).optional().nullable(),
});
export type CreateGroupInput = z.infer<typeof createGroupInput>;

export const bulkCreateGroupsInput = z.object({
  urls: z.array(fbGroupUrl).min(1).max(1000),
  tag: z.string().max(50).optional().nullable(),
});
export type BulkCreateGroupsInput = z.infer<typeof bulkCreateGroupsInput>;

export const updateGroupInput = z.object({
  name: z.string().max(200).optional().nullable(),
  tag: z.string().max(50).optional().nullable(),
  active: z.boolean().optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupInput>;

/* Campaigns */
export const campaignStatusSchema = z.enum([
  'draft',
  'running',
  'paused',
  'done',
  'cancelled',
  'error',
]);

export const createCampaignInput = z.object({
  name: z.string().min(1).max(200),
  postId: z.string().uuid(),
  groupIds: z.array(z.string().uuid()).min(1),
  dailyCap: z.number().int().min(1).max(500).default(12),
  minDelayMs: z.number().int().min(0).default(300_000),
  maxDelayMs: z.number().int().min(0).default(900_000),
  workHoursStart: z.number().int().min(0).max(23).default(9),
  workHoursEnd: z.number().int().min(1).max(24).default(22),
  textVariations: z.boolean().default(false),
  scheduledStartAt: z.coerce.date().optional().nullable(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignInput>;

export const updateCampaignStatusInput = z.object({
  status: campaignStatusSchema,
});
export type UpdateCampaignStatusInput = z.infer<
  typeof updateCampaignStatusInput
>;

/* Worker tokens */
export const createWorkerTokenInput = z.object({
  name: z.string().min(1).max(100),
});
export type CreateWorkerTokenInput = z.infer<typeof createWorkerTokenInput>;

/* Logs */
export const logLevelSchema = z.enum(['info', 'warn', 'error']);
export const addLogInput = z.object({
  userId: z.string().uuid().optional().nullable(),
  level: logLevelSchema,
  source: z.string().min(1).max(100),
  message: z.string().min(1),
  meta: z.unknown().optional(),
});
export type AddLogInput = z.infer<typeof addLogInput>;
