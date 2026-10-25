// «Clave del grupo» (F12, R-39): aparece cuando el servidor cierra con 4003 porque falta la clave o
// la guardada no vale. La clave se escribe una sola vez y queda en el dispositivo; al continuar se
// repite lo que se estaba haciendo. El enlace de invitación (`#k=`) evita escribirla.
import { useRef, useState } from "react";
import { AppHeader } from "../components/AppHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import { t } from "../i18n/index.ts";

export interface AccessKeyProps {
  readonly reason: "missing" | "invalid";
  /** Devuelve `false` si la clave no tiene el largo de una clave. */
  readonly onSubmit: (key: string) => boolean;
  readonly onBack: () => void;
}

export function AccessKey({ reason, onSubmit, onBack }: AccessKeyProps) {
  const [key, setKey] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
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
            <p className="lead">
              {reason === "invalid" ? t("access.leadInvalid") : t("access.leadMissing")}
            </p>
          </div>
          <form
            className="stack-l"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
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
                aria-invalid={invalid}
                aria-describedby="access-hint access-error"
                onChange={(event) => {
                  setKey(event.target.value);
                  setInvalid(false);
                }}
              />
              <p id="access-hint" className="hint">
                {t("access.hint")}
              </p>
              {invalid ? (
                <p id="access-error" className="ferr" role="alert">
                  <Icon name="alert" />
                  <span>{t("access.invalid")}</span>
                </p>
              ) : null}
            </div>
            <button className="btn primary lg block" type="submit">
              {t("access.submit")}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
