"use client";

import { useActionState, useMemo, useState } from "react";
import { Alert, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { createApiKey, createPostAction, createWebhookAction, savePlatformApp, type FormState } from "./actions";

function SecretBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="block flex-1 overflow-x-auto rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm">{value}</code>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Result({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) {
    const details = Array.isArray(state.details) ? (state.details as { platform?: string; errors: string[] }[]) : null;
    return (
      <Alert tone="red">
        {state.error}
        {details ? (
          <ul className="mt-2 list-disc pl-5">
            {details.map((d, i) => (
              <li key={i}>
                {d.platform ? <strong className="capitalize">{d.platform}: </strong> : null}
                {d.errors.join(" ")}
              </li>
            ))}
          </ul>
        ) : null}
      </Alert>
    );
  }
  return (
    <Alert tone="green">
      {state.ok}
      {state.secret ? <SecretBox value={state.secret} /> : null}
    </Alert>
  );
}

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKey, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <Input name="name" placeholder="Key name, e.g. Production" aria-label="Key name" />
        <Button disabled={pending}>{pending ? "Creating..." : "Create key"}</Button>
      </div>
      <Result state={state} />
    </form>
  );
}

const EVENTS = ["post.published", "post.partial", "post.failed", "account.connected", "account.disconnected", "account.expired"];

export function WebhookForm() {
  const [state, action, pending] = useActionState(createWebhookAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="url">Endpoint URL</Label>
        <Input id="url" name="url" type="url" required placeholder="https://yourapp.com/webhooks/social" />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Events <span className="font-normal text-muted">(none selected = all events)</span></legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {EVENTS.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={e} /> <code>{e}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <Button disabled={pending}>{pending ? "Saving..." : "Add webhook"}</Button>
      <Result state={state} />
    </form>
  );
}

export function PlatformAppForm({ platform, name, redirectUri, existingClientId }: { platform: string; name: string; redirectUri: string; existingClientId?: string }) {
  const [state, action, pending] = useActionState(savePlatformApp, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="platform" value={platform} />
      <div className="text-xs text-muted">
        Redirect URI to add in your {name} app: <code className="break-all">{redirectUri}</code>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input name="clientId" placeholder="Client ID / App ID / Client key" defaultValue={existingClientId} aria-label="Client ID" />
        <Input name="clientSecret" type="password" placeholder={existingClientId ? "New client secret" : "Client secret"} aria-label="Client secret" />
      </div>
      <Button size="sm" variant="secondary" disabled={pending}>{pending ? "Saving..." : existingClientId ? "Update" : "Save"}</Button>
      <Result state={state} />
    </form>
  );
}

export interface ComposerAccount {
  id: string;
  platform: string;
  label: string;
  profile: string;
  status: string;
  boards?: { id: string; name: string }[];
}

export function Composer({ accounts }: { accounts: ComposerAccount[] }) {
  const [state, action, pending] = useActionState(createPostAction, undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [when, setWhen] = useState("now");
  const [content, setContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/dashboard/media", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
        setMediaUrls((prev) => [prev.trim(), data.media.url].filter(Boolean).join("\n"));
      } catch (err) {
        setUploadError(`${file.name}: ${(err as Error).message}`);
        break;
      }
    }
    setUploading(null);
  }
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  const platforms = new Set(accounts.filter((a) => selected.includes(a.id)).map((a) => a.platform));
  const boards = accounts.filter((a) => selected.includes(a.id) && a.boards?.length).flatMap((a) => a.boards!);

  if (accounts.length === 0) {
    return <Alert>Connect an account first, then you can compose posts here.</Alert>;
  }

  return (
    <form action={action} className="space-y-4">
      <div>
        <Label>Post to</Label>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => {
            const on = selected.includes(a.id);
            return (
              <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${on ? "border-brand bg-indigo-50" : "border-line bg-white"} ${a.status !== "active" ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  name="accountIds"
                  value={a.id}
                  className="sr-only"
                  checked={on}
                  disabled={a.status !== "active"}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))}
                />
                <PlatformIcon platform={a.platform} size={20} />
                <span>{a.label}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div>
        <Label htmlFor="content" hint={`${content.length} characters`}>Text</Label>
        <Textarea id="content" name="content" rows={5} value={content} onChange={(e) => setContent(e.target.value)} placeholder="What do you want to share?" />
      </div>
      <div>
        <Label htmlFor="mediaUrls" hint="Upload files, or paste public image or video URLs, one per line.">Media</Label>
        <Textarea id="mediaUrls" name="mediaUrls" rows={2} value={mediaUrls} onChange={(e) => setMediaUrls(e.target.value)} placeholder="https://cdn.example.com/photo.jpg" />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <label className={`inline-flex cursor-pointer items-center rounded-lg border border-line bg-white px-3 py-1.5 font-medium hover:bg-wash ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            <input type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" className="sr-only" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            {uploading ? `Uploading ${uploading}...` : "Upload files"}
          </label>
          <span className="text-xs text-muted">JPEG, PNG, GIF, WebP up to 20 MB. MP4, MOV, WebM up to 512 MB.</span>
        </div>
        {uploadError ? <p className="mt-1 text-sm text-bad">{uploadError}</p> : null}
      </div>
      {platforms.has("youtube") || platforms.has("pinterest") || platforms.has("reddit") ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="title">Title (YouTube, Pinterest, Reddit)</Label>
            <Input id="title" name="title" maxLength={300} />
          </div>
          {platforms.has("reddit") ? (
            <div>
              <Label htmlFor="subreddit">Subreddit</Label>
              <Input id="subreddit" name="subreddit" placeholder="test" />
            </div>
          ) : null}
          {boards.length ? (
            <div>
              <Label htmlFor="boardId">Pinterest board</Label>
              <Select id="boardId" name="boardId">
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <Label htmlFor="when">When</Label>
          <Select id="when" name="when" value={when} onChange={(e) => setWhen(e.target.value)}>
            <option value="now">Publish now</option>
            <option value="later">Schedule</option>
            <option value="draft">Save as draft</option>
          </Select>
        </div>
        {when === "later" ? (
          <div className="sm:w-64">
            <Label htmlFor="scheduledFor" hint={`Time zone: ${timezone}`}>Date and time</Label>
            <Input id="scheduledFor" name="scheduledFor" type="datetime-local" required />
            <input type="hidden" name="timezone" value={timezone} />
          </div>
        ) : null}
        <Button disabled={pending || selected.length === 0 || Boolean(uploading)}>{pending ? "Saving..." : when === "now" ? "Publish" : when === "later" ? "Schedule" : "Save draft"}</Button>
      </div>
      <Result state={state} />
    </form>
  );
}
