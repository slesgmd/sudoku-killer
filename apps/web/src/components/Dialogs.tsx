// Diálogos de la partida (docs/diseno.md §9): confirmación de pista, de salida y Ajustes.
import { useRef, type RefObject } from "react";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import type { PublicPlayer } from "@sudoku-killer/protocol";
import { t } from "../i18n/index.ts";
import { Dialog } from "./Dialog.tsx";

export function HintDialog({
  cell,
  hintsLeft,
  onConfirm,
  onCancel,
}: {
  readonly cell: string;
  readonly hintsLeft: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t("hint.title", { cell })}
      onCancel={onCancel}
      initialFocus={cancel}
      actions={
        <>
          <button ref={cancel} className="btn secondary" type="button" onClick={onCancel}>
            {t("dialog.cancel")}
          </button>
          <button className="btn primary" type="button" onClick={onConfirm}>
            {t("hint.confirm")}
          </button>
        </>
      }
    >
      {/* H sale de los parámetros vigentes (F6), nunca escrito a mano. */}
      <p>{t("hint.cost", { points: PARAMS_V1.hintPenalty })}</p>
      <p>{t("hint.left", { count: hintsLeft })}</p>
    </Dialog>
  );
}

/**
 * Quién recibe el derecho de iniciar si sale `me`: el jugador con asiento más antiguo (R-11). Solo
 * importa si `me` lo tiene (decisión 2).
 */
export function nextStarter(
  players: readonly PublicPlayer[],
  me: string | null,
  starterId: string | null,
): PublicPlayer | null {
  if (me === null || starterId !== me) return null;
  const others = players.filter((p) => p.id !== me && p.seat !== null);
  return others.sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? null;
}

export function LeaveDialog({
  heir,
  onConfirm,
  onCancel,
}: {
  readonly heir: PublicPlayer | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const stay = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t("leave.title")}
      role="alertdialog"
      onCancel={onCancel}
      initialFocus={stay}
      actions={
        <>
          <button ref={stay} className="btn secondary" type="button" onClick={onCancel}>
            {t("leave.stay")}
          </button>
          <button className="btn danger" type="button" onClick={onConfirm}>
            {t("leave.confirm")}
          </button>
        </>
      }
    >
      <p>{t("leave.body")}</p>
      {heir ? <p>{t("leave.starter", { name: heir.nickname })}</p> : null}
    </Dialog>
  );
}

/** Un interruptor de Ajustes (§5.8): etiqueta, ayuda y «Sí» / «No» bajo la pista. */
function Switch({
  label,
  help,
  checked,
  onChange,
  switchRef,
}: {
  readonly label: string;
  readonly help: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly switchRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={switchRef}
      className="switch"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="stext">
        <span className="slabel">{label}</span>
        <span className="shelp">{help}</span>
      </span>
      <span className="sside" aria-hidden="true">
        <span className="track" />
        <span className="sstate">{checked ? t("settings.on") : t("settings.off")}</span>
      </span>
    </button>
  );
}

/**
 * Ajustes: el foco inicial va al primer interruptor (docs/diseno.md §7). «Usar notas» es una
 * preferencia local del navegador; la limpieza automática se guarda en el servidor.
 */
export function SettingsDialog({
  useNotes,
  onUseNotes,
  autoClean,
  onChange,
  onClose,
}: {
  readonly useNotes: boolean;
  readonly onUseNotes: (value: boolean) => void;
  readonly autoClean: boolean;
  readonly onChange: (value: boolean) => void;
  readonly onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t("settings.title")}
      closeLabel={t("dialog.close")}
      onCancel={onClose}
      initialFocus={first}
      actions={
        <button className="btn secondary" type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      }
    >
      <Switch
        switchRef={first}
        label={t("settings.useNotes")}
        help={t("settings.useNotesHelp")}
        checked={useNotes}
        onChange={onUseNotes}
      />
      <Switch
        label={t("settings.autoClean")}
        help={t("settings.autoCleanHelp")}
        checked={autoClean}
        onChange={onChange}
      />
      <p className="small muted">{t("settings.motion")}</p>
    </Dialog>
  );
}
