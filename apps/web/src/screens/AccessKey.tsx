// «Clave del grupo» (R-39): aparece antes de abrir ningún WebSocket cuando `POST /access` dice
// que falta la clave o que la guardada no vale (o, de respaldo, con el cierre 4003). La clave se
// escribe una sola vez; al continuar se comprueba y, solo si vale, queda en el dispositivo y se
// repite lo que se estaba haciendo (T-39.14). El enlace de invitación (`#k=`) evita escribirla y
// pasa por la misma comprobación. Con la red bloqueada por demasiadas claves que no valen (429,
// T-39.10), pide esperar y ofrece «Reintentar».
import { useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import { t } from "../i18n/index.ts";

export interface AccessKeyProps {
  readonly reason: "missing" | "invalid" | "locked";
  /** La comprobación de la clave escrita o de la invitación (`ClientState.accessCheck`). */
  readonly check: "checking" | "wrong" | "unreachable" | null;
  /** Devuelve `false` si la clave no tiene el largo de una clave. */
  readonly onSubmit: (key: string) => boolean;
  /** «Reintentar» tras la espera del bloqueo, con la clave guardada. */
  readonly onRetry: () => void;
  readonly onBack: () => void;
}

export function AccessKey({ reason, check, onSubmit, onRetry, onBack }: AccessKeyProps) {
  const [key, setKey] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const checking = check === "checking";
  const error = invalid
    ? t("access.invalid")
    : check === "wrong"
      ? t("access.wrong")
      : check === "unreachable"
        ? t("access.unreachable")
        : null;
  return (
    <div className="scr">
      <AppHeader />
      <main className="wrap col narrow">
        <div className="stack-l">
          <button className="linkbtn back" type="button" onClick={onBack}>
            <Icon name="back" />
            {t("access.back")}
          </button>
          <div className="stack-s">
            <h1 className="h-l">{t("access.title")}</h1>
            {reason === "locked" ? null : (
              <p className="lead">
                {reason === "invalid" ? t("access.leadInvalid") : t("access.leadMissing")}
              </p>
            )}
          </div>
          {reason === "locked" ? (
            <div className="stack-l">
              <div className="toast err formerr" role="alert">
                <Icon name="alert" />
                <span className="formerr-body">
                  <span>
                    <span className="tkind">{t("access.lockedTitle")}</span>{" "}
                    {t("access.lockedText")}
                  </span>
                </span>
              </div>
              <button className="btn primary lg block" type="button" onClick={onRetry}>
                {t("access.retry")}
              </button>
            </div>
          ) : (
            <form
              className="stack-l"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (checking) return;
                if (!onSubmit(key)) {
                  setInvalid(true);
                  input.current?.focus();
                }
              }}
            >
              <div className="field">
                <label htmlFor="access-key">{t("access.label")}</label>
                <input
                  ref={input}
                  id="access-key"
                  className="input code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={80}
                  value={key}
                  aria-invalid={error !== null}
                  aria-describedby="access-hint access-error"
                  onChange={(event) => {
                    setKey(event.target.value);
                    setInvalid(false);
                  }}
                />
                <p id="access-hint" className="hint">
                  {t("access.hint")}
                </p>
                {error !== null ? (
                  <p id="access-error" className="ferr" role="alert">
                    <Icon name="alert" />
                    <span>{error}</span>
                  </p>
                ) : null}
              </div>
              <button
                className="btn primary lg block"
                type="submit"
                aria-disabled={checking ? "true" : undefined}
              >
                {checking ? t("access.checking") : t("access.submit")}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
