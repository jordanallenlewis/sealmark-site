-- Page views for "where did visitors come from" (web/worker/visits.mjs, components/VisitBeacon.tsx). Only the page, the
-- host of the referring site and the three UTM params. No IP (not even hashed), no cookie or visitor id, no user agent,
-- no country: rows cannot be joined into a person. Kept 365 days (the hourly tick deletes older rows). /privacy/ says so.

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,               -- ISO time, to the minute
  path TEXT NOT NULL,
  landing INTEGER NOT NULL,       -- 1 for the first page of a visit (the one that carries the referrer and UTM)
  ref_host TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT ''
);
CREATE INDEX visits_at ON visits (at);
