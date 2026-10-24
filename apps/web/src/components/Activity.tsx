// Registro de actividad (docs/diseno.md §5.9): una sola línea con la última entrada y el historial
// completo aparte. En escritorio, la línea va bajo los jugadores con «Ver actividad», que abre el
// historial en un diálogo; en tableta y móvil, la línea es un botón plegable; en horizontal, un botón
// de la cabecera. Los textos de los avisos también quedan aquí (decisión 4 de entrega-f8.md).
import { useRef, useState, type CSSProperties } from "react";
import { cellName } from "../game/client.ts";
import { formatClock, playerName, type ActivityEntry, type ClientState } from "../game/state.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { Dialog } from "./Dialog.tsx";
import { Icon } from "./Icon.tsx";

const TEXT: Record<Exclude<ActivityEntry["kind"], "notice">, MessageKey> = {
  solved: "activity.solved",
  mistake: "activity.mistake",
  hint: "activity.hint",
  joined: "activity.joined",
  left: "activity.left",
  spectator: "activity.spectator",
};

export function activityText(state: ClientState, entry: ActivityEntry): string {
  if (entry.kind === "notice") return entry.text ?? "";
  const size = state.match?.puzzle.size ?? 9;
  return t(TEXT[entry.kind], {
    name: playerName(state, entry.playerId),
    cell: entry.cell === null ? "" : cellName(entry.cell, size),
  });
}

interface RowProps {
  readonly state: ClientState;
  readonly entry: ActivityEntry;
  readonly colorOf: (id: string | null) => string;
}

/** Monograma del autor, o el icono de información en los avisos. */
function Mark({ state, entry, colorOf }: RowProps) {
  if (entry.kind === "notice") {
    return (
      <span className="actmark" aria-hidden="true">
        <Icon name="info" />
      </span>
    );
  }
  return (
    <span
      className="mono xs"
      aria-hidden="true"
      style={{ "--pc": colorOf(entry.playerId) } as CSSProperties}
    >
      {playerName(state, entry.playerId).charAt(0).toLocaleUpperCase("es")}
    </span>
  );
}

function Row(props: RowProps) {
  return (
    <li className="actrow">
      <Mark {...props} />
      <span className="atext">{activityText(props.state, props.entry)}</span>
      <span className="atime pts">{formatClock(props.entry.elapsed)}</span>
    </li>
  );
}

function History({
  state,
  colorOf,
  className,
}: Omit<RowProps, "entry"> & { readonly className: string }) {
  const latest = [...state.activity].reverse();
  return (
    <ol id="act-list" className={className} aria-label={t("activity.label")}>
      {latest.length === 0 ? (
        <li className="actrow">{t("activity.empty")}</li>
      ) : (
        latest.map((entry) => <Row key={entry.key} state={state} entry={entry} colorOf={colorOf} />)
      )}
    </ol>
  );
}

export interface ActivityProps {
  readonly state: ClientState;
  readonly colorOf: (playerId: string | null) => string;
  readonly variant: "line" | "fold" | "overlay";
}

export function Activity({ state, colorOf, variant }: ActivityProps) {
  const [open, setOpen] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const last = state.activity.at(-1);

  if (variant === "overlay") {
    return <History state={state} colorOf={colorOf} className="actlist" />;
  }

  if (variant === "line") {
    return (
      <div className="actline">
        {last ? <Mark state={state} entry={last} colorOf={colorOf} /> : null}
        <span className="stxt">{last ? activityText(state, last) : t("activity.empty")}</span>
        <button
          className="btn ghost"
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t("activity.open")}
        </button>
        {open ? (
          <Dialog
            title={t("activity.label")}
            closeLabel={t("dialog.close")}
            onCancel={() => {
              setOpen(false);
            }}
            initialFocus={close}
            actions={
              <button
                ref={close}
                className="btn secondary"
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t("dialog.close")}
              </button>
            }
          >
            <History state={state} colorOf={colorOf} className="acthistory" />
          </Dialog>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pg-status" style={{ position: "relative" }}>
      <button
        className="btn statusbtn"
        type="button"
        aria-expanded={open}
        aria-controls="act-list"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="act-head">{t("activity.label")}</span>
        {last ? <Mark state={state} entry={last} colorOf={colorOf} /> : null}
        <span className="stxt">{last ? activityText(state, last) : t("activity.empty")}</span>
        <Icon name="chevron" />
      </button>
      {open ? <History state={state} colorOf={colorOf} className="actlist" /> : null}
    </div>
  );
}
