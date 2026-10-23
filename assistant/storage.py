"""Private local session storage; no demo account or cross-session state."""
from __future__ import annotations
import json
import sqlite3
import threading
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._guard = threading.Lock()
        self._locks = {}
        with self.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)')

    def connection(self):
        return sqlite3.connect(self.path, timeout=15)

    def lock(self, session):
        with self._guard:
            return self._locks.setdefault(session, threading.RLock())

    def load(self, session):
        with self.connection() as db:
            row = db.execute('SELECT state FROM sessions WHERE id=?', (session,)).fetchone()
        return json.loads(row[0]) if row else {'version': 1, 'threads': [], 'records': [], 'budgets': {}, 'requests': {}, 'profile': {}}

    def save(self, session, state):
        with self.connection() as db:
            db.execute('INSERT INTO sessions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state',
                       (session, json.dumps(state, ensure_ascii=False)))
