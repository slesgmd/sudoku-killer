// Inicio mínimo de F8: apodo y dificultad para arrancar una partida simulada. Inicio, Entrar o
// crear y Lobby completos son de F10 (prioridad 3 de entrega-f8.md). Si el arranque falla, un aviso
// con «Reintentar» conserva el apodo y la dificultad (T-37.1, como «Fallo de conexión» en Entrar).
import { useRef, useState } from "react";
import {
  DIFFICULTIES,
  isValidNickname,
  normalizeNickname,
  type Difficulty,
} from "@sudoku-killer/protocol";
import type { ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { GitHubMark, Icon } from "../components/Icon.tsx";

/** Repositorio del proyecto (enlace del inicio, docs/diseno.md). */
export const REPOSITORY_URL = "https://github.com/slesgmd/sudoku-killer";

export interface HomeProps {
  readonly state: ClientState;
  /** Si hay servidor; `null` mientras se crea el transporte (no se avisa nada todavía). */
  readonly available: boolean | null;
  readonly onStart: (nickname: string, difficulty: Difficulty) => void;
}

export function Home({ state, available, onStart }: HomeProps) {
  const [nickname, setNickname] = useState(state.lastStart?.nickname ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(state.lastStart?.difficulty ?? "easy");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const entering = state.phase === "entering";
  const serverError =
    state.enterError === "nickname.invalid" || state.enterError === "nickname.taken";

  return (
    <main className="home">
      <header className="apphead">
        <span className="brand">{t("appTitle")}</span>
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
      </header>
      <div className="home-wrap">
        <h1 className="h-xl">{t("home.title")}</h1>
        <p className="lead">{t("home.lead")}</p>
        {available === false ? (
          <div className="notice" role="status">
            <Icon name="info" />
            <span>{t("home.unavailable")}</span>
          </div>
        ) : null}
        <form
          ref={form}
          className="home-form"
          noValidate
          aria-busy={entering || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (available !== true || entering) return;
            const trimmed = normalizeNickname(nickname);
            if (!isValidNickname(trimmed)) {
              setInvalid(true);
              input.current?.focus();
              return;
            }
            setInvalid(false);
            onStart(trimmed, difficulty);
          }}
        >
          {state.startFailed && !entering ? (
            <div className="toast err formerr" role="alert">
              <Icon name="alert" />
              <span className="formerr-body">
                <span>
                  <span className="tkind">{t("home.failedTitle")}</span> {t("home.failedText")}
                </span>
                <span>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      form.current?.requestSubmit();
                    }}
                  >
                    {t("home.retry")}
                  </button>
                </span>
              </span>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="nickname">{t("home.nickname")}</label>
            <input
              ref={input}
              id="nickname"
              className="input"
              autoComplete="nickname"
              maxLength={16}
              value={nickname}
              disabled={entering}
              aria-invalid={invalid || serverError}
              aria-describedby="nickname-help"
              onChange={(event) => {
                setNickname(event.target.value);
              }}
            />
            {invalid || serverError ? (
              <p id="nickname-help" className="ferr" role="alert">
                <Icon name="alert" />
                {t("home.nicknameInvalid")}
              </p>
            ) : (
              <p id="nickname-help" className="hint">
                {t("home.nicknameHint")}
              </p>
            )}
          </div>
          <fieldset className="field">
            <legend className="flabel">{t("home.difficulty")}</legend>
            <div className="radios">
              {DIFFICULTIES.map((d) => (
                <label key={d} className="radio">
                  <input
                    type="radio"
                    name="difficulty"
                    value={d}
                    checked={difficulty === d}
                    disabled={entering}
                    onChange={() => {
                      setDifficulty(d);
                    }}
                  />
                  <span>
                    <span className="rname">{t(`difficulty.${d}`)}</span>
                    {d === "easy" ? (
                      <span className="rnote">{t("difficulty.easyNote")}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="btn primary lg block"
            type="submit"
            aria-disabled={available !== true || entering ? "true" : undefined}
          >
            {entering ? (
              <>
                {t("home.starting")}
                <span className="bdots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </>
            ) : (
              t("home.start")
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
