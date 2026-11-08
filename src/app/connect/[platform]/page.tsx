import { redirect } from "next/navigation";
import { loadConnectState, oauthRedirectUri } from "@/lib/accounts";
import { appForState } from "@/lib/connect";
import { pkceChallenge } from "@/lib/crypto";
import { getAdapter, isPlatformId } from "@/lib/platforms";
import { brand } from "@/lib/brand";
import { Alert } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { CredentialForm } from "./credential-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect account", robots: { index: false } };

export default async function ConnectPage({ params, searchParams }: { params: Promise<{ platform: string }>; searchParams: Promise<{ state?: string }> }) {
  const { platform } = await params;
  const { state: stateToken } = await searchParams;
  const state = await loadConnectState(stateToken, platform);
  const adapter = isPlatformId(platform) ? getAdapter(platform) : undefined;
  if (!state || !adapter) redirect("/connect/expired");

  if (adapter.kind === "oauth") {
    const app = await appForState(state);
    if (!app) {
      return <Shell platform={platform} name={adapter.name}><Alert tone="red">{adapter.name} is not configured.</Alert></Shell>;
    }
    redirect(
      adapter.getAuthUrl({
        app,
        redirectUri: oauthRedirectUri(adapter.id),
        state: state.state,
        codeChallenge: state.codeVerifier ? pkceChallenge(state.codeVerifier) : undefined,
      }),
    );
  }

  return (
    <Shell platform={platform} name={adapter.name}>
      <p className="mb-5 text-sm text-muted">{adapter.helpText}</p>
      <CredentialForm platform={platform} state={state.state} fields={adapter.fields} name={adapter.name} />
    </Shell>
  );
}

function Shell({ platform, name, children }: { platform: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-wash px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-4 flex items-center gap-3">
          <PlatformIcon platform={platform} size={40} />
          <h1 className="text-xl font-semibold">Connect {name}</h1>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted">Secured by {brand.name}. Credentials are encrypted at rest.</p>
      </div>
    </div>
  );
}
