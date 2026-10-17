PRAGMA foreign_keys = ON;
CREATE TABLE customers (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ru',
 platform TEXT NOT NULL DEFAULT 'unknown', app_version TEXT NOT NULL DEFAULT 'unknown',
 created_at INTEGER NOT NULL
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE tickets (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), subject TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting_for_customer','needs_human','resolved')),
 escalation_reason TEXT, active_attempt TEXT, active_message TEXT, lease_until INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX tickets_customer ON tickets(customer_id, updated_at);
CREATE TABLE messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, ticket_id TEXT NOT NULL REFERENCES tickets(id),
 role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
 client_message_id TEXT, reply_to TEXT UNIQUE REFERENCES messages(id),
 processing_status TEXT NOT NULL CHECK(processing_status IN ('processing','failed','complete')),
 error_code TEXT, sources_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
 UNIQUE(ticket_id, client_message_id)
);
CREATE INDEX messages_ticket ON messages(ticket_id, seq);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE knowledge_state (id INTEGER PRIMARY KEY CHECK(id = 1), generation TEXT NOT NULL);
CREATE TABLE knowledge_chunks (
 id INTEGER PRIMARY KEY, generation TEXT NOT NULL, document_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
 path TEXT NOT NULL, heading TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
 document_hash TEXT NOT NULL, text TEXT NOT NULL, search_text TEXT NOT NULL,
 UNIQUE(generation, chunk_id)
);
CREATE INDEX knowledge_generation ON knowledge_chunks(generation);
CREATE VIRTUAL TABLE knowledge_fts USING fts5(heading, search_text, content='knowledge_chunks', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER knowledge_insert AFTER INSERT ON knowledge_chunks BEGIN
 INSERT INTO knowledge_fts(rowid, heading, search_text) VALUES(new.id, new.heading, new.search_text);
END;
CREATE TRIGGER knowledge_delete AFTER DELETE ON knowledge_chunks BEGIN
 INSERT INTO knowledge_fts(knowledge_fts,rowid,heading,search_text) VALUES('delete',old.id,old.heading,old.search_text);
END;
