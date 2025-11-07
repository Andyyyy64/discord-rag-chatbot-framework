import { boolean, integer, jsonb, pgTable, text, timestamp, uuid, date, customType } from 'drizzle-orm/pg-core';

const vector3072 = customType<{ data: number[]; notNull: true; default: false }>({
  dataType() {
    return 'vector(3072)';
  },
});

export const channels = pgTable('channels', {
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').primaryKey(),
  categoryId: text('category_id'),
  name: text('name'),
  type: integer('type'),
  lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const threads = pgTable('threads', {
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  threadId: text('thread_id').primaryKey(),
  name: text('name'),
  archived: boolean('archived').default(false),
  lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const messages = pgTable('messages', {
  guildId: text('guild_id').notNull(),
  categoryId: text('category_id'),
  channelId: text('channel_id').notNull(),
  threadId: text('thread_id'),
  messageId: text('message_id').primaryKey(),
  authorId: text('author_id'),
  contentMd: text('content_md'),
  contentPlain: text('content_plain'),
  createdAt: timestamp('created_at', { withTimezone: true }),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  mentions: jsonb('mentions'),
  attachments: jsonb('attachments'),
  jumpLink: text('jump_link'),
  tokenCount: integer('token_count'),
  allowedRoleIds: text('allowed_role_ids').array(),
  allowedUserIds: text('allowed_user_ids').array(),
});

export const messageWindows = pgTable('message_windows', {
  windowId: uuid('window_id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  categoryId: text('category_id'),
  channelId: text('channel_id').notNull(),
  threadId: text('thread_id'),
  date: date('date').notNull(),
  windowSeq: integer('window_seq').notNull(),
  messageIds: text('message_ids').array().notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  tokenEst: integer('token_est'),
  textBody: text('text'),
});

export const messageEmbeddings = pgTable('message_embeddings', {
  windowId: uuid('window_id')
    .primaryKey()
    .references(() => messageWindows.windowId, { onDelete: 'cascade' }),
  embedding: vector3072('embedding').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const syncOperations = pgTable('sync_operations', {
  id: uuid('id').primaryKey().defaultRandom(),
  guildId: text('guild_id').notNull(),
  scope: text('scope').notNull(),
  mode: text('mode').notNull(),
  targetIds: text('target_ids').array(),
  since: timestamp('since', { withTimezone: true }),
  requestedBy: text('requested_by').notNull(),
  status: text('status').notNull().default('queued'),
  progress: jsonb('progress'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const syncCursors = pgTable('sync_cursors', {
  guildId: text('guild_id').primaryKey(),
  lastMessageId: text('last_message_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow(),
});

export const syncChunks = pgTable('sync_chunks', {
  id: uuid('id').primaryKey().defaultRandom(),
  opId: uuid('op_id')
    .references(() => syncOperations.id, { onDelete: 'cascade' })
    .notNull(),
  targetId: text('target_id').notNull(),
  date: date('date').notNull(),
  cursor: jsonb('cursor'),
  status: text('status').notNull().default('ready'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const embedQueue = pgTable('embed_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  messageId: text('message_id').notNull(),
  priority: integer('priority').notNull().default(0),
  status: text('status').notNull().default('ready'),
  attempts: integer('attempts').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
