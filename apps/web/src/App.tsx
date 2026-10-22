import { PROTOCOL_VERSION } from "@sudoku-killer/protocol";
import { es } from "./i18n/es.ts";

export function App() {
  return (
    <main>
      <h1>{es.appTitle}</h1>
      <p>{es.placeholder.replace("{version}", String(PROTOCOL_VERSION))}</p>
    </main>
  );
}
