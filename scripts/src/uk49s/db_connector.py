"""Database connector using psycopg2. URL loaded from env (never hard-coded)."""
import os, psycopg2, psycopg2.extras

def get_connection():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise ValueError("DATABASE_URL not set. Use environment variable, do not hard-code.")
    return psycopg2.connect(url)

def fetch_all(query, params=None):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params or ())
            return cur.fetchall()
    finally:
        conn.close()

def execute(query, params=None, returning=False):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, params or ())
            result = cur.fetchall() if returning else None
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
