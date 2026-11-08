-- AlterTable
ALTER TABLE "PostTarget" ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "metricsError" TEXT,
ADD COLUMN     "metricsNextAt" TIMESTAMP(3),
ADD COLUMN     "metricsUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "followers" INTEGER,
ADD COLUMN     "metricsError" TEXT,
ADD COLUMN     "metricsNextAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "following" INTEGER,
    "posts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountSnapshot_accountId_date_key" ON "AccountSnapshot"("accountId", "date");

-- CreateIndex
CREATE INDEX "MetricSnapshot_targetId_capturedAt_idx" ON "MetricSnapshot"("targetId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostTarget_metricsNextAt_idx" ON "PostTarget"("metricsNextAt");

-- CreateIndex
CREATE INDEX "SocialAccount_metricsNextAt_idx" ON "SocialAccount"("metricsNextAt");

-- AddForeignKey
ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "PostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

