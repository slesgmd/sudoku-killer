// Cabecera de las pantallas fuera de la partida (design/pantallas.md): «Sudoku Killer» a la izquierda
// y Ayuda a la derecha. Ajustes solo aparece dentro de una sala (decisión 1), y el enlace al
// repositorio, en Inicio (docs/diseno.md).
import { t } from "../i18n/index.ts";
import { routeHash } from "../routes.ts";
import { GitHubMark } from "./Icon.tsx";

/** Repositorio del proyecto (enlace del inicio, docs/diseno.md). */
export const REPOSITORY_URL = "https://github.com/slesgmd/sudoku-killer";

export function AppHeader({
  onSettings,
  repository = false,
  current,
}: {
  /** Solo dentro de una sala. */
  readonly onSettings?: (() => void) | undefined;
  readonly repository?: boolean;
  /** Ayuda es la página actual. */
  readonly current?: "help";
}) {
  return (
    <header className="apphead">
      <span className="brand">{t("appTitle")}</span>
      <nav aria-label={t("app.nav")}>
        <a
          className="btn ghost"
          href={routeHash({ name: "help" })}
          aria-current={current === "help" ? "page" : undefined}
        >
          {t("app.help")}
        </a>
        {onSettings ? (
          <button className="btn ghost" type="button" aria-haspopup="dialog" onClick={onSettings}>
            {t("app.settings")}
          </button>
        ) : null}
        {repository ? (
          <a
            className="btn ghost repo"
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("home.repository")}
            title={t("home.repository")}
          >
            <GitHubMark />
          </a>
        ) : null}
      </nav>
    </header>
  );
}
