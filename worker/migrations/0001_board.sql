-- One row a player: the name on the board, and the best run the server
-- itself played again. key_hash is the SHA-256 of the secret the plugin keeps.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  best INTEGER NOT NULL DEFAULT 0,
  best_at INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX players_best ON players (best DESC, best_at);

-- Every run taken, with what plays it again, so one that looks wrong can be
-- watched and removed. digest keeps one run from being sent twice.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  ticks INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  log TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX runs_player ON runs (player_id);

-- Who wrote lately, to slow a flood: a salted hash of the address, kept an hour.
CREATE TABLE hits (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX hits_ip ON hits (ip, at);
