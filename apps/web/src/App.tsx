import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import type {
  AuthoredRoomResponse,
  BonusGuess,
  PlacementGuess,
  PlayableSource,
  ProviderDescriptor,
  RoomSnapshot,
  TimelineEntry,
} from "@hitster/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const socket = io(API_BASE_URL || undefined, {
  autoConnect: false,
  path: "/socket.io",
});

type ActiveSourceResponse = {
  source: PlayableSource;
};

export function App() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<PlayableSource | null>(null);
  const [joinName, setJoinName] = useState("Player");
  const [joinAge, setJoinAge] = useState("25");
  const [joinTeam, setJoinTeam] = useState<"red" | "blue">("blue");
  const [joinCode, setJoinCode] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("itunes_preview");
  const [selectedGenres, setSelectedGenres] = useState<string[]>(["pop", "rock", "reggaeton"]);
  const [languagePreference, setLanguagePreference] = useState<"mixed" | "spanish" | "english">("mixed");
  const [tracksPerTeam, setTracksPerTeam] = useState("10");
  const [bonusTitleGuess, setBonusTitleGuess] = useState("");
  const [bonusArtistGuess, setBonusArtistGuess] = useState("");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [embedPlayToken, setEmbedPlayToken] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void fetchJson<{ providers: ProviderDescriptor[] }>("/providers")
      .then((payload) => {
        setProviders(payload.providers);
        const preferred = payload.providers.find((provider) => provider.id === "itunes_preview");
        setSelectedProvider(preferred?.id ?? payload.providers[0]?.id ?? "itunes_preview");
      })
      .catch((fetchError) => {
        setError(getErrorMessage(fetchError));
      });
  }, []);

  useEffect(() => {
    socket.connect();
    socket.on("room:state", (nextRoom: RoomSnapshot) => {
      setRoom(nextRoom);
    });
    socket.on("round:countdown", (payload: { countdownStartAt: number; playAt: number }) => {
      startSynchronizedCountdown(payload.countdownStartAt, payload.playAt);
    });

    return () => {
      socket.off("room:state");
      socket.off("round:countdown");
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!room?.game.currentTrack) {
      setActiveSource(null);
      return;
    }

    void fetchJson<ActiveSourceResponse>(`/rooms/${room.code}/current-track/source`)
      .then((payload) => {
        setActiveSource(payload.source);
      })
      .catch(() => {
        setActiveSource({ type: "external_only" });
      });
  }, [room?.code, room?.game.currentRound]);

  async function createRoom() {
    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>("/rooms", {
        method: "POST",
        body: JSON.stringify({
          providerId: selectedProvider,
          genres: selectedGenres,
          languagePreference,
          tracksPerTeam: Number(tracksPerTeam),
        }),
      });

      setRoom(payload.room);
      setPlayerId(null);
      setJoinCode(payload.room.code);
      socket.emit("room:subscribe", payload.room.code);
      setMessage(`Room ${payload.room.code} created.`);
    });
  }

  async function joinRoom() {
    await runMutation(async () => {
      const payload = await fetchJson<AuthoredRoomResponse>("/rooms/join", {
        method: "POST",
        body: JSON.stringify({
          code: joinCode,
          name: joinName,
          age: Number(joinAge),
          team: joinTeam,
        }),
      });

      hydrateAuthoredRoom(payload);
      setMessage(`Joined room ${payload.room.code}.`);
    });
  }

  async function startGame() {
    if (!room) {
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/game/start`, {
        method: "POST",
      });

      setRoom(payload.room);
      setMessage("Random game started. Everyone got a starter track and the first song is live.");
    });
  }

  async function submitPlacement(insertIndex: number) {
    if (!room || !playerId) {
      setError("Join the room before placing tracks.");
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/rounds/place`, {
        method: "POST",
        body: JSON.stringify({
          playerId,
          insertIndex,
        }),
      });

      setRoom(payload.room);
      setMessage("Placement submitted.");
    });
  }

  async function revealRound() {
    if (!room) {
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/rounds/reveal`, {
        method: "POST",
      });

      setRoom(payload.room);
      setMessage("Round revealed.");
    });
  }

  async function triggerPlayback() {
    if (!room || !playerId) {
      return;
    }

    await runMutation(async () => {
      await fetchJson(`/rooms/${room.code}/rounds/play`, {
        method: "POST",
        body: JSON.stringify({
          playerId,
        }),
      });

      setMessage("Cuenta regresiva iniciada.");
    });
  }

  async function submitBonusGuess() {
    if (!room || !playerId) {
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/rounds/bonus`, {
        method: "POST",
        body: JSON.stringify({
          playerId,
          titleGuess: bonusTitleGuess,
          artistGuess: bonusArtistGuess,
        }),
      });

      setRoom(payload.room);
      setMessage("Apuesta doble registrada.");
    });
  }

  async function nextRound() {
    if (!room) {
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/rounds/next`, {
        method: "POST",
      });

      setRoom(payload.room);
      setMessage(`Round ${payload.room.game.currentRound} started.`);
    });
  }

  async function resetGame() {
    if (!room) {
      return;
    }

    await runMutation(async () => {
      const payload = await fetchJson<{ room: RoomSnapshot }>(`/rooms/${room.code}/game/reset`, {
        method: "POST",
      });

      setRoom(payload.room);
      setMessage("Game reset.");
    });
  }

  function hydrateAuthoredRoom(payload: AuthoredRoomResponse) {
    setRoom(payload.room);
    setPlayerId(payload.playerId);
    setJoinCode(payload.room.code);
    socket.emit("room:subscribe", payload.room.code);
  }

  function startSynchronizedCountdown(countdownStartAt: number, playAt: number) {
    const update = () => {
      const secondsLeft = Math.max(0, Math.ceil((playAt - Date.now()) / 1000));
      setCountdownValue(secondsLeft > 0 ? secondsLeft : null);
    };

    update();
    const intervalId = window.setInterval(update, 250);
    const playDelay = Math.max(0, playAt - Date.now());

    window.setTimeout(() => {
      window.clearInterval(intervalId);
      setCountdownValue(null);
      void audioRef.current?.play().catch(() => undefined);
      setEmbedPlayToken((value) => value + 1);
    }, playDelay);

    window.setTimeout(() => {
      update();
    }, Math.max(0, countdownStartAt - Date.now()));
  }

  async function runMutation(task: () => Promise<void>) {
    setIsMutating(true);
    setMessage(null);
    setError(null);

    try {
      await task();
    } catch (fetchError) {
      setError(getErrorMessage(fetchError));
    } finally {
      setIsMutating(false);
    }
  }

  const selectedProviderMeta = providers.find((provider) => provider.id === selectedProvider);
  const me = room?.players.find((player) => player.id === playerId) ?? null;
  const myPlacement = room?.game.placements.find((placement) => placement.playerId === playerId) ?? null;
  const myBonusGuess = room?.game.bonusGuesses.find((guess) => guess.playerId === playerId) ?? null;
  const isMyTurn = Boolean(playerId && room?.game.currentTurnPlayerId === playerId);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Hitster-Personalizado</p>
        <h1>Pon a prueba tu memoria musical.</h1>
        <p className="lede">Arma equipos, escucha el hit y colócalo en tu línea del tiempo antes que el otro lado.</p>
        <div className="hero-chips">
          <span>Rojo vs Azul</span>
          <span>Por turnos</span>
          <span>Hecho para celular</span>
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <h2>Create room</h2>
          <label>
            Random source
            <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <p className="helper-copy">
            {selectedProviderMeta?.capabilities.search
              ? "This source can auto-build random rounds."
              : "This source cannot generate a random catalog."}
          </p>
          <label>
            Géneros
            <select
              multiple
              value={selectedGenres}
              onChange={(event) =>
                setSelectedGenres(Array.from(event.target.selectedOptions, (option) => option.value))
              }
            >
              {["pop", "rock", "reggaeton", "corridos tumbados", "regional mexicano", "hip hop", "oldies"].map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Idioma
            <select
              value={languagePreference}
              onChange={(event) => setLanguagePreference(event.target.value as "mixed" | "spanish" | "english")}
            >
              <option value="mixed">Mixto</option>
              <option value="spanish">Español</option>
              <option value="english">Inglés</option>
            </select>
          </label>
          <label>
            Canciones por equipo
            <input value={tracksPerTeam} onChange={(event) => setTracksPerTeam(event.target.value)} />
          </label>
          <button onClick={createRoom} disabled={isMutating}>
            Create
          </button>
        </article>

        <article className="panel">
          <h2>Join room</h2>
          <label>
            Room code
            <input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} />
          </label>
          <label>
            Player name
            <input value={joinName} onChange={(event) => setJoinName(event.target.value)} />
          </label>
          <label>
            Edad
            <input value={joinAge} onChange={(event) => setJoinAge(event.target.value)} />
          </label>
          <label>
            Equipo
            <select value={joinTeam} onChange={(event) => setJoinTeam(event.target.value as "red" | "blue")}>
              <option value="blue">Azul</option>
              <option value="red">Rojo</option>
            </select>
          </label>
          <button onClick={joinRoom} disabled={isMutating}>
            Join
          </button>
        </article>
      </section>

      {message ? <p className="status-message">{message}</p> : null}
      {error ? <p className="status-message error-message">{error}</p> : null}

      <section className="grid">
        <article className="panel room-panel">
          <h2>Room</h2>
          {room ? (
            <>
              <p>
                Code <strong>{room.code}</strong> · Status <strong>{room.status}</strong> · Round{" "}
                <strong>{room.game.currentRound}</strong> / {room.game.totalRounds}
              </p>
              <p>
                Remaining songs <strong>{room.game.remainingTrackCount}</strong> · You are{" "}
                <strong>{me?.name ?? "spectating"}</strong>
              </p>
              <p>
                Géneros <strong>{room.settings.genres.join(", ")}</strong> · Idioma <strong>{room.settings.languagePreference}</strong>
              </p>
              <p>
                Turno actual <strong>{room.game.currentTurnPlayerName ?? "sin asignar"}</strong> · Equipo{" "}
                <strong>{room.game.currentTurnTeam ?? "-"}</strong>
              </p>
              <div className="button-row">
                <button onClick={startGame} disabled={isMutating || !selectedProviderMeta?.capabilities.search}>
                  Start timeline game
                </button>
                <button onClick={resetGame} disabled={isMutating || room.game.seededTrackCount === 0}>
                  Reset
                </button>
              </div>
              <ul className="player-list">
                {room.players.map((player) => (
                  <li key={player.id}>
                    {player.name} · {player.team} · {player.age} años · {player.score} pts
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Create or join a room to begin.</p>
          )}
        </article>

        <article className="panel">
          <h2>Current random song</h2>
          {room?.game.currentTrack ? (
            <>
              <p>
                <strong>{room.game.currentTrack.title}</strong>
              </p>
              <p>{room.game.currentTrack.artists.join(", ")}</p>
              {activeSource?.type === "preview_url" ? (
                <audio ref={audioRef} controls src={activeSource.url} className="audio-player" />
              ) : activeSource?.type === "embed" ? (
                <iframe
                  key={`${room.game.currentRound}-${embedPlayToken}`}
                  className="video-frame"
                  src={buildEmbedSrc(activeSource.embedUrl, embedPlayToken > 0)}
                  title={room.game.currentTrack.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : room.game.currentTrack.externalUrl ? (
                <p>
                  <a href={room.game.currentTrack.externalUrl} target="_blank" rel="noreferrer">
                    Open external source
                  </a>
                </p>
              ) : (
                <p className="helper-copy">This random track has no in-app preview available.</p>
              )}
              {room.game.phase === "revealed" && room.game.revealedTrack ? (
                <p>
                  Actual year <strong>{room.game.revealedTrack.releaseYear}</strong>
                </p>
              ) : (
                <p className="helper-copy">Year hidden until reveal.</p>
              )}
              {countdownValue ? <p><strong>{countdownValue}</strong></p> : null}
              <button
                onClick={triggerPlayback}
                disabled={
                  isMutating ||
                  !isMyTurn ||
                  room.game.phase !== "guessing" ||
                  (activeSource?.type !== "preview_url" && activeSource?.type !== "embed")
                }
              >
                Play para todos
              </button>
            </>
          ) : (
            <p>No active random song yet. Start the game to get everyone a starter year and begin round one.</p>
          )}
        </article>
      </section>

      {me ? (
        <section className="grid">
          <article className="panel">
            <h2>Your timeline</h2>
            <p className="helper-copy">
              Tap where the current song belongs relative to your revealed starter and accumulated timeline.
            </p>
            <p className="helper-copy">
              {isMyTurn
                ? "Es tu turno: coloca la canción actual en tu línea del tiempo."
                : `No es tu turno. Está jugando ${room?.game.currentTurnPlayerName ?? "otro jugador"}.`}
            </p>
            <TimelinePlacement
              timeline={me.timeline}
              disabled={isMutating || room?.game.phase !== "guessing" || !room?.game.currentTrack || !isMyTurn}
              selectedPlacement={myPlacement}
              onPlace={submitPlacement}
            />
          </article>

          <article className="panel">
            <h2>Round board</h2>
            {room?.game.placements.length ? (
              <div className="track-library">
                {room.game.placements.map((placement) => (
                  <article className="track-card" key={`${placement.playerId}-${placement.submittedAt}`}>
                    <div>
                      <strong>{placement.playerName}</strong>
                      <p>{formatPlacementLabel(placement, room.players.find((player) => player.id === placement.playerId)?.timeline ?? [])}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>No placements submitted yet.</p>
            )}
            <div className="button-row">
              <button onClick={revealRound} disabled={isMutating || room?.game.phase !== "guessing"}>
                Reveal placement
              </button>
              <button
                onClick={nextRound}
                disabled={isMutating || room?.game.phase !== "revealed" || room.game.remainingTrackCount === 0}
              >
                Next random song
              </button>
            </div>
            {room?.game.reveal ? (
              <div className="reveal-card">
                <p>
                  Actual year <strong>{room.game.reveal.actualYear}</strong>
                </p>
                {room.game.reveal.outcomes.map((outcome) => (
                  <p key={outcome.playerId}>
                    {outcome.playerName}: <strong>{outcome.correct ? "correcto" : "incorrecto"}</strong> · {outcome.awardedPoints} pts
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {me ? (
        <section className="grid">
          <article className="panel">
            <h2>Doble o nada</h2>
            <p className="helper-copy">
              Si atinas canción y artista en tu turno, la colocación correcta vale doble.
            </p>
            <label>
              Canción
              <input value={bonusTitleGuess} onChange={(event) => setBonusTitleGuess(event.target.value)} />
            </label>
            <label>
              Artista
              <input value={bonusArtistGuess} onChange={(event) => setBonusArtistGuess(event.target.value)} />
            </label>
            <button
              onClick={submitBonusGuess}
              disabled={
                isMutating ||
                !isMyTurn ||
                room?.game.phase !== "guessing" ||
                !bonusTitleGuess.trim() ||
                !bonusArtistGuess.trim()
              }
            >
              Activar doble
            </button>
            {myBonusGuess ? <p className="helper-copy">Apuesta enviada: {myBonusGuess.titleGuess} / {myBonusGuess.artistGuess}</p> : null}
          </article>
        </section>
      ) : null}

      {room?.players.length ? (
        <section className="grid">
          {room.players.map((player) => (
            <article className="panel" key={player.id}>
              <h2>{player.name}</h2>
              <TimelineDisplay timeline={player.timeline} />
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}

function TimelinePlacement({
  timeline,
  disabled,
  selectedPlacement,
  onPlace,
}: {
  timeline: TimelineEntry[];
  disabled: boolean;
  selectedPlacement: PlacementGuess | null;
  onPlace: (insertIndex: number) => void;
}) {
  const slots = Array.from({ length: timeline.length + 1 }, (_, index) => index);

  return (
    <div className="timeline-stack">
      {slots.map((slotIndex) => (
        <div className="timeline-slot" key={slotIndex}>
          <button
            className="slot-button"
            disabled={disabled}
            onClick={() => onPlace(slotIndex)}
          >
            {selectedPlacement?.insertIndex === slotIndex ? "Placed here" : slotLabel(timeline, slotIndex)}
          </button>
          {slotIndex < timeline.length ? (
            <article className="track-card timeline-card">
              <div>
                <strong>{timeline[slotIndex].track.releaseYear}</strong>
                <p>{timeline[slotIndex].track.title}</p>
                <p>{timeline[slotIndex].track.artists.join(", ")}</p>
              </div>
            </article>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TimelineDisplay({ timeline }: { timeline: TimelineEntry[] }) {
  if (timeline.length === 0) {
    return <p>No timeline yet.</p>;
  }

  return (
    <div className="track-library">
      {timeline.map((entry) => (
        <article className="track-card timeline-card" key={entry.id}>
          <div>
            <strong>{entry.track.releaseYear}</strong>
            <p>{entry.track.title}</p>
            <p>{entry.track.artists.join(", ")}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function slotLabel(timeline: TimelineEntry[], slotIndex: number): string {
  if (timeline.length === 0) {
    return "Place here";
  }

  if (slotIndex === 0) {
    return `Before ${timeline[0].track.releaseYear}`;
  }

  if (slotIndex === timeline.length) {
    return `After ${timeline[timeline.length - 1].track.releaseYear}`;
  }

  return `Between ${timeline[slotIndex - 1].track.releaseYear} and ${timeline[slotIndex].track.releaseYear}`;
}

function formatPlacementLabel(placement: PlacementGuess, timeline: TimelineEntry[]): string {
  return slotLabel(timeline, placement.insertIndex);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function buildEmbedSrc(embedUrl: string, autoplay: boolean): string {
  const url = new URL(embedUrl);
  if (autoplay) {
    url.searchParams.set("autoplay", "1");
  }
  url.searchParams.set("playsinline", "1");
  return url.toString();
}
