const colors: Record<string, string> = {
  twitter: "#0f1419",
  linkedin: "#0a66c2",
  facebook: "#1877f2",
  instagram: "#d62976",
  threads: "#101010",
  tiktok: "#111111",
  youtube: "#ff0000",
  pinterest: "#e60023",
  reddit: "#ff4500",
  googlebusiness: "#4285f4",
  bluesky: "#1185fe",
  mastodon: "#6364ff",
  telegram: "#229ed9",
  discord: "#5865f2",
};

const labels: Record<string, string> = {
  twitter: "X",
  linkedin: "in",
  facebook: "f",
  instagram: "IG",
  threads: "@",
  tiktok: "TT",
  youtube: "YT",
  pinterest: "P",
  reddit: "R",
  googlebusiness: "G",
  bluesky: "B",
  mastodon: "M",
  telegram: "TG",
  discord: "D",
};

export function PlatformIcon({ platform, size = 32 }: { platform: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ background: colors[platform] ?? "#6b7280", width: size, height: size, fontSize: size * 0.36 }}
    >
      {labels[platform] ?? platform.slice(0, 2).toUpperCase()}
    </span>
  );
}
