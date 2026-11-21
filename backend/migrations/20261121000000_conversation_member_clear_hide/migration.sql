-- Support deleting/clearing all conversation messages per-user ("me") or for all members ("everyone"),
-- and hiding cleared conversations from a member's sidebar until new activity or re-opening.

ALTER TABLE "conversation_members"
  ADD COLUMN IF NOT EXISTS "cleared_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMPTZ(6);
