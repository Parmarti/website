// Change the product name and contact details here. Everything in the UI reads from this file.
export const brand = {
  name: "Fanout",
  tagline: "One API call. Every social network.",
  description:
    "Fanout is a unified social media API. Connect your users' accounts once, then publish and schedule posts to 13 networks with a single request.",
  supportEmail: process.env.SUPPORT_EMAIL || "support@example.com",
  apiKeyPrefix: "fo_live_",
  webhookSignatureHeader: "X-Fanout-Signature",
};
