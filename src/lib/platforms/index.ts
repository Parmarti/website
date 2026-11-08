import type { PlatformAdapter, PlatformId } from "./types";
import { blueskyAdapter } from "./bluesky";
import { discordAdapter } from "./discord";
import { facebookAdapter } from "./facebook";
import { instagramAdapter } from "./instagram";
import { linkedinAdapter } from "./linkedin";
import { mastodonAdapter } from "./mastodon";
import { pinterestAdapter } from "./pinterest";
import { redditAdapter } from "./reddit";
import { telegramAdapter } from "./telegram";
import { threadsAdapter } from "./threads";
import { tiktokAdapter } from "./tiktok";
import { twitterAdapter } from "./twitter";
import { youtubeAdapter } from "./youtube";

export * from "./types";

export const adapters: Record<PlatformId, PlatformAdapter> = {
  twitter: twitterAdapter,
  linkedin: linkedinAdapter,
  facebook: facebookAdapter,
  instagram: instagramAdapter,
  threads: threadsAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  pinterest: pinterestAdapter,
  reddit: redditAdapter,
  bluesky: blueskyAdapter,
  mastodon: mastodonAdapter,
  telegram: telegramAdapter,
  discord: discordAdapter,
};

export function getAdapter(id: string): PlatformAdapter | undefined {
  return (adapters as Record<string, PlatformAdapter>)[id];
}

export const platformList = Object.values(adapters);
