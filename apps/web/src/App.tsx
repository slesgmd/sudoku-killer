import { Suspense, lazy, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SettingsDialog } from "./components/Dialogs.tsx";
import { SessionDialogs } from "./components/Network.tsx";
import { browserShareApi, type ShareApi } from "./components/share.ts";
import { GameClient } from "./game/client.ts";
import { browserSession } from "./game/session.ts";
import { INITIAL_STATE, type Phase } from "./game/state.ts";
import { navigate, parseRoute, roomLink, takeInvitation, useHash } from "./routes.ts";
import { AccessKey } from "./screens/AccessKey.tsx";
import { Enter } from "./screens/Enter.tsx";
import { GameScreen } from "./screens/GameScreen.tsx";
import { Help } from "./screens/Help.tsx";
import { Home } from "./screens/Home.tsx";
import { Lobby } from "./screens/Lobby.tsx";
import { Results } from "./screens/Results.tsx";
import { createServerTransport, createTransport } from "./transport/index.ts";

/** Solo en desarrollo: el tiempo de carga del puzzle en pantalla. No llega al build (T-31.2). */
const LoadBadge = import.meta.env.DEV ? lazy(() => import("./dev/LoadBadge.tsx")) : null;

const noop = () => () => undefined;
const initial = () => INITIAL_STATE;

/** Fases con la sala abierta: la ruta es `#/sala/CODIGO`. */
const IN_ROOM = new Set<Phase>(["lobby", "loading", "playing", "ended"]);

/**
 * Las pantallas según la ruta y el estado del cliente (F10). La sala tiene una sola ruta y la
 * pantalla sale del estado de la sala: lobby, partida o Resultados (decisión 3). Al abrir el enlace
 * de una sala con la ficha guardada, la sesión se reanuda sola; sin ficha, se abre Entrar con el
 * código (plan de F10).
 */
export function Screens({
  client,
  share = browserShareApi(),
  reload = () => {
    window.location.reload();
  },
}: {
  readonly client: GameClient | null;
  readonly share?: ShareApi;
  /** «Recargar» con la versión incompatible (E-19). */
  readonly reload?: () => void;
}) {
  const state = useSyncExternalStore(client?.subscribe ?? noop, client?.getState ?? initial);
  const hash = useHash();
  const route = parseRoute(hash);
  const [settings, setSettings] = useState(false);
  const previousPhase = useRef<Phase>(state.phase);
  /** La ruta de sala con la que ya se intentó volver con la ficha. */
  const attempted = useRef<string | null>(null);
  const previousHash = useRef<string | null>(null);
  /** Si Ayuda se abrió desde otra pantalla de la aplicación («Volver» vuelve atrás). */
  const helpFromApp = useRef(false);
  const inRoom = IN_ROOM.has(state.phase) && state.room !== null;

  useEffect(() => {
    const now = window.location.hash;
    if (
      parseRoute(now).name === "help" &&
      previousHash.current !== null &&
      previousHash.current !== now
    )
      helpFromApp.current = parseRoute(previousHash.current).name !== "help";
    previousHash.current = now;
  }, [hash]);

  useEffect(() => {
    if (!client) return;
    const before = previousPhase.current;
    previousPhase.current = state.phase;
    const current = parseRoute(window.location.hash);
    if (current.name !== "room") attempted.current = null;
    if (current.name === "help") return;
    const code = state.room?.code ?? null;
    if (inRoom && code !== null) {
      if (current.name === "room" && current.code === code) return;
      // Recién se entró: se pasa a la ruta de la sala. Si no, se navegó fuera de la sala (por
      // ejemplo, con «Atrás»): se cierra la conexión y el asiento queda reservado (R-13).
      if (before === "entering" || before === "home")
        navigate({ name: "room", code }, { replace: current.name === "room" });
      else client.backHome();
      return;
    }
    if (state.phase === "entering" || current.name !== "room") return;
    const noticed = state.roomNotice?.code === current.code;
    if (attempted.current !== current.code && client.hasToken(current.code) && !noticed) {
      attempted.current = current.code;
      client.resume(current.code);
      return;
    }
    navigate(noticed ? { name: "home" } : { name: "enter", code: current.code }, {
      replace: true,
    });
  });

  if (!client) return null;
  const leave = () => {
    client.leave();
    navigate({ name: "home" });
  };
  const settingsDialog = settings ? (
    <SettingsDialog
      autoClean={state.settings.autoCleanPersonalNotes}
      useNotes={state.notesEnabled}
      onUseNotes={(value) => {
        client.setNotesEnabled(value);
      }}
      onChange={(value) => {
        client.setAutoClean(value);
      }}
      onClose={() => {
        setSettings(false);
      }}
    />
  ) : null;

  if (state.accessDenied !== null) {
    return (
      <AccessKey
        reason={state.accessDenied}
        onSubmit={(key) => client.submitAccessKey(key)}
        onBack={() => {
          client.cancelAccess();
          navigate({ name: "home" });
        }}
      />
    );
  }
  if (route.name === "help") {
    return (
      <>
        <Help
          onBack={() => {
            if (helpFromApp.current) window.history.back();
            else navigate(inRoom ? { name: "room", code: state.room.code } : { name: "home" });
          }}
          onSettings={
            inRoom
              ? () => {
                  setSettings(true);
                }
              : undefined
          }
        />
        {settingsDialog}
      </>
    );
  }
  if (inRoom) {
    return (
      <>
        {state.phase === "lobby" ? (
          <Lobby
            client={client}
            state={state}
            share={share}
            link={roomLink(state.room.code, window.location)}
            onLeave={leave}
          />
        ) : state.phase === "ended" && state.showResults ? (
          <Results client={client} state={state} onLeave={leave} />
        ) : (
          <GameScreen client={client} state={state} onLeave={leave} />
        )}
        <SessionDialogs
          state={state}
          onPlayHere={() => {
            client.playHere();
          }}
          onReload={reload}
        />
      </>
    );
  }
  if (route.name === "home" && state.phase !== "entering") {
    return (
      <Home
        savedRoom={client.savedRoom()}
        notice={state.roomNotice}
        onResume={() => {
          client.dismissNotice();
        }}
      />
    );
  }
  const code =
    route.name === "enter" || route.name === "room" ? route.code : (state.lastEntry?.code ?? null);
  return (
    <Enter
      key={route.name === "room" ? `room-${route.code}` : hash}
      state={state}
      code={code}
      savedNickname={client.savedNickname()}
      onJoin={(roomCode, nickname) => {
        client.join(roomCode, nickname);
      }}
      onCreate={(nickname) => {
        client.create(nickname);
      }}
      onRetry={() => {
        client.retryEntry();
      }}
    />
  );
}

export function App() {
  const [client, setClient] = useState<GameClient | null>(null);
  useEffect(() => {
    // Enlace de invitación del grupo (`#k=…`, R-39): la clave se guarda y sale de la URL.
    takeInvitation(window.location, window.history, (key) => {
      browserSession.saveAccessKey(key);
    });
    let created: GameClient | null = null;
    let cancelled = false;
    void createTransport()
      // Si el simulador no cargó, se usa el servidor real.
      .catch((error: unknown) => {
        console.error(error);
        return createServerTransport();
      })
      .then((transport) => {
        if (cancelled) {
          transport.close();
          return;
        }
        created = new GameClient({ transport });
        setClient(created);
      });
    return () => {
      cancelled = true;
      created?.destroy();
    };
  }, []);

  return (
    <>
      <Screens client={client} />
      {LoadBadge ? (
        <Suspense fallback={null}>
          <LoadBadge />
        </Suspense>
      ) : null}
    </>
  );
}
