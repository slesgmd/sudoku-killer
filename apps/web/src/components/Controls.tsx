// Controles de la partida (docs/diseno.md §5.2–5.4): modo Número / Notas, capa de escritura,
// visibilidad de cada capa, herramientas (Borrar, Deshacer, Pista) y teclado con contadores.
import { flushSync } from "react-dom";
import type { NoteLayer } from "@sudoku-killer/protocol";
import type { GameClient } from "../game/client.ts";
import { remainingByDigit, type ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";

export interface ControlProps {
  readonly state: ClientState;
  readonly client: GameClient;
  /** Controles inactivos (carga o partida terminada). */
  readonly disabled: boolean;
  readonly canPlace: boolean;
}

const press = (pressed: boolean) => (pressed ? "true" : "false");

export function ModeSeg({
  state,
  client,
  disabled,
  canPlace,
  kbd,
}: ControlProps & { readonly kbd: boolean }) {
  const mode = canPlace ? state.mode : "notes";
  return (
    <div className="seg" role="group" aria-label={t("mode.label")}>
      <button
        type="button"
        aria-pressed={press(mode === "number")}
        aria-disabled={disabled || !canPlace ? "true" : undefined}
        onClick={() => {
          if (!disabled && canPlace) client.setMode("number");
        }}
      >
        {t("mode.number")}
        {kbd ? (
          <span className="kbd" aria-hidden="true">
            N
          </span>
        ) : null}
      </button>
      <button
        type="button"
        aria-pressed={press(mode === "notes")}
        aria-disabled={disabled ? "true" : undefined}
        onClick={() => {
          if (!disabled) client.setMode("notes");
        }}
      >
        {t("mode.notes")}
        {kbd ? (
          <span className="kbd" aria-hidden="true">
            N
          </span>
        ) : null}
      </button>
    </div>
  );
}

/** Escritorio: capa de escritura (solo en modo Notas) y visibilidad con etiquetas. */
export function LayersWide({ state, client, disabled, canPlace }: ControlProps) {
  const notesMode = !canPlace || state.mode === "notes";
  return (
    <>
      {notesMode ? (
        <div className="ctlgroup">
          <span className="lbl" id="layer-title">
            {t("layer.label")}{" "}
            <span className="kbd" aria-hidden="true">
              G
            </span>
          </span>
          <div className="seg" role="group" aria-labelledby="layer-title">
            {(["personal", "group"] as const).map((layer) => (
              <button
                key={layer}
                type="button"
                aria-pressed={press(state.layer === layer)}
                aria-disabled={disabled ? "true" : undefined}
                onClick={() => {
                  if (!disabled) client.setLayer(layer);
                }}
              >
                {t(layer === "personal" ? "layer.personal" : "layer.group")}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="ctlgroup">
        <span className="lbl" id="vis-title">
          {t("visibility.label")}
        </span>
        <div className="visrow" role="group" aria-labelledby="vis-title">
          {(["personal", "group"] as const).map((layer) => (
            <VisButton key={layer} state={state} client={client} layer={layer} wide />
          ))}
        </div>
      </div>
    </>
  );
}

function VisButton({
  state,
  client,
  layer,
  wide,
}: {
  readonly state: ClientState;
  readonly client: GameClient;
  readonly layer: NoteLayer;
  readonly wide: boolean;
}) {
  const shown = state.visible[layer];
  // El nombre accesible es completo («Notas personales»); en escritorio se ve la forma corta, que
  // cabe en la columna lateral y está contenida en el nombre (WCAG 2.5.3).
  const name = t(layer === "personal" ? "visibility.personal" : "visibility.group");
  const short = t(layer === "personal" ? "visibility.personalShort" : "visibility.groupShort");
  return (
    <button
      className="btn vis"
      type="button"
      aria-pressed={press(shown)}
      aria-label={name}
      onClick={() => {
        client.toggleVisible(layer);
      }}
    >
      <Icon name={shown ? "eye" : "eyeOff"} />
      {wide ? <span className={layer === "personal" ? "vis-p" : "vis-g"}>{short}</span> : null}
    </button>
  );
}

/** Tableta, móvil y horizontal: capa de escritura y su ojo en una fila. */
export function LayersCompact({ state, client, disabled, canPlace }: ControlProps) {
  const notesMode = !canPlace || state.mode === "notes";
  return (
    <div
      className="layers"
      role="group"
      aria-label={`${t("layer.label")} · ${t("visibility.label")}`}
    >
      {(["personal", "group"] as const).map((layer) => (
        <div key={layer}>
          <button
            className="btn"
            type="button"
            aria-pressed={press(notesMode && state.layer === layer)}
            aria-disabled={disabled || !notesMode ? "true" : undefined}
            onClick={() => {
              if (!disabled && notesMode) client.setLayer(layer);
            }}
          >
            {t(layer === "personal" ? "layer.personal" : "layer.group")}
          </button>
          <VisButton state={state} client={client} layer={layer} wide={false} />
        </div>
      ))}
    </div>
  );
}

export interface ToolsProps extends ControlProps {
  readonly onHint: () => void;
  readonly stack: boolean;
}

/** Por qué la pista no está disponible, o null si lo está. */
export function hintBlock(state: ClientState, canPlace: boolean): string | null {
  if (!canPlace) return t("tool.hintSpectator");
  if ((state.match?.hintsLeft ?? 0) <= 0) return t("tool.hintNone");
  const cell = state.selected;
  if (cell === null || state.locked[cell] || state.pending.has(cell))
    return t("tool.hintPickEmpty");
  return null;
}

export function Tools({ state, client, disabled, canPlace, onHint, stack }: ToolsProps) {
  const notesMode = state.notesEnabled && (!canPlace || state.mode === "notes");
  const hintsLeft = state.match?.hintsLeft ?? 0;
  const blocked = disabled ? t("tool.hintPickEmpty") : hintBlock(state, canPlace);
  const cls = `btn${stack ? " stack" : ""}`;
  const layerName = t(state.layer === "personal" ? "layer.personal" : "layer.group").toLowerCase();
  return (
    <div className="pg-tools">
      {notesMode ? (
        <button
          className={cls}
          type="button"
          aria-disabled={disabled ? "true" : undefined}
          aria-label={t("tool.clearLabel", { layer: layerName })}
          onClick={() => {
            if (!disabled) client.clearNotes();
          }}
        >
          <Icon name="erase" />
          <span>{t("tool.clear")}</span>
        </button>
      ) : null}
      <button
        className={cls}
        type="button"
        aria-disabled={disabled || !state.canUndo ? "true" : undefined}
        aria-label={t("tool.undoLabel")}
        onClick={() => {
          if (!disabled) client.undo();
        }}
      >
        <Icon name="undo" />
        <span>{t("tool.undo")}</span>
      </button>
      <button
        className={cls}
        type="button"
        aria-haspopup="dialog"
        aria-disabled={blocked ? "true" : undefined}
        aria-label={blocked ?? t("tool.hintLabel", { left: hintsLeft })}
        onClick={() => {
          if (!blocked) onHint();
        }}
      >
        <Icon name="hint" />
        <span>
          {t("tool.hint")} <span className="count">{`· ${String(hintsLeft)}`}</span>
        </span>
      </button>
    </div>
  );
}

export function Keypad({ state, client, disabled: blocked, canPlace }: ControlProps) {
  const remaining = remainingByDigit(state);
  const notesMode = state.notesEnabled && (!canPlace || state.mode === "notes");
  // Sin notas, un espectador no puede escribir nada con el teclado.
  const disabled = blocked || (!canPlace && !state.notesEnabled);
  const size = state.match?.puzzle.size ?? 9;
  return (
    <div className="keys pg-keys" role="group" aria-label={t("keypad.label")}>
      {Array.from({ length: size }, (_, i) => {
        const digit = i + 1;
        const left = remaining[digit] ?? 0;
        const done = left <= 0;
        const status = disabled
          ? t("key.unavailable")
          : done
            ? t("key.done")
            : t("key.remaining", { count: left });
        return (
          <button
            key={digit}
            className={`key${done ? " done" : ""}`}
            type="button"
            aria-label={t(notesMode ? "key.note" : "key.number", { digit, remaining: status })}
            aria-disabled={disabled ? "true" : undefined}
            onClick={() => {
              // Sincrónico: el dígito pendiente se ve en el mismo ciclo del toque.
              if (!disabled) {
                flushSync(() => {
                  client.input(digit);
                });
              }
            }}
          >
            {digit}
            <span className="left" aria-hidden="true">
              {done ? "✓" : left}
            </span>
          </button>
        );
      })}
    </div>
  );
}
