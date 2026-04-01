import type { GameState } from "@hitster/shared";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomCode(length = 6): string {
  return Array.from({ length }, () => {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[index];
  }).join("");
}

export function createInitialGameState(): GameState {
  return {
    status: "lobby",
    phase: "idle",
    currentRound: 0,
    currentTurnPlayerId: null,
    currentTurnPlayerName: null,
    currentTurnTeam: null,
    totalRounds: 10,
    remainingTrackCount: 0,
    seededTrackCount: 0,
    currentTrack: null,
    revealedTrack: null,
    placements: [],
    bonusGuesses: [],
    reveal: null,
  };
}
