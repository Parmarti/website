"""Official Python SDK for the Fanout unified social media API."""

from .client import VERSION, Fanout, content_type_from_filename
from .errors import FanoutError
from .webhooks import SIGNATURE_HEADER, construct_webhook_event, verify_webhook_signature

__version__ = VERSION

PLATFORMS = (
    "twitter",
    "linkedin",
    "facebook",
    "instagram",
    "threads",
    "tiktok",
    "youtube",
    "pinterest",
    "reddit",
    "googlebusiness",
    "bluesky",
    "mastodon",
    "telegram",
    "discord",
)

__all__ = [
    "Fanout",
    "FanoutError",
    "PLATFORMS",
    "SIGNATURE_HEADER",
    "VERSION",
    "construct_webhook_event",
    "content_type_from_filename",
    "verify_webhook_signature",
]
