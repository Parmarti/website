-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Post_userId_idempotencyKey_key" ON "Post"("userId", "idempotencyKey");

