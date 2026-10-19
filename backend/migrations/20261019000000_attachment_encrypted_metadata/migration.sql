-- AlterTable
-- Issue #15: stop storing plaintext attachment metadata and plaintext
-- checksums. Filename/MIME type are now client-encrypted; size remains
-- visible because ciphertext length is inherently observable.
ALTER TABLE "attachments"
    ADD COLUMN "metadata_ciphertext" TEXT,
    ADD COLUMN "metadata_nonce" TEXT,
    DROP COLUMN "original_name",
    DROP COLUMN "mime_type",
    DROP COLUMN "checksum";
