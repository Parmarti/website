import { brand } from "@/lib/brand";

export const metadata = { title: "Privacy Policy" };

// TEMPLATE: have a lawyer review before launch. Social networks (Meta, TikTok, Google) require a public privacy policy URL for app review.
export default function Privacy() {
  return (
    <article className="prose-docs mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p>Last updated: {new Date().getFullYear()}</p>
      <p>This policy explains what data {brand.name}, operated by [COMPANY], collects and how we use it.</p>
      <h2>Data we collect</h2>
      <ul>
        <li><strong>Account data:</strong> your email address, name and a hash of your password.</li>
        <li><strong>Connected social accounts:</strong> the account ID, username, display name, profile picture and the access tokens the network gives us. Tokens and credentials are encrypted at rest with AES-256-GCM.</li>
        <li><strong>Content:</strong> the posts, media URLs and schedules you send to us.</li>
        <li><strong>Billing:</strong> payments are handled by Stripe. We do not store card numbers.</li>
      </ul>
      <h2>How we use data</h2>
      <p>We use this data only to provide the Service: to publish the content you ask us to publish, to show you results, and to bill you. We do not sell personal data and we do not use your content to train models.</p>
      <h2>Data from social networks</h2>
      <p>We request only the permissions needed to publish on your behalf and to show which account is connected. You can disconnect an account at any time in the dashboard or with the API. When you disconnect an account we delete its tokens. You can also revoke our access in the security settings of each network.</p>
      <h2>Retention and deletion</h2>
      <p>We keep data while your account is open. To delete your account and all its data, email {brand.supportEmail}. We complete deletion requests within 30 days.</p>
      <h2>Sub-processors</h2>
      <p>Hosting provider, database provider, and Stripe for payments.</p>
      <h2>Contact</h2>
      <p>{brand.supportEmail}</p>
    </article>
  );
}
