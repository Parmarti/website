import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Union

from .errors import FanoutError

SIGNATURE_HEADER = "X-Fanout-Signature"


def _body_text(raw_body: Union[bytes, bytearray, str]) -> str:
    return raw_body.decode("utf-8") if isinstance(raw_body, (bytes, bytearray)) else raw_body


def verify_webhook_signature(
    raw_body: Union[bytes, bytearray, str],
    header: Optional[str],
    secret: str,
    tolerance: int = 300,
    now: Optional[int] = None,
) -> bool:
    """Check the X-Fanout-Signature header of a webhook delivery.

    Pass the raw request body exactly as received. A tolerance of 0 turns off the timestamp check.
    """
    if not header or not secret:
        return False
    timestamp: Optional[int] = None
    signatures = []
    for part in header.split(","):
        key, sep, value = part.partition("=")
        if not sep:
            continue
        key, value = key.strip(), value.strip()
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1":
            signatures.append(value)
    if timestamp is None or not signatures:
        return False
    current = int(time.time()) if now is None else now
    if tolerance > 0 and abs(current - timestamp) > tolerance:
        return False
    payload = f"{timestamp}.{_body_text(raw_body)}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(sig, expected) for sig in signatures)


def construct_webhook_event(
    raw_body: Union[bytes, bytearray, str],
    header: Optional[str],
    secret: str,
    tolerance: int = 300,
) -> Dict[str, Any]:
    """Verify the signature and return the parsed event. Raises FanoutError(code="invalid_signature")."""
    if not verify_webhook_signature(raw_body, header, secret, tolerance):
        raise FanoutError("Invalid webhook signature.", status=400, code="invalid_signature")
    return json.loads(_body_text(raw_body))
