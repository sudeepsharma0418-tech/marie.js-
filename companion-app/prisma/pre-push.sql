-- Runs before "prisma db push" on every deploy. Safe to run many times.
-- Adds the username column and its unique index up front, so db push has
-- nothing risky left to warn about. Existing accounts start with no username.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'User') THEN
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
  END IF;
END $$;

-- Same for the shared voice fields on VoiceClone (slug is unique).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'VoiceClone') THEN
    ALTER TABLE "VoiceClone" ADD COLUMN IF NOT EXISTS "slug" TEXT;
    ALTER TABLE "VoiceClone" ADD COLUMN IF NOT EXISTS "shared" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "VoiceClone" ADD COLUMN IF NOT EXISTS "label" TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS "VoiceClone_slug_key" ON "VoiceClone"("slug");
  END IF;
END $$;
