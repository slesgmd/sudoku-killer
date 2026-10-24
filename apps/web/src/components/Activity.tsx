// Registro de actividad (docs/diseno.md §5.9): lista en escritorio; en el resto, un botón plegable
// con la última entrada. Cada entrada lleva el monograma de su autor y el tiempo de partida.
import { useState, type CSSProperties } from "react";
import { cellName } from "../game/client.ts";
import { formatClock, playerName, type ActivityEntry, type ClientState } from "../game/state.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { Icon } from "./Icon.tsx";

const TEXT: Record<ActivityEntry["kind"], MessageKey> = {
  solved: "activity.solved",
  mistake: "activity.mistake",
  hint: "activity.hint",
  joined: "activity.joined",
  left: "activity.left",
  spectator: "activity.spectator",
};

export function activityText(state: ClientState, entry: ActivityEntry): string {
  const size = state.match?.puzzle.size ?? 9;
  return t(TEXT[entry.kind], {
    name: playerName(state, entry.playerId),
    cell: entry.cell === null ? "" : cellName(entry.cell, size),
  });
}

function Row({
  state,
  entry,
  colorOf,
}: {
  readonly state: ClientState;
  readonly entry: ActivityEntry;
  readonly colorOf: (id: string | null) => string;
}) {
  return (
    <li className="actrow">
      <span
        className="mono xs"
        aria-hidden="true"
        style={{ "--pc": colorOf(entry.playerId) } as CSSProperties}
      >
        {playerName(state, entry.playerId).charAt(0).toLocaleUpperCase("es")}
      </span>
      <span className="atext">{activityText(state, entry)}</span>
      <span className="atime pts">{formatClock(entry.elapsed)}</span>
    </li>
  );
}

export interface ActivityProps {
  readonly state: ClientState;
  readonly colorOf: (playerId: string | null) => string;
  readonly variant: "list" | "fold" | "overlay";
}

export function Activity({ state, colorOf, variant }: ActivityProps) {
  const [open, setOpen] = useState(false);
  const latest = [...state.activity].reverse();
  const last = latest[0];
  if (variant === "overlay") {
    return (
      <ol id="act-list" className="actlist" aria-label={t("activity.label")}>
        {latest.length === 0 ? (
          <li className="actrow">{t("activity.empty")}</li>
        ) : (
          latest.map((entry) => (
            <Row key={entry.key} state={state} entry={entry} colorOf={colorOf} />
          ))
        )}
      </ol>
    );
  }
  if (variant === "list") {
    return (
      <section className="act" aria-labelledby="act-title">
        <h2 id="act-title" className="act-head">
          {t("activity.label")}
        </h2>
        {latest.length === 0 ? (
          <p className="small muted">{t("activity.empty")}</p>
        ) : (
          <ol>
            {latest.slice(0, 8).map((entry) => (
              <Row key={entry.key} state={state} entry={entry} colorOf={colorOf} />
            ))}
          </ol>
        )}
      </section>
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
        <span style={{ fontWeight: "var(--fw-semibold)" }}>{t("activity.label")}</span>
        {last ? (
          <span
            className="mono xs"
            aria-hidden="true"
            style={{ "--pc": colorOf(last.playerId) } as CSSProperties}
          >
            {playerName(state, last.playerId).charAt(0).toLocaleUpperCase("es")}
          </span>
        ) : null}
        <span className="stxt">{last ? activityText(state, last) : t("activity.empty")}</span>
        <Icon name="chevron" />
      </button>
      {open ? (
        <ol id="act-list" className="actlist">
          {latest.length === 0 ? (
            <li className="actrow">{t("activity.empty")}</li>
          ) : (
            latest.map((entry) => (
              <Row key={entry.key} state={state} entry={entry} colorOf={colorOf} />
            ))
          )}
        </ol>
      ) : null}
    </div>
  );
}
