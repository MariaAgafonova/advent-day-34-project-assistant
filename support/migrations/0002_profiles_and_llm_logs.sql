-- Additive: existing customers, tickets and messages remain unchanged.
CREATE TABLE llm_calls (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 ticket_id TEXT NOT NULL REFERENCES tickets(id),
 message_id TEXT NOT NULL REFERENCES messages(id),
 generation_id TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('search','answer')),
 attempt_number INTEGER NOT NULL,
 model TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','success','error')),
 http_status INTEGER,
 prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER,
 duration_ms INTEGER, error_code TEXT,
 started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX llm_calls_ticket ON llm_calls(ticket_id,seq);
CREATE TABLE operator_sessions (
 token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL,
 credential_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
