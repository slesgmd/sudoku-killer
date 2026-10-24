import { useEffect, useState, useSyncExternalStore } from "react";
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";
import { GameClient } from "./game/client.ts";
import { INITIAL_STATE } from "./game/state.ts";
import { t } from "./i18n/index.ts";
import { createTransport } from "./transport/index.ts";

// Esqueleto de F8c: arranca una partida contra el transporte disponible. La interfaz del diseño
// llega en F8d.
export function App() {
  const [client, setClient] = useState<GameClient | null>(null);
  useEffect(() => {
    let created: GameClient | null = null;
    void createTransport().then((transport) => {
      created = new GameClient({ transport });
      setClient(created);
    });
    return () => {
      created?.destroy();
    };
  }, []);
  const state = useSyncExternalStore(
    client?.subscribe ?? (() => () => undefined),
    client?.getState ?? (() => INITIAL_STATE),
  );
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  return (
    <main>
      <h1>{t("appTitle")}</h1>
      <select
        value={difficulty}
        onChange={(event) => {
          setDifficulty(event.target.value as Difficulty);
        }}
      >
        {DIFFICULTIES.map((d) => (
          <option key={d} value={d}>
            {t(`difficulty.${d}`)}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => client?.start("Inés", difficulty)}>
        {t("home.start")}
      </button>
      <p>{state.phase}</p>
    </main>
  );
}
