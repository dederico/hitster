import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import fs from "node:fs";
import type { MusicProvider } from "@hitster/provider-sdk";
import { listProviders, resolveProvider } from "@hitster/provider-sdk";
import type {
  AuthoredRoomResponse,
  CreateRoomInput,
  JoinRoomInput,
  NormalizedTrack,
  RoomSettings,
  SubmitBonusGuessInput,
  SubmitPlacementInput,
  TeamColor,
} from "@hitster/shared";
import { z } from "zod";
import { config } from "./config.js";
import { createDatabase } from "./db.js";
import { RoomStore } from "./room-store.js";

const app = Fastify({ logger: true });
const db = createDatabase(config.databasePath);
const roomStore = new RoomStore(db);

app.register(import("@fastify/cors"), {
  origin: config.corsOrigin,
  credentials: true,
});

if (config.isProduction && fs.existsSync(config.webDistPath)) {
  app.register(fastifyStatic, {
    root: config.webDistPath,
    prefix: "/",
  });
}

app.get("/health", async () => ({
  ok: true,
  app: config.appName,
}));

app.get("/providers", async () => ({
  providers: listProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    capabilities: provider.capabilities,
  })),
}));

app.post("/rooms", async (request, reply) => {
  const payload = createRoomSchema.parse(request.body) as CreateRoomInput;
  const provider = resolveProvider(payload.providerId);

  if (!provider) {
    return reply.code(400).send({ message: "Unknown provider" });
  }

  const created = roomStore.createRoom({
    ...payload,
    playbackMode: payload.playbackMode ?? provider.getDefaultPlaybackMode(),
  });

  return reply.code(201).send({ room: created });
});

app.post("/rooms/join", async (request, reply) => {
  const payload = joinRoomSchema.parse(request.body) as JoinRoomInput;
  const joined = roomStore.joinRoom(payload.code, payload.name, payload.age, payload.team);

  if (!joined) {
    return reply.code(404).send({ message: "Room not found" });
  }

  io.to(joined.room.code).emit("room:state", joined.room);
  return joined satisfies AuthoredRoomResponse;
});

app.get("/rooms/:code", async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = roomStore.getRoomByCode(code.toUpperCase());

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  return { room };
});

app.post("/rooms/:code/game/start", async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = roomStore.getRoomByCode(code.toUpperCase());

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  const provider = resolveProvider(room.providerId);
  if (!provider) {
    return reply.code(400).send({ message: "Unknown provider" });
  }

  if (!provider.capabilities.search) {
    return reply.code(400).send({ message: "Selected provider cannot build a random catalog" });
  }

  const tracks = await buildRandomCatalog(provider, room.settings, room.players);
  if (tracks.length < room.settings.tracksPerTeam * 2) {
    return reply.code(502).send({ message: "Could not build a large enough random catalog" });
  }

  const seededRoom = roomStore.replaceRoomTracks(code.toUpperCase(), tracks);
  const startedRoom = roomStore.startNextRound(code.toUpperCase());

  if (!seededRoom || !startedRoom) {
    return reply.code(500).send({ message: "Failed to start the game" });
  }

  io.to(startedRoom.code).emit("room:state", startedRoom);
  return { room: startedRoom };
});

app.post("/rooms/:code/rounds/place", async (request, reply) => {
  const { code } = request.params as { code: string };
  const payload = submitPlacementSchema.parse(request.body) as SubmitPlacementInput;
  const room = roomStore.submitPlacement(code.toUpperCase(), payload);

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  io.to(room.code).emit("room:state", room);
  return { room };
});

app.post("/rooms/:code/rounds/bonus", async (request, reply) => {
  const { code } = request.params as { code: string };
  const payload = submitBonusGuessSchema.parse(request.body) as SubmitBonusGuessInput;
  const room = roomStore.submitBonusGuess(code.toUpperCase(), payload);

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  io.to(room.code).emit("room:state", room);
  return { room };
});

app.post("/rooms/:code/rounds/play", async (request, reply) => {
  const { code } = request.params as { code: string };
  const payload = triggerPlaySchema.parse(request.body) as { playerId: string };
  const room = roomStore.getRoomByCode(code.toUpperCase());

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  if (room.game.currentTurnPlayerId !== payload.playerId) {
    return reply.code(403).send({ message: "Only the active player can start playback" });
  }

  const countdownStartAt = Date.now() + 300;
  const playAt = countdownStartAt + 3000;

  io.to(room.code).emit("round:countdown", {
    round: room.game.currentRound,
    countdownStartAt,
    playAt,
  });

  return {
    ok: true,
    countdownStartAt,
    playAt,
  };
});

app.post("/rooms/:code/rounds/reveal", async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = roomStore.revealCurrentRound(code.toUpperCase());

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  io.to(room.code).emit("room:state", room);
  return { room };
});

app.post("/rooms/:code/rounds/next", async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = roomStore.startNextRound(code.toUpperCase());

  if (!room) {
    return reply.code(400).send({ message: "No remaining random tracks available" });
  }

  io.to(room.code).emit("room:state", room);
  return { room };
});

app.post("/rooms/:code/game/reset", async (request, reply) => {
  const { code } = request.params as { code: string };
  const room = roomStore.resetGame(code.toUpperCase());

  if (!room) {
    return reply.code(404).send({ message: "Room not found" });
  }

  io.to(room.code).emit("room:state", room);
  return { room };
});

app.get("/rooms/:code/current-track/source", async (request, reply) => {
  const { code } = request.params as { code: string };
  const track = roomStore.getCurrentTrack(code.toUpperCase());

  if (!track) {
    return reply.code(404).send({ message: "No active track" });
  }

  const provider = resolveProvider(track.provider);
  if (!provider) {
    return { source: { type: "external_only" as const }, track };
  }

  const source = await provider.getPlayableSource(track);
  return {
    source: source ?? { type: "external_only" as const },
    track,
  };
});

if (config.isProduction && fs.existsSync(config.webDistPath)) {
  app.get("/", async (_request, reply) => reply.sendFile("index.html"));
}

const server = await app.listen({
  port: config.port,
  host: "0.0.0.0",
});

const io = new Server(app.server, {
  cors: {
    origin: config.corsOrigin,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  socket.on("room:subscribe", (code: string) => {
    socket.join(code.toUpperCase());
  });
});

app.log.info(`API listening on ${server}`);

const createRoomSchema = z.object({
  providerId: z.string().trim().min(1),
  genres: z.array(z.string().trim().min(1)).min(1),
  languagePreference: z.enum(["mixed", "spanish", "english"]),
  tracksPerTeam: z.number().int().min(5).max(20).optional(),
  playbackMode: z.string().trim().min(1).optional(),
});

const joinRoomSchema = z.object({
  code: z.string().trim().length(6).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(32),
  age: z.number().int().min(8).max(100),
  team: z.enum(["red", "blue"]),
});

const submitPlacementSchema = z.object({
  playerId: z.string().trim().min(1),
  insertIndex: z.number().int().min(0).max(99),
});

const submitBonusGuessSchema = z.object({
  playerId: z.string().trim().min(1),
  titleGuess: z.string().trim().min(1).max(120),
  artistGuess: z.string().trim().min(1).max(120),
});

const triggerPlaySchema = z.object({
  playerId: z.string().trim().min(1),
});

const randomSeedTerms = [
  "greatest hits 70s",
  "iconic 80s pop hits",
  "best 90s hits",
  "2000s biggest songs",
  "2010s biggest hits",
  "2020s biggest hits",
  "classic rock greatest hits",
  "oldies but goodies",
  "motown classics",
  "disco greatest hits",
  "famous r&b hits",
  "hip hop greatest hits",
  "viral pop hits",
  "latin pop greatest hits",
  "reggaeton greatest hits",
  "reggaeton 2024 hits",
  "corridos tumbados hits",
  "corridos tumbados 2024",
  "musica mexicana hits",
  "regional mexicano hits",
  "banda sinaloense hits",
  "norteño hits",
  "bachata hits",
  "salsa classics",
  "romanticas en español hits",
  "pop en español greatest hits",
  "rock en español classics",
  "trap latino hits",
  "urbano latino hits",
  "mexican pop hits",
  "billboard number one hits",
  "top 40 english hits",
  "famous soundtrack songs",
  "party anthems hits",
];

async function buildRandomCatalog(
  provider: MusicProvider,
  settings: RoomSettings,
  players: Array<{ age: number; team: TeamColor }>,
): Promise<Array<{ track: NormalizedTrack; team: TeamColor }>> {
  const averageAge = players.length > 0 ? players.reduce((sum, player) => sum + player.age, 0) / players.length : 25;
  const yearWindow = getYearWindowForAverageAge(averageAge);
  const shuffledTerms = buildSeedTerms(settings, yearWindow).sort(() => Math.random() - 0.5);
  const deduped = new Map<string, NormalizedTrack>();
  const targetCount = settings.tracksPerTeam * 2;

  for (const term of shuffledTerms) {
    const results = await provider.searchTracks(term);
    const rankedResults = [...results].sort((left, right) => scoreTrack(right) - scoreTrack(left));

    for (const track of rankedResults) {
      if (!track.releaseYear) {
        continue;
      }

      if (provider.capabilities.previewPlayback && !track.previewUrl) {
        continue;
      }

      const key = `${track.provider}:${track.providerTrackId}`;
      if (!deduped.has(key)) {
        deduped.set(key, track);
      }

      if (deduped.size >= targetCount) {
        return assignTracksToTeams(pickDiverseRandomTracks(deduped, targetCount), settings.tracksPerTeam);
      }
    }
  }

  return assignTracksToTeams(pickDiverseRandomTracks(deduped, targetCount), settings.tracksPerTeam);
}

function pickDiverseRandomTracks(
  deduped: Map<string, NormalizedTrack>,
  desiredCount: number,
): NormalizedTrack[] {
  const rankedPool = Array.from(deduped.values()).sort((left, right) => scoreTrack(right) - scoreTrack(left));
  const selected: NormalizedTrack[] = [];
  const seenArtists = new Set<string>();

  for (const track of rankedPool) {
    const artistKey = track.artists.join("|").toLowerCase();
    if (seenArtists.has(artistKey) && rankedPool.length > desiredCount) {
      continue;
    }

    selected.push(track);
    seenArtists.add(artistKey);

    if (selected.length >= desiredCount) {
      break;
    }
  }

  if (selected.length < Math.min(desiredCount, rankedPool.length)) {
    for (const track of rankedPool) {
      if (selected.some((selectedTrack) => selectedTrack.id === track.id)) {
        continue;
      }

      selected.push(track);
      if (selected.length >= desiredCount) {
        break;
      }
    }
  }

  return selected.sort(() => Math.random() - 0.5);
}

function scoreTrack(track: NormalizedTrack): number {
  const haystack = `${track.title} ${track.artists.join(" ")} ${track.album ?? ""}`.toLowerCase();
  let score = 0;

  if (track.previewUrl) {
    score += 12;
  }

  if (track.artworkUrl) {
    score += 4;
  }

  if (track.releaseYear) {
    score += 3;
  }

  const preferredPatterns = [
    "greatest hits",
    "essentials",
    "number 1",
    "billboard",
    "top 40",
    "deluxe",
    "hits",
    "version original",
    "original",
  ];

  for (const pattern of preferredPatterns) {
    if (haystack.includes(pattern)) {
      score += 2;
    }
  }

  const penalizedPatterns = [
    "karaoke",
    "tribute",
    "instrumental",
    "cover",
    "remix",
    "mix",
    "session",
    "live",
    "edit",
    "radio edit",
    "sped up",
    "slowed",
    "8d",
    "rehearsal",
  ];

  for (const pattern of penalizedPatterns) {
    if (haystack.includes(pattern)) {
      score -= 8;
    }
  }

  return score;
}

function buildSeedTerms(settings: RoomSettings, yearWindow: { from: number; to: number }): string[] {
  const genreTerms = settings.genres.length > 0 ? settings.genres : ["hits"];
  const languageTerms =
    settings.languagePreference === "mixed"
      ? ["english", "español", "latin"]
      : settings.languagePreference === "spanish"
        ? ["español", "latino", "mexicano"]
        : ["english", "american", "british"];

  const eraTerms = [
    `${yearWindow.from}s hits`,
    `${Math.floor(yearWindow.from / 10) * 10}s greatest hits`,
    `${Math.floor(yearWindow.to / 10) * 10}s biggest songs`,
    `${yearWindow.from} ${yearWindow.to} hit songs`,
  ];

  const terms = new Set<string>();

  for (const genre of genreTerms) {
    terms.add(`${genre} hits`);
    terms.add(`${genre} greatest hits`);

    for (const language of languageTerms) {
      terms.add(`${genre} ${language} hits`);
      for (const era of eraTerms) {
        terms.add(`${genre} ${language} ${era}`);
      }
    }
  }

  return [...terms];
}

function getYearWindowForAverageAge(averageAge: number): { from: number; to: number } {
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - averageAge;
  return {
    from: Math.max(1965, Math.floor(birthYear - 8)),
    to: Math.min(currentYear, Math.ceil(birthYear + 18)),
  };
}

function assignTracksToTeams(
  tracks: NormalizedTrack[],
  tracksPerTeam: number,
): Array<{ track: NormalizedTrack; team: TeamColor }> {
  const assigned: Array<{ track: NormalizedTrack; team: TeamColor }> = [];
  const red = tracks.slice(0, tracksPerTeam);
  const blue = tracks.slice(tracksPerTeam, tracksPerTeam * 2);

  for (const track of red) {
    assigned.push({ track, team: "red" });
  }

  for (const track of blue) {
    assigned.push({ track, team: "blue" });
  }

  return assigned;
}
