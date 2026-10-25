// Entrar o crear sala (design/pantallas.md §1.2), con los estados de su hoja: apodo no válido,
// carácter rechazado, sala inexistente, sala llena, apodo en uso, fallo de conexión con «Reintentar»
// (T-37.1) y cargando. Los datos escritos se conservan en todos los errores.
import { useRef, useState } from "react";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidNickname,
  normalizeNickname,
} from "@sudoku-killer/protocol";
import { AppHeader } from "../components/AppHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import type { ClientState, EntryRequest } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { routeHash } from "../routes.ts";

export interface EnterProps {
  readonly state: ClientState;
  /** El código de la ruta (`#/entrar/CODIGO`, o el enlace de una sala sin ficha). */
  readonly code: string | null;
  readonly savedNickname: string | null;
  readonly onJoin: (code: string, nickname: string) => void;
  readonly onCreate: (nickname: string) => void;
  readonly onRetry: () => void;
}

const ALLOWED = new Set(ROOM_CODE_ALPHABET);

/** El código tal como se escribe: en mayúsculas y solo con caracteres del alfabeto (D2). */
export function cleanCode(raw: string): {
  readonly code: string;
  readonly rejected: string | null;
} {
  let code = "";
  let rejected: string | null = null;
  for (const char of raw.toUpperCase()) {
    if (ALLOWED.has(char)) code += char;
    else if (char.trim() !== "") rejected ??= char;
  }
  return { code: code.slice(0, ROOM_CODE_LENGTH), rejected };
}

export function Enter({ state, code, savedNickname, onJoin, onCreate, onRetry }: EnterProps) {
  const last = state.lastEntry;
  const [nickname, setNickname] = useState(
    last && last.nickname !== "" ? last.nickname : (savedNickname ?? ""),
  );
  const [roomCode, setRoomCode] = useState(code ?? last?.code ?? "");
  const [rejected, setRejected] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<{ nickname: boolean; code: boolean }>({
    nickname: false,
    code: false,
  });
  /** La entrada cuyo error del servidor ya se corrigió al editar el campo. */
  const [editedNickname, setEditedNickname] = useState<EntryRequest | null>(null);
  const [editedCode, setEditedCode] = useState<EntryRequest | null>(null);
  const nicknameInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const entering = state.phase === "entering";
  const error = entering ? null : state.enterError;
  const nicknameServer =
    (error === "nickname.invalid" || error === "nickname.taken") && editedNickname !== last;
  const codeServer = error === "room.not_found" && editedCode !== last;
  const full = error === "room.full";
  const offline = state.startFailed && !entering;
  const nicknameError = invalid.nickname
    ? t("enter.nicknameInvalid")
    : nicknameServer
      ? error === "nickname.taken"
        ? t("enter.nicknameTaken", { nickname: last?.nickname ?? nickname })
        : t("enter.nicknameInvalid")
      : null;
  const codeError = invalid.code
    ? t("enter.codeIncomplete")
    : codeServer
      ? t("enter.codeNotFound", { code: last?.code ?? roomCode })
      : null;

  /** Valida antes de enviar: el apodo siempre y, para entrar, el código completo. */
  const check = (withCode: boolean): string | null => {
    const trimmed = normalizeNickname(nickname);
    const badNickname = !isValidNickname(trimmed);
    const badCode = withCode && roomCode.length !== ROOM_CODE_LENGTH;
    setInvalid({ nickname: badNickname, code: badCode });
    if (badNickname) {
      nicknameInput.current?.focus();
      return null;
    }
    if (badCode) {
      codeInput.current?.focus();
      return null;
    }
    return trimmed;
  };

  const status = entering
    ? last?.kind === "create"
      ? t("enter.statusCreate")
      : t("enter.statusJoin", { code: last?.code ?? roomCode })
    : "";

  return (
    <div className="scr">
      <AppHeader />
      <main className="wrap col narrow">
        <div className="stack-l">
          <a className="linkbtn back" href={routeHash({ name: "home" })}>
            <Icon name="back" />
            {t("enter.back")}
          </a>
          <div className="stack-s">
            <h1 className="h-l">{t("enter.title")}</h1>
            <p className="lead">{t("enter.lead")}</p>
          </div>

          <form
            className="stack-l"
            noValidate
            aria-busy={entering || undefined}
            onSubmit={(event) => {
              event.preventDefault();
              if (entering) return;
              const valid = check(true);
              if (valid !== null) onJoin(roomCode, valid);
            }}
          >
            {entering && state.waking ? (
              <div className="toast formerr" role="status">
                <Icon name="info" />
                <span className="formerr-body">
                  <span>
                    <span className="tkind">{t("enter.wakingTitle")}</span> {t("enter.wakingText")}
                  </span>
                </span>
              </div>
            ) : null}
            {full || offline ? (
              <div className="toast err formerr" role="alert">
                <Icon name="alert" />
                <span className="formerr-body">
                  <span>
                    <span className="tkind">
                      {full ? t("enter.fullTitle") : t("enter.offlineTitle")}
                    </span>{" "}
                    {full
                      ? t("enter.fullText", { code: last?.code ?? roomCode })
                      : t("enter.offlineText")}
                  </span>
                  {offline ? (
                    <span>
                      <button className="btn secondary" type="button" onClick={onRetry}>
                        {t("enter.retry")}
                      </button>
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="nickname">{t("enter.nickname")}</label>
              <input
                ref={nicknameInput}
                id="nickname"
                className="input"
                autoComplete="nickname"
                maxLength={16}
                value={nickname}
                disabled={entering}
                aria-invalid={nicknameError !== null}
                aria-describedby="nickname-hint nickname-error"
                onChange={(event) => {
                  setNickname(event.target.value);
                  setInvalid((v) => ({ ...v, nickname: false }));
                  setEditedNickname(last);
                }}
              />
              <p id="nickname-hint" className="hint">
                {t("enter.nicknameHint")}
              </p>
              {nicknameError ? (
                <p id="nickname-error" className="ferr" role="alert">
                  <Icon name="alert" />
                  <span>{nicknameError}</span>
                </p>
              ) : null}
            </div>

            <fieldset className="stack-m">
              <legend className="h-sec">{t("enter.withCode")}</legend>
              <div className="field">
                <label htmlFor="room-code">{t("enter.code")}</label>
                <input
                  ref={codeInput}
                  id="room-code"
                  className="input code"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={ROOM_CODE_LENGTH}
                  value={roomCode}
                  disabled={entering}
                  aria-invalid={codeError !== null}
                  aria-describedby="code-hint code-note code-error"
                  onChange={(event) => {
                    const next = cleanCode(event.target.value);
                    setRoomCode(next.code);
                    setRejected(next.rejected);
                    setInvalid((v) => ({ ...v, code: false }));
                    setEditedCode(last);
                  }}
                />
                <p id="code-hint" className="hint">
                  {t("enter.codeHint")}
                </p>
                <p id="code-note" aria-live="polite">
                  {rejected ? (
                    <span className="fnote">
                      <Icon name="info" />
                      <span>{t("enter.codeRejected", { char: rejected })}</span>
                    </span>
                  ) : null}
                </p>
                {codeError ? (
                  <p id="code-error" className="ferr" role="alert">
                    <Icon name="alert" />
                    <span>{codeError}</span>
                  </p>
                ) : null}
              </div>
              <button
                className="btn primary lg block"
                type="submit"
                aria-disabled={entering ? "true" : undefined}
              >
                {entering && last?.kind === "join" ? (
                  <>
                    {t("enter.entering")}
                    <span className="bdots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </>
                ) : (
                  t("enter.join")
                )}
              </button>
            </fieldset>

            <p className="divider-o">{t("enter.or")}</p>

            <div className="stack-s">
              <button
                className="btn secondary lg block"
                type="button"
                aria-disabled={entering ? "true" : undefined}
                onClick={() => {
                  if (entering) return;
                  const valid = check(false);
                  if (valid !== null) onCreate(valid);
                }}
              >
                {entering && last?.kind === "create" ? (
                  <>
                    {t("enter.entering")}
                    <span className="bdots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                  </>
                ) : (
                  t("enter.create")
                )}
              </button>
              <p className="hint">{t("enter.createHint")}</p>
            </div>
            <p className="sr-only" role="status">
              {status}
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
