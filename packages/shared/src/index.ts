export type RoomStatus = "lobby" | "in_progress" | "finished";
export type GameStatus = "lobby" | "ready" | "in_progress" | "finished";
export type PlaybackMode =
  | "preview"
  | "remote_sdk"
  | "embed"
  | "external_manual";

export type ProviderCapabilities = {
  authRequired: boolean;
  search: boolean;
  previewPlayback: boolean;
  remotePlayback: boolean;
  embeddedPlayback: boolean;
  manualPlayback: boolean;
};

export type ProviderDescriptor = {
  id: string;
  name: string;
  capabilities: ProviderCapabilities;
};

export type TeamColor = "red" | "blue";

export type RoomSettings = {
  genres: string[];
  languagePreference: "mixed" | "spanish" | "english";
  tracksPerTeam: number;
};

export type NormalizedTrack = {
  id: string;
  provider: string;
  providerTrackId: string;
  title: string;
  artists: string[];
  album?: string;
  releaseYear?: number;
  durationMs?: number;
  artworkUrl?: string;
  previewUrl?: string | null;
  externalUrl?: string | null;
};

export type HiddenTrack = Omit<NormalizedTrack, "releaseYear"> & {
  releaseYear?: undefined;
};

export type TimelineEntry = {
  id: string;
  position: number;
  track: NormalizedTrack;
};

export type PlayerState = {
  id: string;
  name: string;
  isHost: boolean;
  joinedAt: string;
  age: number;
  team: TeamColor;
  score: number;
  timeline: TimelineEntry[];
};

export type RoundPhase = "idle" | "guessing" | "revealed";

export type PlacementGuess = {
  playerId: string;
  playerName: string;
  insertIndex: number;
  submittedAt: string;
};

export type PlacementOutcome = {
  playerId: string;
  playerName: string;
  insertIndex: number;
  correct: boolean;
  bonusAttempted: boolean;
  bonusCorrect: boolean;
  awardedPoints: number;
};

export type BonusGuess = {
  playerId: string;
  playerName: string;
  titleGuess: string;
  artistGuess: string;
  submittedAt: string;
};

export type RevealResult = {
  actualYear: number;
  outcomes: PlacementOutcome[];
};

export type GameState = {
  status: GameStatus;
  phase: RoundPhase;
  currentRound: number;
  currentTurnPlayerId: string | null;
  currentTurnPlayerName: string | null;
  currentTurnTeam: TeamColor | null;
  totalRounds: number;
  remainingTrackCount: number;
  seededTrackCount: number;
  currentTrack: HiddenTrack | null;
  revealedTrack: NormalizedTrack | null;
  placements: PlacementGuess[];
  bonusGuesses: BonusGuess[];
  reveal: RevealResult | null;
};

export type RoomSnapshot = {
  id: string;
  code: string;
  status: RoomStatus;
  providerId: string;
  playbackMode: string;
  createdAt: string;
  hostPlayerId: string | null;
  settings: RoomSettings;
  players: PlayerState[];
  game: GameState;
};

export type CreateRoomInput = {
  providerId: string;
  genres: string[];
  languagePreference: "mixed" | "spanish" | "english";
  tracksPerTeam?: number;
  playbackMode?: string;
};

export type JoinRoomInput = {
  code: string;
  name: string;
  age: number;
  team: TeamColor;
};

export type SubmitPlacementInput = {
  playerId: string;
  insertIndex: number;
};

export type SubmitBonusGuessInput = {
  playerId: string;
  titleGuess: string;
  artistGuess: string;
};

export type AuthoredRoomResponse = {
  room: RoomSnapshot;
  playerId: string;
};

export type PlayableSource =
  | { type: "preview_url"; url: string }
  | { type: "embed"; embedUrl: string }
  | { type: "remote_sdk"; trackId: string }
  | { type: "external_only" };
