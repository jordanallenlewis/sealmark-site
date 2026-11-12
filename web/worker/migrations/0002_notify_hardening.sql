-- Grade alerts hardening (web/worker/index.js).

-- The baseline also keeps the Sealmark build that graded it (a new build moves grades with no change in the server,
-- so no up/down email) and the pack letters (an area that comes back inconclusive keeps its last letter).
ALTER TABLE grades ADD COLUMN sealmark TEXT;
ALTER TABLE grades ADD COLUMN packs TEXT NOT NULL DEFAULT '[]';

-- What a notice says ({from, to, direction, fixed, broke}), so a send interrupted mid-batch finishes from the record.
-- `live` is 1 and `recipients` the delivered count only once the batch is done (fleet/impact.mjs reads live = 1).
ALTER TABLE notices ADD COLUMN change TEXT;

-- One row per notice and subscriber, written in the same transaction as the notice and the new baseline, before any
-- send. A row leaves 'pending' (claimed as 'sending') before its one send attempt and never goes back, so no notice
-- reaches an address twice: a failed or interrupted send is recorded, not retried.
CREATE TABLE deliveries (
  notice_id INTEGER NOT NULL,
  subscriber_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'dry', 'failed', 'dropped')),
  error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (notice_id, subscriber_id)
);
CREATE INDEX deliveries_status ON deliveries (status);

-- Unconfirmed sign-ups are deleted after 7 days (the hourly tick).
CREATE INDEX subscribers_pending ON subscribers (status, created_at);
