// Inicio (design/pantallas.md §1.1): el juego en una frase, «Entrar o crear sala» y, con una ficha
// guardada, «Volver a la sala». Sin fotos en la v1: una columna centrada (plan de F10). Conserva el
// enlace al repositorio del inicio mínimo de F8.
import { AppHeader } from "../components/AppHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import type { RoomNotice } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { routeHash } from "../routes.ts";

export interface HomeProps {
  /** La sala de la ficha guardada, si hay. */
  readonly savedRoom: string | null;
  /** Por qué no se pudo volver a una sala. */
  readonly notice: RoomNotice | null;
  /** Antes de «Volver a la sala»: quita el aviso para que se intente otra vez. */
  readonly onResume?: () => void;
}

export function Home({ savedRoom, notice, onResume }: HomeProps) {
  const facts = [
    [t("home.factPlayers"), t("home.factPlayersValue")],
    [t("home.factLives"), t("home.factLivesValue")],
    [t("home.factHints"), t("home.factHintsValue")],
  ] as const;
  return (
    <div className="scr">
      <AppHeader repository />
      <main className="wrap col">
        <div className="stack-l">
          <div className="stack-m">
            <h1 className="h-xl">{t("home.title")}</h1>
            <p className="body muted">{t("home.lead")}</p>
          </div>

          {notice ? (
            <div className="notice" role="status">
              <Icon name="info" />
              <span>
                <strong className="strong">
                  {t(notice.kind === "gone" ? "home.gone" : "home.full", { code: notice.code })}
                </strong>{" "}
                {t(notice.kind === "gone" ? "home.goneText" : "home.fullText")}
              </span>
            </div>
          ) : null}

          <div className="home-actions">
            {savedRoom ? (
              <>
                <a
                  className="btn primary lg block"
                  href={routeHash({ name: "room", code: savedRoom })}
                  onClick={onResume}
                >
                  {t("home.resume", { code: savedRoom })}
                </a>
                <p className="hint">{t("home.resumeHint")}</p>
                <a
                  className="btn secondary lg block home-other"
                  href={routeHash({ name: "enter", code: null })}
                >
                  {t("home.enterOther")}
                </a>
              </>
            ) : (
              <a className="btn primary lg block" href={routeHash({ name: "enter", code: null })}>
                {t("home.enter")}
              </a>
            )}
            <a className="linkbtn home-howto" href={routeHash({ name: "help" })}>
              {t("home.howTo")}
            </a>
          </div>

          <dl className="facts">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="lbl">{label}</dt>
                <dd className="pts">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </main>
    </div>
  );
}
