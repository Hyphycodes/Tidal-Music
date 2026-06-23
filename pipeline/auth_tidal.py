"""One-time Tidal OAuth device-flow login + session persistence.

    python -m pipeline.auth_tidal

Prints a link + code, waits for you to authorize, then writes the session
(access + refresh token) to ``TIDAL_SESSION_FILE`` (gitignored, chmod 600).
``ingest`` reuses and silently refreshes it. Tokens are NEVER printed.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import tidalapi

from .config import configure_logging, settings


def save_session(session: "tidalapi.Session", path: str) -> None:
    data = {
        "token_type": session.token_type,
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "expiry_time": session.expiry_time.isoformat() if session.expiry_time else None,
    }
    p = Path(path)
    p.write_text(json.dumps(data))
    try:
        os.chmod(p, 0o600)  # tokens are secrets — restrict permissions
    except OSError:
        pass


def load_session(path: str) -> "tidalapi.Session | None":
    """Restore (and refresh) a saved session, or return None if absent/invalid."""
    p = Path(path)
    if not p.exists():
        return None
    data = json.loads(p.read_text())
    session = tidalapi.Session()
    expiry = dt.datetime.fromisoformat(data["expiry_time"]) if data.get("expiry_time") else None
    session.load_oauth_session(
        data["token_type"], data["access_token"], data.get("refresh_token"), expiry
    )
    if not session.check_login():
        return None
    # tokens may have been refreshed on load — persist the latest
    save_session(session, path)
    return session


def main() -> None:
    log = configure_logging()
    session = tidalapi.Session()
    log.info("Starting Tidal OAuth device login…")
    session.login_oauth_simple()  # prints the verification URL + code, blocks until authorized
    if not session.check_login():
        raise SystemExit("Tidal login failed.")
    save_session(session, settings.tidal_session_file)
    log.info("Logged in. Session saved to %s", settings.tidal_session_file)


if __name__ == "__main__":
    main()
