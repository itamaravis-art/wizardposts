/**
 * Drizzle schema for the multi-tenant Facebook auto-posting SaaS.
 *
 * Conventions:
 *  - All `*_at` columns are `timestamp with time zone`.
 *  - All foreign keys cascade on delete (deleting a user removes all their data).
 *  - Primary keys are uuid via `pgcrypto`'s `gen_random_uuid()` (Supabase preinstalls it).
 *  - Data isolation is enforced at the application layer by filtering on `user_id`.
 */
import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Enums                                                              */
/* ------------------------------------------------------------------ */

export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'running',
  'paused',
  'done',
  'cancelled',
  'error',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'running',
  'success',
  'failed',
  'skipped',
]);

export const logLevelEnum = pgEnum('log_level', ['info', 'warn', 'error']);

/* ------------------------------------------------------------------ */
/* NextAuth Drizzle adapter tables                                    */
/* https://authjs.dev/getting-started/adapters/drizzle                */
/* ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  fbConnected: boolean('fb_connected').notNull().default(false),
  fbUserName: text('fb_user_name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Per-user safety defaults — applied to new campaigns and used by the
  // worker as fallback throttling when a campaign-specific value is absent.
  dailyCap: integer('daily_cap').notNull().default(12),
  minDelayMs: integer('min_delay_ms').notNull().default(300_000),
  maxDelayMs: integer('max_delay_ms').notNull().default(900_000),
  workHoursStart: integer('work_hours_start').notNull().default(9),
  workHoursEnd: integer('work_hours_end').notNull().default(22),
  maxConsecutiveFails: integer('max_consecutive_fails').notNull().default(3),
  typingMinMs: integer('typing_min_ms').notNull().default(50),
  typingMaxMs: integer('typing_max_ms').notNull().default(150),
});

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

/* ------------------------------------------------------------------ */
/* Worker tokens                                                      */
/* `token` column stores a bcrypt hash, never the plain token.        */
/* ------------------------------------------------------------------ */

export const workerTokens = pgTable(
  'worker_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(), // bcrypt hash
    // SHA-256 hex of the plain token. Deterministic, indexable, used as the
    // primary lookup key so we don't bcrypt-scan every row in the table on
    // every worker request. Nullable for rows created before this column
    // existed; those fall back to a (slow) bcrypt scan until rotated.
    tokenFp: text('token_fp'),
    name: text('name').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('worker_tokens_user_id_idx').on(t.userId),
    tokenFpIdx: index('worker_tokens_token_fp_idx').on(t.tokenFp),
  }),
);

/* ------------------------------------------------------------------ */
/* Posts                                                              */
/* ------------------------------------------------------------------ */

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    imageUrl: text('image_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('posts_user_id_idx').on(t.userId),
  }),
);

/* ------------------------------------------------------------------ */
/* Groups                                                             */
/* unique-per-user: (user_id, url)                                    */
/* ------------------------------------------------------------------ */

export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    name: text('name'),
    tag: text('tag'),
    lastPostedAt: timestamp('last_posted_at', { withTimezone: true }),
    successCount: integer('success_count').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userUrlUnique: uniqueIndex('groups_user_id_url_unique').on(t.userId, t.url),
    userIdx: index('groups_user_id_idx').on(t.userId),
    tagIdx: index('groups_tag_idx').on(t.tag),
    activeIdx: index('groups_active_idx').on(t.active),
  }),
);

/* ------------------------------------------------------------------ */
/* Campaigns                                                          */
/* ------------------------------------------------------------------ */

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    status: campaignStatusEnum('status').notNull().default('draft'),
    dailyCap: integer('daily_cap').notNull().default(12),
    minDelayMs: integer('min_delay_ms').notNull().default(300_000),
    maxDelayMs: integer('max_delay_ms').notNull().default(900_000),
    workHoursStart: integer('work_hours_start').notNull().default(9),
    workHoursEnd: integer('work_hours_end').notNull().default(22),
    textVariations: boolean('text_variations').notNull().default(false),
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (t) => ({
    userIdx: index('campaigns_user_id_idx').on(t.userId),
    statusIdx: index('campaigns_status_idx').on(t.status),
  }),
);

/* ------------------------------------------------------------------ */
/* Jobs                                                               */
/* ------------------------------------------------------------------ */

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    status: jobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    resultMessage: text('result_message'),
    screenshotPath: text('screenshot_path'),
    claimedByToken: uuid('claimed_by_token').references(() => workerTokens.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    campaignIdx: index('jobs_campaign_id_idx').on(t.campaignId),
    statusIdx: index('jobs_status_idx').on(t.status),
    scheduledIdx: index('jobs_scheduled_at_idx').on(t.scheduledAt),
  }),
);

/* ------------------------------------------------------------------ */
/* Daily counters — composite PK (user_id, day)                       */
/* ------------------------------------------------------------------ */

export const dailyCounters = pgTable(
  'daily_counters',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    postedCount: integer('posted_count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.day] }),
  }),
);

/* ------------------------------------------------------------------ */
/* Logs                                                               */
/* user_id is nullable — system-level logs may have no owner.         */
/* ------------------------------------------------------------------ */

export const logs = pgTable(
  'logs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    level: logLevelEnum('level').notNull(),
    source: text('source').notNull(),
    message: text('message').notNull(),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index('logs_user_id_idx').on(t.userId),
    levelIdx: index('logs_level_idx').on(t.level),
    createdIdx: index('logs_created_at_idx').on(t.createdAt),
  }),
);

/* ------------------------------------------------------------------ */
/* Inferred types                                                     */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;

export type WorkerToken = typeof workerTokens.$inferSelect;
export type NewWorkerToken = typeof workerTokens.$inferInsert;

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type DailyCounter = typeof dailyCounters.$inferSelect;
export type NewDailyCounter = typeof dailyCounters.$inferInsert;

export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;

export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type LogLevel = (typeof logLevelEnum.enumValues)[number];
