import { brand } from "@/lib/brand";

export const metadata = { title: "Terms of Service" };

// TEMPLATE: have a lawyer review before launch. Replace [COMPANY] and [JURISDICTION].
export default function Terms() {
  return (
    <article className="prose-docs mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p>Last updated: {new Date().getFullYear()}</p>
      <p>These terms govern your use of {brand.name} (the &quot;Service&quot;), operated by [COMPANY] (&quot;we&quot;, &quot;us&quot;). By creating an account you agree to them.</p>
      <h2>1. The Service</h2>
      <p>The Service lets you connect social media accounts and publish content to them through our website and API. Each social network sets its own rules. You must follow the terms and policies of every network you publish to.</p>
      <h2>2. Your account</h2>
      <p>You are responsible for your API keys and everything done with them. Keep keys secret. Tell us at {brand.supportEmail} if a key is exposed.</p>
      <h2>3. Acceptable use</h2>
      <ul>
        <li>Do not publish spam, illegal content, malware, or content that infringes the rights of others.</li>
        <li>Only connect accounts you own or are authorized to manage.</li>
        <li>Do not use the Service to get around a social network&apos;s limits or bans.</li>
      </ul>
      <h2>4. Payment</h2>
      <p>Paid plans renew monthly until cancelled. You can cancel at any time in the billing portal and keep access until the end of the paid period. Fees are not refundable except where the law requires.</p>
      <h2>5. Availability</h2>
      <p>Social networks can change or limit their APIs at any time. We do our best to keep every integration working but we cannot guarantee that a network will accept every post.</p>
      <h2>6. Liability</h2>
      <p>The Service is provided &quot;as is&quot;. To the extent the law allows, our total liability is limited to the fees you paid in the 3 months before the claim.</p>
      <h2>7. Termination</h2>
      <p>We may suspend accounts that break these terms. You can delete your account at any time by contacting us.</p>
      <h2>8. Law</h2>
      <p>These terms are governed by the laws of [JURISDICTION].</p>
      <h2>Contact</h2>
      <p>{brand.supportEmail}</p>
    </article>
  );
}
