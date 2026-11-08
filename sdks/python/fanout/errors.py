from typing import Any, Optional


class FanoutError(Exception):
    """Raised for every failed API request.

    Attributes:
        status: HTTP status code, or 0 for network errors and timeouts.
        code: machine readable code, e.g. "validation_error", "plan_limit", "not_found".
        details: extra data. For 422 responses a list of {accountId, platform, errors}.
    """

    def __init__(self, message: str, status: int, code: str, details: Optional[Any] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details

    def __repr__(self) -> str:
        return f"FanoutError(status={self.status!r}, code={self.code!r}, message={self.message!r})"
