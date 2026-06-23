"""Shared configuration for the Crate pipeline.

Importing this module never fails on missing env — each worker calls
``settings.require(...)`` for exactly the vars it needs, so e.g. the Discogs
worker doesn't demand a Tidal session.
"""
from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    # database (pipeline uses a direct/session connection; the web app uses the pooler)
    db_url: str | None = os.getenv("SUPABASE_DB_URL")
    db_url_readonly: str | None = os.getenv("SUPABASE_DB_URL_READONLY")
    # external services
    anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY")
    discogs_token: str | None = os.getenv("DISCOGS_TOKEN")
    musicbrainz_app_contact: str | None = os.getenv("MUSICBRAINZ_APP_CONTACT")
    tidal_session_file: str = os.getenv("TIDAL_SESSION_FILE", ".tidal-session.json")
    # model + app constants
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    embed_model: str = os.getenv("EMBED_MODEL", "BAAI/bge-large-en-v1.5")
    embed_dim: int = int(os.getenv("EMBED_DIM", "1024"))
    app_name: str = "Crate"
    app_version: str = "0.1.0"

    def require(self, *names: str) -> None:
        missing = [n for n in names if not getattr(self, n, None)]
        if missing:
            raise SystemExit(
                f"Missing required environment variable(s): {', '.join(missing)}.\n"
                f"Set them in .env (see .env.example)."
            )


settings = Settings()


def configure_logging() -> logging.Logger:
    """One-line, timestamped logs to stdout. Never logs secrets."""
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )
    return logging.getLogger("crate")
