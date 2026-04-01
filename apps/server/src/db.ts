import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function createDatabase(databasePath: string) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      host_player_id TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      genres_json TEXT NOT NULL DEFAULT '[]',
      language_preference TEXT NOT NULL DEFAULT 'mixed',
      tracks_per_team INTEGER NOT NULL DEFAULT 10,
      playback_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_host INTEGER NOT NULL,
      age INTEGER NOT NULL DEFAULT 25,
      team TEXT NOT NULL DEFAULT 'blue',
      score INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'idle',
      current_round INTEGER NOT NULL,
      current_turn_player_id TEXT,
      current_track_library_id TEXT,
      started_at TEXT,
      ended_at TEXT,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS room_tracks (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_track_id TEXT NOT NULL,
      team TEXT NOT NULL DEFAULT 'blue',
      title TEXT NOT NULL,
      artists_json TEXT NOT NULL,
      album TEXT,
      release_year INTEGER,
      duration_ms INTEGER,
      artwork_url TEXT,
      preview_url TEXT,
      external_url TEXT,
      added_at TEXT NOT NULL,
      used_in_round INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS round_guesses (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      guessed_year INTEGER NOT NULL,
      submitted_at TEXT NOT NULL,
      UNIQUE (room_id, round_number, player_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS timeline_entries (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      track_library_id TEXT NOT NULL,
      position_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (player_id, track_library_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      FOREIGN KEY (track_library_id) REFERENCES room_tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS round_placements (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      insert_index INTEGER NOT NULL,
      submitted_at TEXT NOT NULL,
      UNIQUE (room_id, round_number, player_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS round_bonus_guesses (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      title_guess TEXT NOT NULL,
      artist_guess TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      UNIQUE (room_id, round_number, player_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, "games", "current_track_library_id", "TEXT");
  ensureColumn(db, "games", "current_turn_player_id", "TEXT");
  ensureColumn(db, "games", "phase", "TEXT NOT NULL DEFAULT 'idle'");
  ensureColumn(db, "players", "score", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "players", "age", "INTEGER NOT NULL DEFAULT 25");
  ensureColumn(db, "players", "team", "TEXT NOT NULL DEFAULT 'blue'");
  ensureColumn(db, "rooms", "genres_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "rooms", "language_preference", "TEXT NOT NULL DEFAULT 'mixed'");
  ensureColumn(db, "rooms", "tracks_per_team", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn(db, "room_tracks", "team", "TEXT NOT NULL DEFAULT 'blue'");

  return db;
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string) {
  const columns = db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}
