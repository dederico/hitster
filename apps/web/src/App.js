import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const socket = io(API_BASE_URL || undefined, {
    autoConnect: false,
    path: "/socket.io",
});
export function App() {
    const [providers, setProviders] = useState([]);
    const [room, setRoom] = useState(null);
    const [playerId, setPlayerId] = useState(null);
    const [activeSource, setActiveSource] = useState(null);
    const [joinName, setJoinName] = useState("Player");
    const [joinAge, setJoinAge] = useState("25");
    const [joinTeam, setJoinTeam] = useState("blue");
    const [joinCode, setJoinCode] = useState("");
    const [selectedProvider, setSelectedProvider] = useState("itunes_preview");
    const [selectedGenres, setSelectedGenres] = useState(["pop", "rock", "reggaeton"]);
    const [languagePreference, setLanguagePreference] = useState("mixed");
    const [tracksPerTeam, setTracksPerTeam] = useState("10");
    const [bonusTitleGuess, setBonusTitleGuess] = useState("");
    const [bonusArtistGuess, setBonusArtistGuess] = useState("");
    const [countdownValue, setCountdownValue] = useState(null);
    const [embedPlayToken, setEmbedPlayToken] = useState(0);
    const [message, setMessage] = useState(null);
    const [error, setError] = useState(null);
    const [isMutating, setIsMutating] = useState(false);
    const audioRef = useRef(null);
    useEffect(() => {
        void fetchJson("/providers")
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
        socket.on("room:state", (nextRoom) => {
            setRoom(nextRoom);
        });
        socket.on("round:countdown", (payload) => {
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
        void fetchJson(`/rooms/${room.code}/current-track/source`)
            .then((payload) => {
            setActiveSource(payload.source);
        })
            .catch(() => {
            setActiveSource({ type: "external_only" });
        });
    }, [room?.code, room?.game.currentRound]);
    async function createRoom() {
        await runMutation(async () => {
            const payload = await fetchJson("/rooms", {
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
            const payload = await fetchJson("/rooms/join", {
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
            const payload = await fetchJson(`/rooms/${room.code}/game/start`, {
                method: "POST",
            });
            setRoom(payload.room);
            setMessage("Random game started. Everyone got a starter track and the first song is live.");
        });
    }
    async function submitPlacement(insertIndex) {
        if (!room || !playerId) {
            setError("Join the room before placing tracks.");
            return;
        }
        await runMutation(async () => {
            const payload = await fetchJson(`/rooms/${room.code}/rounds/place`, {
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
            const payload = await fetchJson(`/rooms/${room.code}/rounds/reveal`, {
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
            const payload = await fetchJson(`/rooms/${room.code}/rounds/bonus`, {
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
            const payload = await fetchJson(`/rooms/${room.code}/rounds/next`, {
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
            const payload = await fetchJson(`/rooms/${room.code}/game/reset`, {
                method: "POST",
            });
            setRoom(payload.room);
            setMessage("Game reset.");
        });
    }
    function hydrateAuthoredRoom(payload) {
        setRoom(payload.room);
        setPlayerId(payload.playerId);
        setJoinCode(payload.room.code);
        socket.emit("room:subscribe", payload.room.code);
    }
    function startSynchronizedCountdown(countdownStartAt, playAt) {
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
    async function runMutation(task) {
        setIsMutating(true);
        setMessage(null);
        setError(null);
        try {
            await task();
        }
        catch (fetchError) {
            setError(getErrorMessage(fetchError));
        }
        finally {
            setIsMutating(false);
        }
    }
    const selectedProviderMeta = providers.find((provider) => provider.id === selectedProvider);
    const me = room?.players.find((player) => player.id === playerId) ?? null;
    const myPlacement = room?.game.placements.find((placement) => placement.playerId === playerId) ?? null;
    const myBonusGuess = room?.game.bonusGuesses.find((guess) => guess.playerId === playerId) ?? null;
    const isMyTurn = Boolean(playerId && room?.game.currentTurnPlayerId === playerId);
    return (_jsxs("main", { className: "app-shell", children: [_jsxs("section", { className: "hero", children: [_jsx("p", { className: "eyebrow", children: "Hitster-Personalizado" }), _jsx("h1", { children: "Empieza con un a\u00F1o aleatorio. Coloca la siguiente canci\u00F3n antes, despu\u00E9s o entre medio." }), _jsx("p", { className: "lede", children: "Cada jugador recibe una canci\u00F3n inicial ya revelada. Despu\u00E9s, cada nueva canci\u00F3n aleatoria debe colocarse en su propia l\u00EDnea del tiempo en orden cronol\u00F3gico." })] }), _jsxs("section", { className: "grid", children: [_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Create room" }), _jsxs("label", { children: ["Random source", _jsx("select", { value: selectedProvider, onChange: (event) => setSelectedProvider(event.target.value), children: providers.map((provider) => (_jsx("option", { value: provider.id, children: provider.name }, provider.id))) })] }), _jsx("p", { className: "helper-copy", children: selectedProviderMeta?.capabilities.search
                                    ? "This source can auto-build random rounds."
                                    : "This source cannot generate a random catalog." }), _jsxs("label", { children: ["G\u00E9neros", _jsx("select", { multiple: true, value: selectedGenres, onChange: (event) => setSelectedGenres(Array.from(event.target.selectedOptions, (option) => option.value)), children: ["pop", "rock", "reggaeton", "corridos tumbados", "regional mexicano", "hip hop", "oldies"].map((genre) => (_jsx("option", { value: genre, children: genre }, genre))) })] }), _jsxs("label", { children: ["Idioma", _jsxs("select", { value: languagePreference, onChange: (event) => setLanguagePreference(event.target.value), children: [_jsx("option", { value: "mixed", children: "Mixto" }), _jsx("option", { value: "spanish", children: "Espa\u00F1ol" }), _jsx("option", { value: "english", children: "Ingl\u00E9s" })] })] }), _jsxs("label", { children: ["Canciones por equipo", _jsx("input", { value: tracksPerTeam, onChange: (event) => setTracksPerTeam(event.target.value) })] }), _jsx("button", { onClick: createRoom, disabled: isMutating, children: "Create" })] }), _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Join room" }), _jsxs("label", { children: ["Room code", _jsx("input", { value: joinCode, onChange: (event) => setJoinCode(event.target.value.toUpperCase()) })] }), _jsxs("label", { children: ["Player name", _jsx("input", { value: joinName, onChange: (event) => setJoinName(event.target.value) })] }), _jsxs("label", { children: ["Edad", _jsx("input", { value: joinAge, onChange: (event) => setJoinAge(event.target.value) })] }), _jsxs("label", { children: ["Equipo", _jsxs("select", { value: joinTeam, onChange: (event) => setJoinTeam(event.target.value), children: [_jsx("option", { value: "blue", children: "Azul" }), _jsx("option", { value: "red", children: "Rojo" })] })] }), _jsx("button", { onClick: joinRoom, disabled: isMutating, children: "Join" })] })] }), message ? _jsx("p", { className: "status-message", children: message }) : null, error ? _jsx("p", { className: "status-message error-message", children: error }) : null, _jsxs("section", { className: "grid", children: [_jsxs("article", { className: "panel room-panel", children: [_jsx("h2", { children: "Room" }), room ? (_jsxs(_Fragment, { children: [_jsxs("p", { children: ["Code ", _jsx("strong", { children: room.code }), " \u00B7 Status ", _jsx("strong", { children: room.status }), " \u00B7 Round", " ", _jsx("strong", { children: room.game.currentRound }), " / ", room.game.totalRounds] }), _jsxs("p", { children: ["Remaining songs ", _jsx("strong", { children: room.game.remainingTrackCount }), " \u00B7 You are", " ", _jsx("strong", { children: me?.name ?? "spectating" })] }), _jsxs("p", { children: ["G\u00E9neros ", _jsx("strong", { children: room.settings.genres.join(", ") }), " \u00B7 Idioma ", _jsx("strong", { children: room.settings.languagePreference })] }), _jsxs("p", { children: ["Turno actual ", _jsx("strong", { children: room.game.currentTurnPlayerName ?? "sin asignar" }), " \u00B7 Equipo", " ", _jsx("strong", { children: room.game.currentTurnTeam ?? "-" })] }), _jsxs("div", { className: "button-row", children: [_jsx("button", { onClick: startGame, disabled: isMutating || !selectedProviderMeta?.capabilities.search, children: "Start timeline game" }), _jsx("button", { onClick: resetGame, disabled: isMutating || room.game.seededTrackCount === 0, children: "Reset" })] }), _jsx("ul", { className: "player-list", children: room.players.map((player) => (_jsxs("li", { children: [player.name, " \u00B7 ", player.team, " \u00B7 ", player.age, " a\u00F1os \u00B7 ", player.score, " pts"] }, player.id))) })] })) : (_jsx("p", { children: "Create or join a room to begin." }))] }), _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Current random song" }), room?.game.currentTrack ? (_jsxs(_Fragment, { children: [_jsx("p", { children: _jsx("strong", { children: room.game.currentTrack.title }) }), _jsx("p", { children: room.game.currentTrack.artists.join(", ") }), activeSource?.type === "preview_url" ? (_jsx("audio", { ref: audioRef, controls: true, src: activeSource.url, className: "audio-player" })) : activeSource?.type === "embed" ? (_jsx("iframe", { className: "video-frame", src: buildEmbedSrc(activeSource.embedUrl, embedPlayToken > 0), title: room.game.currentTrack.title, allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture", allowFullScreen: true }, `${room.game.currentRound}-${embedPlayToken}`)) : room.game.currentTrack.externalUrl ? (_jsx("p", { children: _jsx("a", { href: room.game.currentTrack.externalUrl, target: "_blank", rel: "noreferrer", children: "Open external source" }) })) : (_jsx("p", { className: "helper-copy", children: "This random track has no in-app preview available." })), room.game.phase === "revealed" && room.game.revealedTrack ? (_jsxs("p", { children: ["Actual year ", _jsx("strong", { children: room.game.revealedTrack.releaseYear })] })) : (_jsx("p", { className: "helper-copy", children: "Year hidden until reveal." })), countdownValue ? _jsx("p", { children: _jsx("strong", { children: countdownValue }) }) : null, _jsx("button", { onClick: triggerPlayback, disabled: isMutating ||
                                            !isMyTurn ||
                                            room.game.phase !== "guessing" ||
                                            (activeSource?.type !== "preview_url" && activeSource?.type !== "embed"), children: "Play para todos" })] })) : (_jsx("p", { children: "No active random song yet. Start the game to get everyone a starter year and begin round one." }))] })] }), me ? (_jsxs("section", { className: "grid", children: [_jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Your timeline" }), _jsx("p", { className: "helper-copy", children: "Tap where the current song belongs relative to your revealed starter and accumulated timeline." }), _jsx("p", { className: "helper-copy", children: isMyTurn
                                    ? "Es tu turno: coloca la canción actual en tu línea del tiempo."
                                    : `No es tu turno. Está jugando ${room?.game.currentTurnPlayerName ?? "otro jugador"}.` }), _jsx(TimelinePlacement, { timeline: me.timeline, disabled: isMutating || room?.game.phase !== "guessing" || !room?.game.currentTrack || !isMyTurn, selectedPlacement: myPlacement, onPlace: submitPlacement })] }), _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Round board" }), room?.game.placements.length ? (_jsx("div", { className: "track-library", children: room.game.placements.map((placement) => (_jsx("article", { className: "track-card", children: _jsxs("div", { children: [_jsx("strong", { children: placement.playerName }), _jsx("p", { children: formatPlacementLabel(placement, room.players.find((player) => player.id === placement.playerId)?.timeline ?? []) })] }) }, `${placement.playerId}-${placement.submittedAt}`))) })) : (_jsx("p", { children: "No placements submitted yet." })), _jsxs("div", { className: "button-row", children: [_jsx("button", { onClick: revealRound, disabled: isMutating || room?.game.phase !== "guessing", children: "Reveal placement" }), _jsx("button", { onClick: nextRound, disabled: isMutating || room?.game.phase !== "revealed" || room.game.remainingTrackCount === 0, children: "Next random song" })] }), room?.game.reveal ? (_jsxs("div", { className: "reveal-card", children: [_jsxs("p", { children: ["Actual year ", _jsx("strong", { children: room.game.reveal.actualYear })] }), room.game.reveal.outcomes.map((outcome) => (_jsxs("p", { children: [outcome.playerName, ": ", _jsx("strong", { children: outcome.correct ? "correcto" : "incorrecto" }), " \u00B7 ", outcome.awardedPoints, " pts"] }, outcome.playerId)))] })) : null] })] })) : null, me ? (_jsx("section", { className: "grid", children: _jsxs("article", { className: "panel", children: [_jsx("h2", { children: "Doble o nada" }), _jsx("p", { className: "helper-copy", children: "Si atinas canci\u00F3n y artista en tu turno, la colocaci\u00F3n correcta vale doble." }), _jsxs("label", { children: ["Canci\u00F3n", _jsx("input", { value: bonusTitleGuess, onChange: (event) => setBonusTitleGuess(event.target.value) })] }), _jsxs("label", { children: ["Artista", _jsx("input", { value: bonusArtistGuess, onChange: (event) => setBonusArtistGuess(event.target.value) })] }), _jsx("button", { onClick: submitBonusGuess, disabled: isMutating ||
                                !isMyTurn ||
                                room?.game.phase !== "guessing" ||
                                !bonusTitleGuess.trim() ||
                                !bonusArtistGuess.trim(), children: "Activar doble" }), myBonusGuess ? _jsxs("p", { className: "helper-copy", children: ["Apuesta enviada: ", myBonusGuess.titleGuess, " / ", myBonusGuess.artistGuess] }) : null] }) })) : null, room?.players.length ? (_jsx("section", { className: "grid", children: room.players.map((player) => (_jsxs("article", { className: "panel", children: [_jsx("h2", { children: player.name }), _jsx(TimelineDisplay, { timeline: player.timeline })] }, player.id))) })) : null] }));
}
function TimelinePlacement({ timeline, disabled, selectedPlacement, onPlace, }) {
    const slots = Array.from({ length: timeline.length + 1 }, (_, index) => index);
    return (_jsx("div", { className: "timeline-stack", children: slots.map((slotIndex) => (_jsxs("div", { className: "timeline-slot", children: [_jsx("button", { className: "slot-button", disabled: disabled, onClick: () => onPlace(slotIndex), children: selectedPlacement?.insertIndex === slotIndex ? "Placed here" : slotLabel(timeline, slotIndex) }), slotIndex < timeline.length ? (_jsx("article", { className: "track-card timeline-card", children: _jsxs("div", { children: [_jsx("strong", { children: timeline[slotIndex].track.releaseYear }), _jsx("p", { children: timeline[slotIndex].track.title }), _jsx("p", { children: timeline[slotIndex].track.artists.join(", ") })] }) })) : null] }, slotIndex))) }));
}
function TimelineDisplay({ timeline }) {
    if (timeline.length === 0) {
        return _jsx("p", { children: "No timeline yet." });
    }
    return (_jsx("div", { className: "track-library", children: timeline.map((entry) => (_jsx("article", { className: "track-card timeline-card", children: _jsxs("div", { children: [_jsx("strong", { children: entry.track.releaseYear }), _jsx("p", { children: entry.track.title }), _jsx("p", { children: entry.track.artists.join(", ") })] }) }, entry.id))) }));
}
function slotLabel(timeline, slotIndex) {
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
function formatPlacementLabel(placement, timeline) {
    return slotLabel(timeline, placement.insertIndex);
}
async function fetchJson(path, init) {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers,
    });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null));
        throw new Error(payload?.message ?? `Request failed with ${response.status}`);
    }
    return (await response.json());
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : "Unknown error";
}
function buildEmbedSrc(embedUrl, autoplay) {
    const url = new URL(embedUrl);
    if (autoplay) {
        url.searchParams.set("autoplay", "1");
    }
    url.searchParams.set("playsinline", "1");
    return url.toString();
}
