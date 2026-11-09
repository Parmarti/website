import json
import os
import pathlib
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import IO, Any, Dict, Iterator, List, Optional, Union

from .errors import FanoutError

VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://api.example.com"  # placeholder: replace with your API domain

_UNSET: Any = object()

# Longest Retry-After (seconds) the client waits on a 429 before it gives up and raises instead.
MAX_RATE_LIMIT_WAIT = 60.0

CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "mov": "video/quicktime",
    "webm": "video/webm",
}


def content_type_from_filename(filename: Optional[str]) -> Optional[str]:
    """Guess a media content type from a file name, e.g. "clip.MOV" -> "video/quicktime"."""
    if not filename or "." not in filename:
        return None
    return CONTENT_TYPES.get(filename.rsplit(".", 1)[-1].lower())


def _header_int(headers: Any, name: str) -> Optional[int]:
    value = headers.get(name) if headers is not None else None
    try:
        return int(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None

JSON = Dict[str, Any]


def _normalize_base_url(raw: str) -> str:
    trimmed = raw.rstrip("/")
    return trimmed if trimmed.endswith("/api/v1") else trimmed + "/api/v1"


def _quote(value: str) -> str:
    return urllib.parse.quote(str(value), safe="")


def _compact(data: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in data.items() if v is not None and v is not _UNSET}


class Fanout:
    """Client for the Fanout API.

    Example:
        fanout = Fanout(api_key="fo_live_...", base_url="https://api.yourdomain.com")
        fanout.posts.create(content="Hello", platforms=[{"accountId": "acc_1"}], publish_now=True)
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        max_retries: int = 2,
        timeout: float = 60.0,
    ) -> None:
        if not api_key:
            raise ValueError("Fanout: api_key is required")
        self.api_key = api_key
        self.base_url = _normalize_base_url(base_url or os.environ.get("FANOUT_BASE_URL") or DEFAULT_BASE_URL)
        self.max_retries = max_retries
        self.timeout = timeout
        self.posts = Posts(self)
        self.accounts = Accounts(self)
        self.profiles = Profiles(self)
        self.connect = Connect(self)
        self.platforms = Platforms(self)
        self.webhooks = Webhooks(self)
        self.usage = UsageResource(self)
        self.analytics = Analytics(self)
        self.media = MediaResource(self)

    def _request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, Any]] = None,
        body: Any = _UNSET,
        extra_headers: Optional[Dict[str, str]] = None,
        retry: bool = False,
        raw_body: Optional[bytes] = None,
    ) -> Any:
        """Send one request.

        Retries happen only for requests that are safe to repeat (GET, or retry=True for writes that carry an
        Idempotency-Key): on network errors and 5xx, and on 429 when the server sends Retry-After (up to 60 s).
        Raw uploads (raw_body) are never retried.
        """
        url = self.base_url + path
        params = {k: str(v) for k, v in (query or {}).items() if v is not None and v != ""}
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "User-Agent": f"fanout-python/{VERSION}",
        }
        data = None
        if raw_body is not None:
            data = raw_body
        elif body is not _UNSET:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        headers.update(extra_headers or {})

        safe = raw_body is None and (method == "GET" or retry)
        retries = self.max_retries if safe else 0
        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    return self._parse(res.read())
            except urllib.error.HTTPError as err:
                status = err.code
                raw = err.read()
                if attempt < retries:
                    if status >= 500:
                        time.sleep(self._retry_delay(err.headers.get("Retry-After"), attempt))
                        attempt += 1
                        continue
                    wait = self._rate_limit_wait(err.headers.get("Retry-After")) if status == 429 else None
                    if wait is not None:
                        time.sleep(wait)
                        attempt += 1
                        continue
                payload = self._parse(raw)
                error = payload.get("error") if isinstance(payload, dict) else None
                rate_limit = None
                if status == 429:
                    rate_limit = {
                        "limit": _header_int(err.headers, "X-RateLimit-Limit"),
                        "remaining": _header_int(err.headers, "X-RateLimit-Remaining"),
                        "reset": _header_int(err.headers, "X-RateLimit-Reset"),
                        "retry_after": _header_int(err.headers, "Retry-After"),
                    }
                default_code = "rate_limited" if status == 429 else "http_error"
                if isinstance(error, dict):
                    raise FanoutError(
                        error.get("message") or f"HTTP {status}",
                        status=status,
                        code=error.get("code") or default_code,
                        details=error.get("details"),
                        rate_limit=rate_limit,
                    ) from None
                raise FanoutError(f"HTTP {status}", status=status, code=default_code, rate_limit=rate_limit) from None
            except (urllib.error.URLError, socket.timeout, ConnectionError) as err:
                if attempt < retries:
                    time.sleep(self._retry_delay(None, attempt))
                    attempt += 1
                    continue
                reason = getattr(err, "reason", err)
                raise FanoutError(f"Request failed: {reason}", status=0, code="network_error") from None

    @staticmethod
    def _parse(raw: bytes) -> Any:
        if not raw:
            return None
        text = raw.decode("utf-8", errors="replace")
        try:
            return json.loads(text)
        except ValueError:
            return text

    @staticmethod
    def _rate_limit_wait(header: Optional[str]) -> Optional[float]:
        """Seconds to wait on a 429, or None when the server gave no Retry-After or asked for too long."""
        if not header:
            return None
        try:
            seconds = float(header)
        except ValueError:
            return None
        return seconds if 0 <= seconds <= MAX_RATE_LIMIT_WAIT else None

    @staticmethod
    def _retry_delay(header: Optional[str], attempt: int) -> float:
        if header:
            try:
                return min(float(header), 30.0)
            except ValueError:
                pass
        return 0.5 * (2 ** attempt)


class _Resource:
    def __init__(self, client: Fanout) -> None:
        self._client = client


class Posts(_Resource):
    def create(
        self,
        platforms: List[JSON],
        content: str = "",
        media_items: Optional[List[JSON]] = None,
        scheduled_for: Optional[Union[str, datetime]] = None,
        timezone: Optional[str] = None,
        publish_now: Optional[bool] = None,
        is_draft: Optional[bool] = None,
        profile_id: Optional[str] = None,
        external_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JSON:
        """Create or schedule a post.

        idempotency_key: unique string per logical post. Retries with the same key never create a duplicate.

        platforms: list of {"accountId", "platform"?, "content"?, "platformSpecificData"?} dicts.
        scheduled_for: ISO string or datetime. A naive datetime is read in `timezone`.
        Omit scheduled_for (or pass publish_now=True) to publish now.
        """
        if isinstance(scheduled_for, datetime):
            scheduled_for = scheduled_for.isoformat()
        body = _compact(
            {
                "content": content,
                "platforms": platforms,
                "mediaItems": media_items,
                "scheduledFor": scheduled_for,
                "timezone": timezone,
                "publishNow": publish_now,
                "isDraft": is_draft,
                "profileId": profile_id,
                "externalId": external_id,
            }
        )
        if idempotency_key:
            return self._client._request(
                "POST", "/posts", body=body, extra_headers={"Idempotency-Key": idempotency_key}, retry=True
            )["post"]
        return self._client._request("POST", "/posts", body=body)["post"]

    def list(
        self,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
        profile_id: Optional[str] = None,
    ) -> JSON:
        """One page of posts, newest first: {"posts": [...], "nextCursor": str | None}."""
        query = {"limit": limit, "cursor": cursor, "status": status, "profileId": profile_id}
        return self._client._request("GET", "/posts", query=query)

    def iterate(self, limit: Optional[int] = None, status: Optional[str] = None, profile_id: Optional[str] = None) -> Iterator[JSON]:
        """Yield every post, fetching pages as needed."""
        cursor: Optional[str] = None
        while True:
            page = self.list(limit=limit, cursor=cursor, status=status, profile_id=profile_id)
            for post in page["posts"]:
                yield post
            cursor = page.get("nextCursor")
            if not cursor:
                return

    def get(self, post_id: str) -> JSON:
        return self._client._request("GET", f"/posts/{_quote(post_id)}")["post"]

    def delete(self, post_id: str) -> JSON:
        """Cancel a scheduled post, or delete a finished one from history: {"deleted", "cancelled"}."""
        return self._client._request("DELETE", f"/posts/{_quote(post_id)}")

    cancel = delete

    def retry(self, post_id: str) -> JSON:
        """Queue failed targets again: {"requeued": int}."""
        return self._client._request("POST", f"/posts/{_quote(post_id)}/retry")


class Accounts(_Resource):
    def list(self, profile_id: Optional[str] = None, platform: Optional[str] = None) -> List[JSON]:
        query = {"profileId": profile_id, "platform": platform}
        return self._client._request("GET", "/accounts", query=query)["accounts"]

    def get(self, account_id: str) -> JSON:
        return self._client._request("GET", f"/accounts/{_quote(account_id)}")["account"]

    def disconnect(self, account_id: str) -> JSON:
        """Disconnect the account and delete its tokens."""
        return self._client._request("DELETE", f"/accounts/{_quote(account_id)}")


class Profiles(_Resource):
    def list(self) -> List[JSON]:
        return self._client._request("GET", "/profiles")["profiles"]

    def create(self, name: str, description: Optional[str] = None) -> JSON:
        return self._client._request("POST", "/profiles", body=_compact({"name": name, "description": description}))["profile"]

    def get(self, profile_id: str) -> JSON:
        return self._client._request("GET", f"/profiles/{_quote(profile_id)}")["profile"]

    def update(self, profile_id: str, name: Optional[str] = None, description: Any = _UNSET) -> JSON:
        """Pass description=None to clear it."""
        body: JSON = {}
        if name is not None:
            body["name"] = name
        if description is not _UNSET:
            body["description"] = description
        return self._client._request("PATCH", f"/profiles/{_quote(profile_id)}", body=body)["profile"]

    def delete(self, profile_id: str) -> JSON:
        """Deleting a profile also removes its accounts."""
        return self._client._request("DELETE", f"/profiles/{_quote(profile_id)}")


class Connect(_Resource):
    def get_url(self, platform: str, profile_id: Optional[str] = None, redirect_url: Optional[str] = None) -> JSON:
        """A one-time hosted link (valid 30 minutes): {"authUrl", "expiresInSeconds"}."""
        query = {"profileId": profile_id, "redirectUrl": redirect_url}
        return self._client._request("GET", f"/connect/{_quote(platform)}", query=query)


class Platforms(_Resource):
    def list(self) -> List[JSON]:
        return self._client._request("GET", "/platforms")["platforms"]


class Webhooks(_Resource):
    def list(self) -> List[JSON]:
        return self._client._request("GET", "/webhooks")["webhooks"]

    def create(self, url: str, events: Optional[List[str]] = None) -> JSON:
        """The returned "secret" is only shown once. No events means all events."""
        body: JSON = {"url": url}
        if events is not None:
            body["events"] = events
        return self._client._request("POST", "/webhooks", body=body)["webhook"]

    def delete(self, webhook_id: str) -> JSON:
        return self._client._request("DELETE", f"/webhooks/{_quote(webhook_id)}")

    def test(self, webhook_id: str) -> JSON:
        """Send a test event: {"delivered", "status", "error"}."""
        return self._client._request("POST", f"/webhooks/{_quote(webhook_id)}/test")


class UsageResource(_Resource):
    def get(self) -> JSON:
        return self._client._request("GET", "/usage")


DateLike = Union[str, datetime]


def _date_param(value: Optional[DateLike]) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if isinstance(value, datetime) else str(value)


class Analytics(_Resource):
    """Post metrics and follower growth.

    engagements = likes + comments + shares + saves + quotes.
    engagementRate = engagements / (impressions, else views, else reach), as a fraction (0.0425 = 4.25%).
    """

    def overview(
        self,
        from_: Optional[DateLike] = None,
        to: Optional[DateLike] = None,
        days: Optional[int] = None,
        profile_id: Optional[str] = None,
        platform: Optional[str] = None,
        account_id: Optional[str] = None,
        timezone: Optional[str] = None,
    ) -> JSON:
        """Totals, per-network breakdown, daily series, top posts and follower growth.

        from_ / to: ISO date ("2026-10-01", whole day) or date-time, or a datetime. Default: the last `days` (30).
        timezone: IANA time zone for the daily buckets (default UTC).
        """
        query = {
            "from": _date_param(from_),
            "to": _date_param(to),
            "days": days,
            "profileId": profile_id,
            "platform": platform,
            "accountId": account_id,
            "timezone": timezone,
        }
        return self._client._request("GET", "/analytics", query=query)

    def post(self, post_id: str) -> JSON:
        """Latest metrics and history of one post, per account."""
        return self._client._request("GET", f"/analytics/posts/{_quote(post_id)}")

    def refresh_post(self, post_id: str) -> JSON:
        """Ask for fresh metrics now: {"queued": n}. Targets updated in the last 5 minutes are skipped.

        When queued is 0 the result also has "reason": "not_published" (nothing published to measure),
        "already_queued" (a fetch is already waiting) or "refreshed_recently" (updated in the last 5 minutes).
        """
        return self._client._request("POST", f"/analytics/posts/{_quote(post_id)}/refresh")

    def account(
        self,
        account_id: str,
        from_: Optional[DateLike] = None,
        to: Optional[DateLike] = None,
        days: Optional[int] = None,
    ) -> JSON:
        """Daily follower history of one account."""
        query = {"from": _date_param(from_), "to": _date_param(to), "days": days}
        return self._client._request("GET", f"/analytics/accounts/{_quote(account_id)}", query=query)


UploadSource = Union[str, "os.PathLike[str]", bytes, bytearray, memoryview, IO[bytes]]


class MediaResource(_Resource):
    """Upload images and videos, then use the returned "url" in a post's media_items.

    Allowed by default: JPEG, PNG, GIF, WebP (up to 20 MB) and MP4, MOV, WebM (up to 512 MB).
    """

    def upload(
        self,
        source: UploadSource,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> JSON:
        """Upload a file and return the stored media ({"id", "url", "type", ...}).

        source: a file path, raw bytes, or an open binary file. The file is read into memory.
        filename: defaults to the path's or file object's name. Also used to guess content_type.
        Uploads are never retried automatically.
        """
        if isinstance(source, (str, os.PathLike)):
            path = pathlib.Path(source)
            data = path.read_bytes()
            filename = filename or path.name
        elif isinstance(source, (bytes, bytearray, memoryview)):
            data = bytes(source)
        elif hasattr(source, "read"):
            data = source.read()
            if not isinstance(data, (bytes, bytearray)):
                raise TypeError("upload() needs a file opened in binary mode ('rb').")
            data = bytes(data)
            name = getattr(source, "name", None)
            if not filename and isinstance(name, str):
                filename = os.path.basename(name)
        else:
            raise TypeError("upload() takes a file path, bytes or a binary file object.")
        content_type = content_type or content_type_from_filename(filename)
        if not content_type:
            raise FanoutError(
                'Cannot tell the file type. Pass content_type (e.g. "image/png") or a filename with an extension.',
                status=0,
                code="unknown_content_type",
            )
        return self._client._request(
            "POST",
            "/media",
            query={"filename": filename},
            raw_body=data,
            extra_headers={"Content-Type": content_type},
        )["media"]

    def list(self, limit: Optional[int] = None, cursor: Optional[str] = None) -> JSON:
        """One page of uploaded files, newest first: {"media": [...], "nextCursor": ...}."""
        return self._client._request("GET", "/media", query={"limit": limit, "cursor": cursor})

    def get(self, media_id: str) -> JSON:
        return self._client._request("GET", f"/media/{_quote(media_id)}")["media"]

    def delete(self, media_id: str) -> JSON:
        """Delete the stored file. Posts already published keep their copy on the networks."""
        return self._client._request("DELETE", f"/media/{_quote(media_id)}")
