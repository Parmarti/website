import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional, Union

from .errors import FanoutError

VERSION = "0.1.0"
DEFAULT_BASE_URL = "https://api.example.com"  # placeholder: replace with your API domain

_UNSET: Any = object()

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

    def _request(
        self,
        method: str,
        path: str,
        query: Optional[Dict[str, Any]] = None,
        body: Any = _UNSET,
        extra_headers: Optional[Dict[str, str]] = None,
        retry: bool = False,
    ) -> Any:
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
        if body is not _UNSET:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        headers.update(extra_headers or {})

        retries = self.max_retries if method == "GET" or retry else 0
        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    return self._parse(res.read())
            except urllib.error.HTTPError as err:
                status = err.code
                raw = err.read()
                if (status == 429 or status >= 500) and attempt < retries:
                    time.sleep(self._retry_delay(err.headers.get("Retry-After"), attempt))
                    attempt += 1
                    continue
                payload = self._parse(raw)
                error = payload.get("error") if isinstance(payload, dict) else None
                if isinstance(error, dict):
                    raise FanoutError(
                        error.get("message") or f"HTTP {status}",
                        status=status,
                        code=error.get("code") or "http_error",
                        details=error.get("details"),
                    ) from None
                raise FanoutError(f"HTTP {status}", status=status, code="http_error") from None
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
