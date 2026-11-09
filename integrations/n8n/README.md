# n8n-nodes-fanout

n8n community nodes for the Fanout social media API. Publish and schedule posts to 14 networks
(X, LinkedIn, Facebook Pages, Instagram, Threads, TikTok, YouTube, Pinterest, Reddit,
Google Business Profile, Bluesky, Mastodon, Telegram, Discord) from any workflow, and start
workflows when a post is published or fails.

## Install

In n8n: **Settings > Community Nodes > Install**, enter `n8n-nodes-fanout`, accept the risk notice and install.

For a self-hosted n8n from source:

```bash
cd ~/.n8n/custom   # create it if it does not exist
npm install n8n-nodes-fanout
```

Restart n8n after you install.

## Credentials

1. In the Fanout dashboard open **API keys** and create a key.
2. In n8n create a **Fanout API** credential:
   - **API Key:** the key (it starts with `fo_live_`).
   - **Base URL:** the address of your Fanout server, for example `https://api.yourdomain.com` (no `/api/v1`, no trailing slash).
3. Click **Test**. n8n calls `GET /api/v1/usage` to check the key.

## Fanout node

| Resource | Operations |
|---|---|
| Post | Create (publish now, schedule, draft), Get, Get Many, Delete, Retry |
| Account | Get Many, Get, Disconnect |
| Profile | Create, Get Many |
| Connect Link | Get (a link your user opens to connect an account) |
| Analytics | Get Overview, Get Post Analytics |
| Media | Upload, Delete |

**Create a post**

- **Text:** the post text. You can use expressions, for example `{{ $json.title }}`.
- **Accounts:** one row per connected account. Pick the account from the list or set its ID with an expression. Optional per-account text and **Platform Options (JSON)**, for example `{"title": "My video", "visibility": "unlisted"}` for YouTube or `{"subreddit": "test", "title": "Hello"}` for Reddit. The API docs list every option.
- **Media:** public URLs of images or videos.
- **When:** publish now, schedule (date, time and IANA time zone such as `Europe/Madrid`), or save as draft. A schedule time without a UTC offset is read in the time zone you set.

The node returns the post. Publishing runs in the background, so the status is `scheduled` at first. Use the trigger node or **Post > Get** to read the final result.

When the API rejects a post (for example Instagram without media), the error shows the problem for each network. Turn on **Continue On Fail** to keep the workflow running and get the error as an item.

**Analytics**

- **Get Overview:** pick a date range (last 7, 30 or 90 days, or a custom From/To) and optional filters (platform, profile, account, time zone). Returns totals, a per-network breakdown, a daily series, the top posts and follower growth in one item. Example: a weekly Schedule Trigger, then **Analytics > Get Overview** (last 7 days), then a Slack or email node with `{{ $json.totals.engagements }}` engagements and `{{ ($json.totals.engagementRate * 100).toFixed(2) }}%` engagement rate.
- **Get Post Analytics:** the metrics of one post for every account it went to, with history.

`engagements` = likes + comments + shares + saves + quotes. `engagementRate` = engagements / (impressions, else views, else reach).

**Media**

- **Upload:** sends the file in a binary property (default `data`) and returns its public `url`. JPEG, PNG, GIF, WebP (up to 20 MB) and MP4, MOV, WebM (up to 512 MB) by default. The type comes from the binary MIME type or file name; set **Options > Content Type** to override it.
- **Delete:** removes an uploaded file. Posts already published keep their copy.

Example: **Read/Write Files from Disk** (or **HTTP Request** with "File" response) > **Fanout: Media > Upload** > **Fanout: Post > Create** with the media URL set to `{{ $json.url }}`.

## Fanout Trigger node

Starts a workflow when one of these events happens:
`post.published`, `post.partial`, `post.failed`, `account.connected`, `account.disconnected`, `account.expired`.
Leave **Events** empty to receive all of them.

When you activate the workflow, the node registers a webhook in Fanout and stores its signing secret.
Each request is checked against the `X-Fanout-Signature` header (HMAC SHA-256, 5 minute window).
Unsigned or wrong requests get `401`. When you deactivate the workflow, the webhook is removed.

Your n8n must be reachable from the internet. Fanout does not send webhooks to private addresses
such as `localhost`. For self-hosted n8n, set `WEBHOOK_URL` to your public address.

## Example workflow

`examples/rss-to-social.workflow.json` shares every new blog post on LinkedIn (as a link card) and Bluesky.
In n8n: **Workflows > Import from File**, select the file, replace the two account IDs and the feed URL,
select your Fanout credential, and activate.

Other ideas:

- **AI content:** Schedule trigger > AI agent writes a post > Fanout Create (schedule for tomorrow 9:00).
- **Failure alerts:** Fanout Trigger (`post.failed`, `account.expired`) > Slack or email.
- **Client onboarding:** Form trigger > Fanout Profile Create > Fanout Connect Link Get > email the link to the client.

## Development

```bash
npm install
npm test        # builds and runs the tests in test/
```
