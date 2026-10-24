import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { GameClient } from "./game/client.ts";
import { INITIAL_STATE } from "./game/state.ts";
import { GameScreen } from "./screens/GameScreen.tsx";
import { Home } from "./screens/Home.tsx";
import { createServerTransport, createTransport } from "./transport/index.ts";

/** Solo en desarrollo: el tiempo de carga del puzzle en pantalla. No llega al build (T-31.2). */
const LoadBadge = import.meta.env.DEV ? lazy(() => import("./dev/LoadBadge.tsx")) : null;

const noop = () => () => undefined;
const initial = () => INITIAL_STATE;

/** Inicio mínimo o partida, según la fase del cliente (F8). */
export function Screens({ client }: { readonly client: GameClient | null }) {
  const state = useSyncExternalStore(client?.subscribe ?? noop, client?.getState ?? initial);
  if (!client || state.phase === "home" || state.phase === "entering") {
    return (
      <Home
        state={state}
        available={client ? client.available() : null}
        onStart={(nickname, difficulty) => {
          client?.start(nickname, difficulty);
        }}
      />
    );
  }
  return <GameScreen client={client} state={state} />;
}

export function App() {
  const [client, setClient] = useState<GameClient | null>(null);
  useEffect(() => {
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
