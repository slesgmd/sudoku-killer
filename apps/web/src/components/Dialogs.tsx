// Diálogos (docs/diseno.md §9): confirmación de pista, de salida, Ajustes y el enlace para copiarlo a
// mano cuando no hay portapapeles.
import { useEffect, useId, useRef } from "react";
import { PARAMS_V1 } from "@sudoku-killer/scoring";
import type { PublicPlayer } from "@sudoku-killer/protocol";
import type { GameClient } from "../game/client.ts";
import type { ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { ColorSettings } from "./ColorSettings.tsx";
import { Dialog } from "./Dialog.tsx";
import { Switch } from "./Switch.tsx";

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
      {/* H sale de los parámetros vigentes, nunca escrito a mano. */}
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
  body = t("leave.body"),
  onConfirm,
  onCancel,
}: {
  readonly heir: PublicPlayer | null;
  /** En Resultados: «Dejarás tu asiento libre y no estarás en la próxima partida.» */
  readonly body?: string;
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
      <p>{body}</p>
      {heir ? <p>{t("leave.starter", { name: heir.nickname })}</p> : null}
    </Dialog>
  );
}

/**
 * Ajustes: el foco inicial va al primer interruptor (docs/diseno.md §7). «Usar notas», «Notas
 * personales» y los colores son preferencias locales del navegador; la limpieza automática se guarda
 * en el servidor. Sin «Usar notas» no hay notas que mostrar ni que colorear.
 */
export function SettingsDialog({
  client,
  state,
  onClose,
}: {
  readonly client: GameClient;
  readonly state: ClientState;
  readonly onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t("settings.title")}
      closeLabel={t("dialog.close")}
      onCancel={onClose}
      initialFocus={first}
      wide
      actions={
        <>
          <button
            className="btn secondary push"
            type="button"
            onClick={() => {
              client.resetColors();
            }}
          >
            {t("settings.reset")}
          </button>
          <button className="btn secondary" type="button" onClick={onClose}>
            {t("dialog.close")}
          </button>
        </>
      }
    >
      <Switch
        switchRef={first}
        label={t("settings.useNotes")}
        help={t("settings.useNotesHelp")}
        checked={state.notesEnabled}
        onChange={(value) => {
          client.setNotesEnabled(value);
        }}
      />
      <Switch
        label={t("settings.personalNotes")}
        help={t("settings.personalNotesHelp")}
        checked={state.personalNotesEnabled}
        disabled={!state.notesEnabled}
        onChange={(value) => {
          client.setPersonalNotesEnabled(value);
        }}
      />
      <Switch
        label={t("settings.autoClean")}
        help={t("settings.autoCleanHelp")}
        checked={state.settings.autoCleanPersonalNotes}
        onChange={(value) => {
          client.setAutoClean(value);
        }}
      />
      <p className="small muted">{t("settings.motion")}</p>
      <ColorSettings client={client} state={state} />
    </Dialog>
  );
}

/** Sin hoja de compartir ni portapapeles: el texto queda seleccionado para copiarlo a mano. */
export function CopyDialog({
  title,
  text,
  label,
  value,
  onClose,
}: {
  readonly title: string;
  readonly text: string;
  readonly label: string;
  readonly value: string;
  readonly onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    input.current?.select();
  }, []);
  return (
    <Dialog
      title={title}
      closeLabel={t("dialog.close")}
      onCancel={onClose}
      initialFocus={input}
      actions={
        <button className="btn secondary" type="button" onClick={onClose}>
          {t("dialog.close")}
        </button>
      }
    >
      <p>{text}</p>
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          ref={input}
          id={id}
          className="input"
          readOnly
          value={value}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
      </div>
    </Dialog>
  );
}
