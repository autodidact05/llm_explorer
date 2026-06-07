import logging
import sqlite3
import time
from collections.abc import Generator
from contextlib import contextmanager

import backend.config as _config

logger = logging.getLogger(__name__)

def execute_with_retry(
    conn: sqlite3.Connection,
    sql: str,
    params: tuple[object, ...] | list[object] = (),
    *,
    retries: int = 5,
    base_delay_s: float = 0.05,
) -> sqlite3.Cursor:
    """Execute a statement with small backoff when SQLite is locked."""
    for attempt in range(retries + 1):
        try:
            return conn.execute(sql, params)  # type: ignore[arg-type]
        except sqlite3.OperationalError as exc:
            msg = str(exc).lower()
            if "database is locked" in msg or "database is busy" in msg or "locked" in msg:
                if attempt >= retries:
                    raise
                time.sleep(base_delay_s * (2**attempt))
                continue
            raise


@contextmanager
def db_connection() -> Generator[sqlite3.Connection]:
    conn = sqlite3.connect(str(_config.DB_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
