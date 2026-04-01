import type Database from "better-sqlite3";
import { createInitialGameState, createRoomCode } from "@hitster/core";
import type {
  AuthoredRoomResponse,
  BonusGuess,
  CreateRoomInput,
  HiddenTrack,
  NormalizedTrack,
  PlacementGuess,
  PlacementOutcome,
  PlayerState,
  RevealResult,
  RoomSnapshot,
  RoomSettings,
  RoomStatus,
  TeamColor,
  SubmitBonusGuessInput,
  SubmitPlacementInput,
  TimelineEntry,
} from "@hitster/shared";

type RoomRow = {
  id: string;
  code: string;
  host_player_id: string;
  status: RoomStatus;
  provider_id: string;
  genres_json: string;
  language_preference: "mixed" | "spanish" | "english";
  tracks_per_team: number;
  playback_mode: string;
  created_at: string;
};

type PlayerRow = {
  id: string;
  room_id: string;
  name: string;
  is_host: number;
  age: number;
  team: TeamColor;
  score: number;
  joined_at: string;
};

type GameRow = {
  status: "lobby" | "ready" | "in_progress" | "finished";
  phase: "idle" | "guessing" | "revealed";
  current_round: number;
  current_turn_player_id: string | null;
  current_track_library_id: string | null;
};

type RoomTrackRow = {
  id: string;
  room_id: string;
  provider: string;
  provider_track_id: string;
  team: TeamColor;
  title: string;
  artists_json: string;
  album: string | null;
  release_year: number | null;
  duration_ms: number | null;
  artwork_url: string | null;
  preview_url: string | null;
  external_url: string | null;
  added_at: string;
  used_in_round: number;
};

type PlacementRow = {
  player_id: string;
  player_name: string;
  insert_index: number;
  submitted_at: string;
};

type BonusGuessRow = {
  player_id: string;
  player_name: string;
  title_guess: string;
  artist_guess: string;
  submitted_at: string;
};

type TimelineEntryRow = {
  entry_id: string;
  player_id: string;
  position_index: number;
} & RoomTrackRow;

export class RoomStore {
  constructor(private readonly db: Database.Database) {}

  createRoom(input: CreateRoomInput): RoomSnapshot {
    const roomId = crypto.randomUUID();
    const now = new Date().toISOString();
    const code = createUniqueRoomCode(this.db);
    const gameState = createInitialGameState();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO rooms (
            id, code, host_player_id, status, provider_id, genres_json, language_preference, tracks_per_team, playback_mode, created_at
          )
          VALUES (
            @id, @code, @host_player_id, @status, @provider_id, @genres_json, @language_preference, @tracks_per_team, @playback_mode, @created_at
          )
        `)
        .run({
          id: roomId,
          code,
          host_player_id: "",
          status: "lobby",
          provider_id: input.providerId,
          genres_json: JSON.stringify(input.genres),
          language_preference: input.languagePreference,
          tracks_per_team: input.tracksPerTeam ?? 10,
          playback_mode: input.playbackMode,
          created_at: now,
        });

      this.db
        .prepare(`
          INSERT INTO games (
            id, room_id, status, phase, current_round, current_turn_player_id, current_track_library_id, started_at, ended_at
          )
          VALUES (
            @id, @room_id, @status, @phase, @current_round, @current_turn_player_id, @current_track_library_id, @started_at, @ended_at
          )
        `)
        .run({
          id: crypto.randomUUID(),
          room_id: roomId,
          status: gameState.status,
          phase: gameState.phase,
          current_round: gameState.currentRound,
          current_turn_player_id: null,
          current_track_library_id: null,
          started_at: null,
          ended_at: null,
        });
    });

    tx();

    return this.getRoomByCode(code)!;
  }

  joinRoom(code: string, name: string, age: number, team: TeamColor): AuthoredRoomResponse | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const playerId = crypto.randomUUID();

    this.db
      .prepare(`
        INSERT INTO players (id, room_id, name, is_host, age, team, score, joined_at)
        VALUES (@id, @room_id, @name, @is_host, @age, @team, @score, @joined_at)
      `)
      .run({
        id: playerId,
        room_id: room.id,
        name,
        is_host: 0,
        age,
        team,
        score: 0,
        joined_at: new Date().toISOString(),
      });

    return {
      room: this.getRoomByCode(code)!,
      playerId,
    };
  }

  replaceRoomTracks(code: string, tracks: Array<{ track: NormalizedTrack; team: TeamColor }>): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM round_guesses WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM round_placements WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM round_bonus_guesses WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM timeline_entries WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM room_tracks WHERE room_id = ?").run(room.id);
      this.db.prepare("UPDATE players SET score = 0 WHERE room_id = ?").run(room.id);

      const insertTrack = this.db.prepare(`
        INSERT INTO room_tracks (
          id, room_id, provider, provider_track_id, team, title, artists_json, album,
          release_year, duration_ms, artwork_url, preview_url, external_url, added_at, used_in_round
        )
        VALUES (
          @id, @room_id, @provider, @provider_track_id, @team, @title, @artists_json, @album,
          @release_year, @duration_ms, @artwork_url, @preview_url, @external_url, @added_at, @used_in_round
        )
      `);

      for (const { track, team } of tracks) {
        insertTrack.run({
          id: crypto.randomUUID(),
          room_id: room.id,
          provider: track.provider,
          provider_track_id: track.providerTrackId,
          team,
          title: track.title,
          artists_json: JSON.stringify(track.artists),
          album: track.album ?? null,
          release_year: track.releaseYear ?? null,
          duration_ms: track.durationMs ?? null,
          artwork_url: track.artworkUrl ?? null,
          preview_url: track.previewUrl ?? null,
          external_url: track.externalUrl ?? null,
          added_at: now,
          used_in_round: 0,
        });
      }

      this.db
        .prepare(
          `
            UPDATE games
            SET status = 'ready',
                phase = 'idle',
                current_round = 0,
                current_turn_player_id = NULL,
                current_track_library_id = NULL,
                started_at = NULL,
                ended_at = NULL
            WHERE room_id = ?
          `,
        )
        .run(room.id);

      this.db.prepare("UPDATE rooms SET status = 'lobby' WHERE id = ?").run(room.id);
    });

    tx();
    this.assignStarterTracks(room.id);
    return this.getRoomByCode(code);
  }

  startNextRound(code: string): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const game = this.getGameRow(room.id);
    if (game?.phase === "guessing") {
      return this.getRoomByCode(code);
    }

    const nextRoundNumber = (game?.current_round ?? 0) + 1;
    const turnPlayerId = this.getTurnPlayerId(room.id, nextRoundNumber);
    const turnTeam = this.getTeamForPlayer(room.id, turnPlayerId);

    if (!turnTeam) {
      return null;
    }

    const nextTrack = this.db
      .prepare(
        `
          SELECT *
          FROM room_tracks
          WHERE room_id = ? AND used_in_round = 0 AND team = ?
          ORDER BY RANDOM()
          LIMIT 1
        `,
      )
      .get(room.id, turnTeam) as RoomTrackRow | undefined;

    if (!nextTrack) {
      return null;
    }

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM round_placements WHERE room_id = ? AND round_number = ?").run(room.id, nextRoundNumber);
      this.db.prepare("DELETE FROM round_bonus_guesses WHERE room_id = ? AND round_number = ?").run(room.id, nextRoundNumber);
      this.db.prepare("UPDATE room_tracks SET used_in_round = 1 WHERE id = ?").run(nextTrack.id);
      this.db
        .prepare(
          `
            UPDATE games
            SET status = 'in_progress',
                phase = 'guessing',
                current_round = ?,
                current_turn_player_id = ?,
                current_track_library_id = ?,
                started_at = COALESCE(started_at, ?)
            WHERE room_id = ?
          `,
        )
        .run(nextRoundNumber, turnPlayerId, nextTrack.id, new Date().toISOString(), room.id);
      this.db.prepare("UPDATE rooms SET status = 'in_progress' WHERE id = ?").run(room.id);
    });

    tx();
    return this.getRoomByCode(code);
  }

  submitPlacement(code: string, input: SubmitPlacementInput): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const game = this.getGameRow(room.id);
    if (!game || game.phase !== "guessing") {
      return this.getRoomByCode(code);
    }

    if (game.current_turn_player_id !== input.playerId) {
      return this.getRoomByCode(code);
    }

    this.db
      .prepare(
        `
          INSERT INTO round_placements (id, room_id, round_number, player_id, insert_index, submitted_at)
          VALUES (@id, @room_id, @round_number, @player_id, @insert_index, @submitted_at)
          ON CONFLICT(room_id, round_number, player_id)
          DO UPDATE SET insert_index = excluded.insert_index, submitted_at = excluded.submitted_at
        `,
      )
      .run({
        id: crypto.randomUUID(),
        room_id: room.id,
        round_number: game.current_round,
        player_id: input.playerId,
        insert_index: input.insertIndex,
        submitted_at: new Date().toISOString(),
      });

    return this.getRoomByCode(code);
  }

  submitBonusGuess(code: string, input: SubmitBonusGuessInput): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const game = this.getGameRow(room.id);
    if (!game || game.phase !== "guessing") {
      return this.getRoomByCode(code);
    }

    if (game.current_turn_player_id !== input.playerId) {
      return this.getRoomByCode(code);
    }

    this.db
      .prepare(
        `
          INSERT INTO round_bonus_guesses (id, room_id, round_number, player_id, title_guess, artist_guess, submitted_at)
          VALUES (@id, @room_id, @round_number, @player_id, @title_guess, @artist_guess, @submitted_at)
          ON CONFLICT(room_id, round_number, player_id)
          DO UPDATE SET
            title_guess = excluded.title_guess,
            artist_guess = excluded.artist_guess,
            submitted_at = excluded.submitted_at
        `,
      )
      .run({
        id: crypto.randomUUID(),
        room_id: room.id,
        round_number: game.current_round,
        player_id: input.playerId,
        title_guess: input.titleGuess.trim(),
        artist_guess: input.artistGuess.trim(),
        submitted_at: new Date().toISOString(),
      });

    return this.getRoomByCode(code);
  }

  revealCurrentRound(code: string): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const game = this.getGameRow(room.id);
    if (!game || !game.current_track_library_id || game.phase !== "guessing") {
      return this.getRoomByCode(code);
    }

    const activeTrack = this.db
      .prepare("SELECT * FROM room_tracks WHERE id = ?")
      .get(game.current_track_library_id) as RoomTrackRow | undefined;

    if (!activeTrack || !activeTrack.release_year) {
      return this.getRoomByCode(code);
    }

    const placements = this.getPlacementRows(room.id, game.current_round);
    const bonusGuesses = this.getBonusGuessRows(room.id, game.current_round);
    const players = this.db
      .prepare("SELECT * FROM players WHERE room_id = ? ORDER BY joined_at ASC")
      .all(room.id) as PlayerRow[];

    const tx = this.db.transaction(() => {
      for (const placement of placements) {
        const timeline = this.getTimelineEntries(room.id, placement.player_id);
        const isCorrect = validatePlacement(timeline, placement.insert_index, activeTrack.release_year!);
        const bonusGuess = bonusGuesses.find((guess) => guess.player_id === placement.player_id) ?? null;
        const bonusCorrect = bonusGuess ? validateBonusGuess(activeTrack, bonusGuess) : false;

        if (!isCorrect) {
          continue;
        }

        shiftTimelineEntries(this.db, placement.player_id, placement.insert_index);
        this.db
          .prepare(
            `
              INSERT INTO timeline_entries (id, room_id, player_id, track_library_id, position_index, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            crypto.randomUUID(),
            room.id,
            placement.player_id,
            activeTrack.id,
            placement.insert_index,
            new Date().toISOString(),
          );
        this.db
          .prepare("UPDATE players SET score = score + ? WHERE id = ?")
          .run(bonusCorrect ? 2 : 1, placement.player_id);
      }

      const remainingCount = this.db
        .prepare("SELECT COUNT(*) AS remaining FROM room_tracks WHERE room_id = ? AND used_in_round = 0")
        .get(room.id) as { remaining: number };

      const nextStatus = remainingCount.remaining === 0 ? "finished" : "in_progress";
      const nextRoomStatus: RoomStatus = remainingCount.remaining === 0 ? "finished" : "in_progress";

      this.db
        .prepare(
          `
            UPDATE games
            SET phase = 'revealed',
                status = ?,
                ended_at = CASE WHEN ? = 'finished' THEN ? ELSE NULL END
            WHERE room_id = ?
          `,
        )
        .run(nextStatus, nextStatus, new Date().toISOString(), room.id);
      this.db.prepare("UPDATE rooms SET status = ? WHERE id = ?").run(nextRoomStatus, room.id);
    });

    tx();
    return this.getRoomByCode(code);
  }

  resetGame(code: string): RoomSnapshot | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM round_placements WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM round_bonus_guesses WHERE room_id = ?").run(room.id);
      this.db.prepare("DELETE FROM timeline_entries WHERE room_id = ?").run(room.id);
      this.db.prepare("UPDATE room_tracks SET used_in_round = 0 WHERE room_id = ?").run(room.id);
      this.db.prepare("UPDATE players SET score = 0 WHERE room_id = ?").run(room.id);
      this.db
        .prepare(
          `
            UPDATE games
            SET status = 'ready',
                phase = 'idle',
                current_round = 0,
                current_turn_player_id = NULL,
                current_track_library_id = NULL,
                started_at = NULL,
                ended_at = NULL
            WHERE room_id = ?
          `,
        )
        .run(room.id);
      this.db.prepare("UPDATE rooms SET status = 'lobby' WHERE id = ?").run(room.id);
    });

    tx();
    this.assignStarterTracks(room.id);
    return this.getRoomByCode(code);
  }

  getCurrentTrack(code: string): NormalizedTrack | null {
    const room = this.getRoomByCode(code);
    if (!room) {
      return null;
    }

    const game = this.getGameRow(room.id);
    if (!game?.current_track_library_id) {
      return null;
    }

    const track = this.db
      .prepare("SELECT * FROM room_tracks WHERE id = ?")
      .get(game.current_track_library_id) as RoomTrackRow | undefined;

    return track ? mapTrack(track) : null;
  }

  getRoomByCode(code: string): RoomSnapshot | null {
    const room = this.db.prepare("SELECT * FROM rooms WHERE code = ?").get(code) as RoomRow | undefined;

    if (!room) {
      return null;
    }

    const players = this.db
      .prepare("SELECT * FROM players WHERE room_id = ? ORDER BY joined_at ASC")
      .all(room.id) as PlayerRow[];
    const timelinesByPlayer = this.getAllTimelines(room.id);
    const game = this.getGameRow(room.id);
    const remainingCount = this.db
      .prepare("SELECT COUNT(*) AS remaining FROM room_tracks WHERE room_id = ? AND used_in_round = 0")
      .get(room.id) as { remaining: number };
    const totalCount = this.db
      .prepare("SELECT COUNT(*) AS total FROM room_tracks WHERE room_id = ?")
      .get(room.id) as { total: number };

    const activeTrackRow = game?.current_track_library_id
      ? ((this.db.prepare("SELECT * FROM room_tracks WHERE id = ?").get(game.current_track_library_id) as
          | RoomTrackRow
          | undefined) ?? null)
      : null;

    const placements = game ? this.getPlacementRows(room.id, game.current_round).map(mapPlacement) : [];
    const bonusGuesses = game ? this.getBonusGuessRows(room.id, game.current_round).map(mapBonusGuess) : [];
    const reveal = game && activeTrackRow && game.phase === "revealed"
      ? buildReveal(activeTrackRow, placements, bonusGuesses, players, timelinesByPlayer)
      : null;

    return {
      id: room.id,
      code: room.code,
      status: room.status,
      providerId: room.provider_id,
      playbackMode: room.playback_mode,
      createdAt: room.created_at,
      hostPlayerId: room.host_player_id || null,
      settings: {
        genres: JSON.parse(room.genres_json) as string[],
        languagePreference: room.language_preference,
        tracksPerTeam: room.tracks_per_team,
      },
      players: players.map((player) => mapPlayer(player, timelinesByPlayer.get(player.id) ?? [])),
      game: {
        status: game?.status ?? "lobby",
        phase: game?.phase ?? "idle",
        currentRound: game?.current_round ?? 0,
        currentTurnPlayerId: game?.current_turn_player_id ?? null,
        currentTurnPlayerName:
          players.find((player) => player.id === game?.current_turn_player_id)?.name ?? null,
        currentTurnTeam:
          players.find((player) => player.id === game?.current_turn_player_id)?.team ?? null,
        totalRounds: totalCount.total,
        remainingTrackCount: remainingCount.remaining,
        seededTrackCount: totalCount.total,
        currentTrack:
          activeTrackRow && game?.phase !== "idle"
            ? hideTrack(mapTrack(activeTrackRow))
            : null,
        revealedTrack: activeTrackRow && game?.phase === "revealed" ? mapTrack(activeTrackRow) : null,
        placements,
        bonusGuesses,
        reveal,
      },
    };
  }

  private assignStarterTracks(roomId: string) {
    const players = this.db
      .prepare("SELECT id, team FROM players WHERE room_id = ? ORDER BY joined_at ASC")
      .all(roomId) as Array<{ id: string; team: TeamColor }>;

    const tx = this.db.transaction(() => {
      players.forEach((player) => {
        const track = this.db
          .prepare(
            `
              SELECT *
              FROM room_tracks
              WHERE room_id = ? AND used_in_round = 0 AND team = ?
              ORDER BY RANDOM()
              LIMIT 1
            `,
          )
          .get(roomId, player.team) as RoomTrackRow | undefined;

        if (!track) {
          return;
        }

        this.db.prepare("UPDATE room_tracks SET used_in_round = 1 WHERE id = ?").run(track.id);
        this.db
          .prepare(
            `
              INSERT INTO timeline_entries (id, room_id, player_id, track_library_id, position_index, created_at)
              VALUES (?, ?, ?, ?, 0, ?)
            `,
          )
          .run(crypto.randomUUID(), roomId, player.id, track.id, new Date().toISOString());
      });
    });

    tx();
  }

  private getGameRow(roomId: string): GameRow | undefined {
    return this.db
      .prepare(
        "SELECT status, phase, current_round, current_turn_player_id, current_track_library_id FROM games WHERE room_id = ?",
      )
      .get(roomId) as GameRow | undefined;
  }

  private getTurnPlayerId(roomId: string, roundNumber: number): string | null {
    const players = this.db
      .prepare("SELECT id FROM players WHERE room_id = ? ORDER BY joined_at ASC")
      .all(roomId) as Array<{ id: string }>;

    if (players.length === 0) {
      return null;
    }

    return players[(roundNumber - 1) % players.length].id;
  }

  private getTeamForPlayer(roomId: string, playerId: string | null): TeamColor | null {
    if (!playerId) {
      return null;
    }

    const player = this.db
      .prepare("SELECT team FROM players WHERE room_id = ? AND id = ?")
      .get(roomId, playerId) as { team: TeamColor } | undefined;

    return player?.team ?? null;
  }

  private getPlacementRows(roomId: string, roundNumber: number): PlacementRow[] {
    return this.db
      .prepare(
        `
          SELECT
            round_placements.player_id,
            round_placements.insert_index,
            round_placements.submitted_at,
            players.name AS player_name
          FROM round_placements
          JOIN players ON players.id = round_placements.player_id
          WHERE round_placements.room_id = ? AND round_placements.round_number = ?
          ORDER BY round_placements.submitted_at ASC
        `,
      )
      .all(roomId, roundNumber) as PlacementRow[];
  }

  private getBonusGuessRows(roomId: string, roundNumber: number): BonusGuessRow[] {
    return this.db
      .prepare(
        `
          SELECT
            round_bonus_guesses.player_id,
            round_bonus_guesses.title_guess,
            round_bonus_guesses.artist_guess,
            round_bonus_guesses.submitted_at,
            players.name AS player_name
          FROM round_bonus_guesses
          JOIN players ON players.id = round_bonus_guesses.player_id
          WHERE round_bonus_guesses.room_id = ? AND round_bonus_guesses.round_number = ?
          ORDER BY round_bonus_guesses.submitted_at ASC
        `,
      )
      .all(roomId, roundNumber) as BonusGuessRow[];
  }

  private getTimelineEntries(roomId: string, playerId: string): TimelineEntry[] {
    const rows = this.db
      .prepare(
        `
          SELECT
            timeline_entries.id AS entry_id,
            timeline_entries.player_id,
            timeline_entries.position_index,
            room_tracks.*
          FROM timeline_entries
          JOIN room_tracks ON room_tracks.id = timeline_entries.track_library_id
          WHERE timeline_entries.room_id = ? AND timeline_entries.player_id = ?
          ORDER BY timeline_entries.position_index ASC
        `,
      )
      .all(roomId, playerId) as TimelineEntryRow[];

    return rows.map(mapTimelineEntry);
  }

  private getAllTimelines(roomId: string): Map<string, TimelineEntry[]> {
    const rows = this.db
      .prepare(
        `
          SELECT
            timeline_entries.id AS entry_id,
            timeline_entries.player_id,
            timeline_entries.position_index,
            room_tracks.*
          FROM timeline_entries
          JOIN room_tracks ON room_tracks.id = timeline_entries.track_library_id
          WHERE timeline_entries.room_id = ?
          ORDER BY timeline_entries.player_id ASC, timeline_entries.position_index ASC
        `,
      )
      .all(roomId) as TimelineEntryRow[];

    const map = new Map<string, TimelineEntry[]>();

    for (const row of rows) {
      const entries = map.get(row.player_id) ?? [];
      entries.push(mapTimelineEntry(row));
      map.set(row.player_id, entries);
    }

    return map;
  }
}

function createUniqueRoomCode(db: Database.Database): string {
  for (;;) {
    const code = createRoomCode();
    const existing = db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code) as object | undefined;
    if (!existing) {
      return code;
    }
  }
}

function hideTrack(track: NormalizedTrack): HiddenTrack {
  const { releaseYear: _releaseYear, ...rest } = track;
  return rest;
}

function mapTrack(row: RoomTrackRow): NormalizedTrack {
  return {
    id: `${row.provider}:${row.provider_track_id}`,
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artists: JSON.parse(row.artists_json) as string[],
    album: row.album ?? undefined,
    releaseYear: row.release_year ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    artworkUrl: row.artwork_url ?? undefined,
    previewUrl: row.preview_url ?? null,
    externalUrl: row.external_url ?? null,
  };
}

function mapTimelineEntry(row: TimelineEntryRow): TimelineEntry {
  return {
    id: row.entry_id,
    position: row.position_index,
    track: mapTrack(row),
  };
}

function mapPlacement(row: PlacementRow): PlacementGuess {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    insertIndex: row.insert_index,
    submittedAt: row.submitted_at,
  };
}

function mapBonusGuess(row: BonusGuessRow): BonusGuess {
  return {
    playerId: row.player_id,
    playerName: row.player_name,
    titleGuess: row.title_guess,
    artistGuess: row.artist_guess,
    submittedAt: row.submitted_at,
  };
}

function buildReveal(
  activeTrack: RoomTrackRow,
  placements: PlacementGuess[],
  bonusGuesses: BonusGuess[],
  players: PlayerRow[],
  timelinesByPlayer: Map<string, TimelineEntry[]>,
): RevealResult {
  const actualYear = activeTrack.release_year ?? 0;
  const outcomes: PlacementOutcome[] = players.map((player) => {
    const placement = placements.find((candidate) => candidate.playerId === player.id) ?? null;
    const bonusGuess = bonusGuesses.find((candidate) => candidate.playerId === player.id) ?? null;
    const timeline = timelinesByPlayer.get(player.id) ?? [];
    const correct = placement
      ? validatePlacement(timeline, placement.insertIndex, actualYear)
      : false;
    const bonusCorrect = bonusGuess ? validateBonusGuess(activeTrack, {
      player_id: bonusGuess.playerId,
      player_name: bonusGuess.playerName,
      title_guess: bonusGuess.titleGuess,
      artist_guess: bonusGuess.artistGuess,
      submitted_at: bonusGuess.submittedAt,
    }) : false;

    return {
      playerId: player.id,
      playerName: player.name,
      insertIndex: placement?.insertIndex ?? -1,
      correct,
      bonusAttempted: Boolean(bonusGuess),
      bonusCorrect: correct && bonusCorrect,
      awardedPoints: correct ? (bonusCorrect ? 2 : 1) : 0,
    };
  });

  return {
    actualYear,
    outcomes,
  };
}

function validatePlacement(timeline: TimelineEntry[], insertIndex: number, actualYear: number): boolean {
  if (insertIndex < 0 || insertIndex > timeline.length) {
    return false;
  }

  const previousYear = insertIndex === 0 ? Number.NEGATIVE_INFINITY : timeline[insertIndex - 1].track.releaseYear!;
  const nextYear = insertIndex === timeline.length ? Number.POSITIVE_INFINITY : timeline[insertIndex].track.releaseYear!;

  return actualYear >= previousYear && actualYear <= nextYear;
}

function validateBonusGuess(track: RoomTrackRow, guess: BonusGuessRow): boolean {
  const normalizedTitle = normalizeGuessText(track.title);
  const normalizedArtists = JSON.parse(track.artists_json) as string[];
  const normalizedArtistHaystack = normalizeGuessText(normalizedArtists.join(" "));

  const titleOk =
    normalizeGuessText(guess.title_guess).length > 0 &&
    fuzzyContains(normalizedTitle, normalizeGuessText(guess.title_guess));
  const artistOk =
    normalizeGuessText(guess.artist_guess).length > 0 &&
    fuzzyContains(normalizedArtistHaystack, normalizeGuessText(guess.artist_guess));

  return titleOk && artistOk;
}

function normalizeGuessText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyContains(haystack: string, needle: string): boolean {
  return haystack.includes(needle) || needle.includes(haystack);
}

function shiftTimelineEntries(db: Database.Database, playerId: string, fromIndex: number) {
  db.prepare(
    `
      UPDATE timeline_entries
      SET position_index = position_index + 1
      WHERE player_id = ? AND position_index >= ?
    `,
  ).run(playerId, fromIndex);
}

function mapPlayer(row: PlayerRow, timeline: TimelineEntry[]): PlayerState {
  return {
    id: row.id,
    name: row.name,
    isHost: Boolean(row.is_host),
    joinedAt: row.joined_at,
    age: row.age,
    team: row.team,
    score: row.score,
    timeline,
  };
}
