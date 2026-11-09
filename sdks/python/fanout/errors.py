from typing import Any, Dict, Optional


class FanoutError(Exception):
    """Raised for every failed API request.

    Attributes:
        status: HTTP status code, or 0 for network errors and timeouts.
        code: machine readable code, e.g. "validation_error", "plan_limit", "not_found".
        details: extra data. For 422 responses a list of {accountId, platform, errors}.
        rate_limit: for 429 responses (code "rate_limited"), a dict with the limit headers the server sent:
            {"limit", "remaining", "reset", "retry_after"} (each an int or None).
    """

    def __init__(
        self,
        message: str,
        status: int,
        code: str,
        details: Optional[Any] = None,
        rate_limit: Optional[Dict[str, Optional[int]]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details
        self.rate_limit = rate_limit

    def __repr__(self) -> str:
        return f"FanoutError(status={self.status!r}, code={self.code!r}, message={self.message!r})"
