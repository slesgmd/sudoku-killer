// Estados de red dentro de una sala (docs/diseno.md §9): el banner «Reconectando…» o «El servidor no
// responde» mientras dura la situación, y los diálogos bloqueantes de otra pestaña (E-08) y de
// versión incompatible (E-19).
import { useRef } from "react";
import type { ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./Icon.tsx";

/** El banner de la conexión, o nada si está abierta. `game`: con el texto de números y notas. */
export function NetworkBanner({
  state,
  game,
}: {
  readonly state: ClientState;
  readonly game: boolean;
}) {
  const status = state.connection;
  if (status === "unavailable") {
    return (
      <div className="banner err" role="alert">
        <Icon name="alert" />
        <span className="banner-text">
          <strong className="strong">{t("net.unavailable")}</strong> {t("net.unavailableText")}
        </span>
        <span className="bdots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  }
  if (status !== "reconnecting" && status !== "connecting") return null;
  const queued = state.pendingNotes.length;
  const text = game
    ? `${queued > 0 ? t("net.reconnectingQueued", { count: queued }) : t("net.reconnectingNotes")} ${t("net.reconnectingText")}`
    : t("net.reconnectingRoom");
  return (
    <div className="banner" role="status">
      <Icon name="info" />
      <span className="banner-text">
        <strong className="strong">{t("net.reconnecting")}</strong> {text}
      </span>
      <span className="bdots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

/** Los diálogos bloqueantes: sin cancelar ni Esc, con una sola acción. */
export function SessionDialogs({
  state,
  onPlayHere,
  onReload,
}: {
  readonly state: ClientState;
  readonly onPlayHere: () => void;
  readonly onReload: () => void;
}) {
  const action = useRef<HTMLButtonElement>(null);
  const status = state.connection;
  if (status !== "replaced" && status !== "incompatible") return null;
  const replaced = status === "replaced";
  return (
    <Dialog
      title={replaced ? t("net.replacedTitle") : t("net.versionTitle")}
      role="alertdialog"
      initialFocus={action}
      actions={
        <button
          ref={action}
          className="btn primary"
          type="button"
          onClick={replaced ? onPlayHere : onReload}
        >
          {replaced ? t("net.replacedAction") : t("net.versionAction")}
        </button>
      }
    >
      <p>{replaced ? t("net.replacedText") : t("net.versionText")}</p>
    </Dialog>
  );
}
