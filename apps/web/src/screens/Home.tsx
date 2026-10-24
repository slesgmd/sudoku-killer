// Inicio mínimo de F8: apodo y dificultad para arrancar una partida simulada. Inicio, Entrar o
// crear y Lobby completos son de F10 (prioridad 3 de entrega-f8.md).
import { useRef, useState } from "react";
import { DIFFICULTIES, type Difficulty } from "@sudoku-killer/protocol";
import type { ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { Icon } from "../components/Icon.tsx";

export interface HomeProps {
  readonly state: ClientState;
  readonly available: boolean;
  readonly onStart: (nickname: string, difficulty: Difficulty) => void;
}

export function Home({ state, available, onStart }: HomeProps) {
  const [nickname, setNickname] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const entering = state.phase === "entering";
  const serverError =
    state.enterError === "nickname.invalid" || state.enterError === "nickname.taken";

  return (
    <main className="home">
      <header className="apphead">
        <span className="brand">{t("appTitle")}</span>
      </header>
      <div className="home-wrap">
        <h1 className="h-xl">{t("home.title")}</h1>
        <p className="lead">{t("home.lead")}</p>
        {available ? null : (
          <div className="notice" role="status">
            <Icon name="info" />
            <span>{t("home.unavailable")}</span>
          </div>
        )}
        <form
          className="home-form"
          noValidate
          aria-busy={entering || undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (!available || entering) return;
            const trimmed = nickname.normalize("NFKC").trim();
            if (trimmed.length < 2 || trimmed.length > 16) {
              setInvalid(true);
              input.current?.focus();
              return;
            }
            setInvalid(false);
            onStart(trimmed, difficulty);
          }}
        >
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
            aria-disabled={!available || entering ? "true" : undefined}
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
