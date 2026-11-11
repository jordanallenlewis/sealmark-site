-- Grade-change email alerts (web/worker/index.js). Only what the alerts need: the address, which server, the state of
-- the opt-in, and a hash of the one token that confirms or cancels it. No names, no IPs (only a salted hash, kept for
-- the rate limit window).

CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'unsubscribed')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  unsubscribed_at TEXT,
  UNIQUE (server_id, email)
);
CREATE INDEX subscribers_server ON subscribers (server_id, status);

-- The last grade each server's subscribers were told about (or the baseline when first seen).
CREATE TABLE grades (
  server_id TEXT PRIMARY KEY,
  letter TEXT,
  version TEXT,
  failing TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

-- Every grade-change email batch, for the fleet's impact ledger (fleet/impact.mjs reads it).
CREATE TABLE notices (
  id INTEGER PRIMARY KEY,
  server_id TEXT NOT NULL,
  letter_from TEXT NOT NULL,
  letter_to TEXT NOT NULL,
  version TEXT,
  failing TEXT NOT NULL DEFAULT '[]',
  recipients INTEGER NOT NULL,
  live INTEGER NOT NULL,
  sent_at TEXT NOT NULL
);

-- Subscribe attempts in the last hour, by salted IP hash and by address, for the rate limit.
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX attempts_key ON attempts (key, at);
