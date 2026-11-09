# Fanout Python SDK

Zero-dependency client for the Fanout unified social media API. Publish and schedule posts to 14 networks with one call. Python 3.9+, standard library only.

> **Placeholders:** the package name `fanout` and the default base URL `https://api.example.com` are placeholders. Change `name` in `pyproject.toml` and `DEFAULT_BASE_URL` in `fanout/client.py` before you publish to PyPI.

## Install

```bash
pip install fanout
```

## Quick start

```python
import os
from fanout import Fanout

fanout = Fanout(
    api_key=os.environ["FANOUT_API_KEY"],
    base_url="https://api.yourdomain.com",  # or set FANOUT_BASE_URL
)

accounts = fanout.accounts.list()

post = fanout.posts.create(
    content="We just shipped dark mode 🌙",
    media_items=[{"url": "https://cdn.example.com/dark.png"}],
    platforms=[{"platform": a["platform"], "accountId": a["id"]} for a in accounts],
    publish_now=True,
)
print(post["id"], post["status"])
```

Responses are plain dicts with the same field names as the REST API (camelCase).

## Schedule a post

```python
from datetime import datetime

fanout.posts.create(
    content="Doors open at 9!",
    platforms=[{"platform": "linkedin", "accountId": "acc_123"}],
    scheduled_for=datetime(2026, 12, 1, 9, 0),  # naive: read in `timezone`
    timezone="America/New_York",
)
```

Per-network options go in `platformSpecificData`:

```python
fanout.posts.create(
    content="Launch video",
    media_items=[{"url": "https://cdn.example.com/launch.mp4"}],
    platforms=[
        {"platform": "youtube", "accountId": "acc_yt", "platformSpecificData": {"title": "Launch day"}},
        {"platform": "reddit", "accountId": "acc_rd", "platformSpecificData": {"subreddit": "test", "title": "Launch day"}},
        {"platform": "googlebusiness", "accountId": "acc_gb", "platformSpecificData": {"callToActionType": "LEARN_MORE", "callToActionUrl": "https://example.com"}},
    ],
)
```

Supported platform ids are in `fanout.PLATFORMS`.

## Upload media

Upload a file once, then use its public `url` in `media_items`. JPEG, PNG, GIF, WebP (up to 20 MB) and MP4, MOV, WebM (up to 512 MB) by default.

```python
image = client.media.upload("launch.png")  # a path, raw bytes, or a file opened with "rb"

client.posts.create(
    content="We just launched!",
    media_items=[{"url": image["url"], "altText": "Screenshot of the new dashboard"}],
    platforms=[{"accountId": "acc_123"}],
)
```

The type is guessed from the file name; pass `content_type="video/mp4"` for raw bytes without a name. Uploads are never retried automatically. `client.media.list()`, `client.media.get(id)` and `client.media.delete(id)` manage stored files.

## Track results

```python
post = fanout.posts.get(post_id)
for target in post["platforms"]:
    print(target["platform"], target["status"], target["platformPostUrl"] or target["error"])

for failed in fanout.posts.iterate(status="failed"):
    fanout.posts.retry(failed["id"])
```

## Analytics

Metrics are collected from each network on a schedule (often for new posts, then less often, for 90 days).
`engagements` = likes + comments + shares + saves + quotes; `engagementRate` = engagements / (impressions, else views, else reach).

```python
overview = client.analytics.overview(days=30, platform="instagram", timezone="Europe/Madrid")
print(overview["totals"]["engagements"], overview["totals"]["engagementRate"])
for top in overview["topPosts"]:
    print(top["platform"], top["engagements"], top["url"])

stats = client.analytics.post(post["id"])        # per-network metrics and history
client.analytics.refresh_post(post["id"])        # ask for fresh numbers now; when "queued" is 0, "reason" is "not_published", "already_queued" or "refreshed_recently"
followers = client.analytics.account("acc_123", days=90)
# Use from_= and to= (ISO strings or datetime) for a custom range.
```

## Connect your users' accounts

```python
link = fanout.connect.get_url(
    "instagram",
    profile_id="prof_123",
    redirect_url="https://app.example.com/social/connected",
)
# Redirect the user to link["authUrl"]. They come back to
# https://app.example.com/social/connected?connected=instagram&accountId=acc_...&profileId=prof_123
# (or ?error=...&platform=instagram). Store accountId.
```

## Errors

```python
from fanout import FanoutError

try:
    fanout.posts.create(content="x" * 400, platforms=[{"accountId": "acc_x"}])
except FanoutError as err:
    print(err.status)   # 422
    print(err.code)     # "platform_rejected"
    print(err.details)  # [{"accountId": ..., "platform": "twitter", "errors": [...]}]
```

`status` is 0 for network errors (`code="network_error"`). Upload errors use `too_large` (413) and `unsupported_type` (415).

The API allows 300 requests per minute per account, of which 60 can be writes (your operator may set other numbers). Over the limit you get status 429 with `code="rate_limited"`, and `err.rate_limit` holds `limit`, `remaining`, `reset` and `retry_after`.

Retries: requests that are safe to repeat (GET, and `posts.create` with an `idempotency_key`) are retried up to 2 times on network errors and 5xx, and on 429 when the server sends `Retry-After` (up to 60 s). Other writes and uploads are never retried. Change with `Fanout(..., max_retries=0, timeout=30)`.

## Webhooks

```python
hook = fanout.webhooks.create("https://app.example.com/webhooks/fanout", events=["post.published", "post.failed"])
print(hook["secret"])  # shown once: store it
```

Verify each delivery with the raw body. Flask example:

```python
from flask import Flask, request, abort
from fanout import construct_webhook_event, FanoutError

app = Flask(__name__)

@app.post("/webhooks/fanout")
def fanout_webhook():
    try:
        event = construct_webhook_event(request.get_data(), request.headers.get("X-Fanout-Signature"), WEBHOOK_SECRET)
    except FanoutError:
        abort(400)
    if event["event"] == "post.failed":
        print("Post failed:", event["data"]["id"])
    return "", 200
```

`verify_webhook_signature(raw_body, header, secret, tolerance=300)` returns a bool if you only want the check.

## API reference

| Resource | Methods |
|---|---|
| `posts` | `create(...)`, `list(limit, cursor, status, profile_id)`, `iterate(...)`, `get(id)`, `delete(id)` / `cancel(id)`, `retry(id)` |
| `accounts` | `list(profile_id, platform)`, `get(id)`, `disconnect(id)` |
| `profiles` | `list()`, `create(name, description)`, `get(id)`, `update(id, name, description)`, `delete(id)` |
| `connect` | `get_url(platform, profile_id, redirect_url)` |
| `platforms` | `list()` |
| `webhooks` | `list()`, `create(url, events)`, `delete(id)`, `test(id)` |
| `usage` | `get()` |
| `analytics` | `overview(from_, to, days, profile_id, platform, account_id, timezone)`, `post(id)`, `refresh_post(id)`, `account(id, from_, to, days)` |
| `media` | `upload(path_or_bytes, filename, content_type)`, `list(limit, cursor)`, `get(id)`, `delete(id)` |

## Development

```bash
python3 -m unittest -v
```
