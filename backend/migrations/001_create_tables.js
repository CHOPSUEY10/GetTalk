/**
 * Migration: Create core tables for GetTalk.
 *
 * Run with: node migrations/001_create_tables.js
 */

import { query, getClient } from '../src/config/database.js';
import logger from '../src/utils/logger.js';

const UP = `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_user_id, to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_to_user ON friendships (to_user_id, status);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       VARCHAR(20) NOT NULL DEFAULT 'direct'
               CHECK (type IN ('direct', 'group')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversation members
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user ON conversation_members (user_id);

-- Messages (ciphertext only — never plaintext)
CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID         NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body_ciphertext  TEXT         NOT NULL,
  nonce            TEXT         NOT NULL,
  client_message_id VARCHAR(100),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  edited_at        TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at DESC);

-- Message receipts
CREATE TABLE IF NOT EXISTS message_receipts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL CHECK (status IN ('delivered', 'read')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id, status)
);

-- Attachments
CREATE TABLE IF NOT EXISTS attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  uploader_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key     VARCHAR(500) NOT NULL,
  original_name   VARCHAR(255),
  mime_type       VARCHAR(100),
  size_bytes      BIGINT,
  checksum        VARCHAR(128),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

-- Security events (audit log)
CREATE TABLE IF NOT EXISTS security_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  metadata   JSONB,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user
  ON security_events (user_id, created_at DESC);
`;

async function migrate() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(UP);
    await client.query('COMMIT');
    logger.info('Migration 001_create_tables completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Migration 001_create_tables failed', { message: err.message });
    throw err;
  } finally {
    client.release();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
