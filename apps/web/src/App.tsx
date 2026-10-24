import { useEffect, useState, useSyncExternalStore } from "react";
import { GameClient } from "./game/client.ts";
import { INITIAL_STATE } from "./game/state.ts";
import { GameScreen } from "./screens/GameScreen.tsx";
import { Home } from "./screens/Home.tsx";
import { createTransport } from "./transport/index.ts";

const noop = () => () => undefined;
const initial = () => INITIAL_STATE;

/** Inicio mínimo o partida, según la fase del cliente (F8). */
export function App() {
  const [client, setClient] = useState<GameClient | null>(null);
  useEffect(() => {
    let created: GameClient | null = null;
    let cancelled = false;
    void createTransport().then((transport) => {
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
  const state = useSyncExternalStore(client?.subscribe ?? noop, client?.getState ?? initial);

  if (!client || state.phase === "home" || state.phase === "entering") {
    return (
      <Home
        state={state}
        available={client?.available() === true}
        onStart={(nickname, difficulty) => {
          client?.start(nickname, difficulty);
        }}
      />
    );
  }
  return <GameScreen client={client} state={state} />;
}
