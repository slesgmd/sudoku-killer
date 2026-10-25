// Pantalla de partida (design/pantallas.md §1.4) en las cuatro disposiciones, con los atajos de
// teclado (docs/diseno.md §7) y los estados que produce el modo simulado (entrega-f8.md §3).
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Activity, activityText } from "../components/Activity.tsx";
import { Board } from "../components/Board.tsx";
import {
  Keypad,
  LayersCompact,
  LayersWide,
  ModeSeg,
  Tools,
  hintBlock,
} from "../components/Controls.tsx";
import { HintDialog, LeaveDialog, SettingsDialog, nextStarter } from "../components/Dialogs.tsx";
import { Icon } from "../components/Icon.tsx";
import { Players } from "../components/Players.tsx";
import { NetworkBanner } from "../components/Network.tsx";
import { Toasts } from "../components/Toasts.tsx";
import { useLayout } from "../components/useLayout.ts";
import { cellName, type GameClient } from "../game/client.ts";
import { defeatTexts } from "./Results.tsx";
import { elapsedMs, formatClock, me, type ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";

type DialogKind = "hint" | "leave" | "settings" | null;

const NO_TIME = "––:––";

/** Cronómetro: se refresca cada segundo con la hora del servidor estimada (R-07, T-07.2). */
function Timer({
  state,
  client,
  className,
}: {
  readonly state: ClientState;
  readonly client: GameClient;
  readonly className: string;
}) {
  const [, setTick] = useState(0);
  const running = state.phase === "playing";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  const text = state.match ? formatClock(elapsedMs(state, client.clientNow())) : NO_TIME;
  return (
    <span className={`pts ${className}`} role="timer" aria-live="off">
      {text}
    </span>
  );
}

export function GameScreen({
  client,
  state,
  onLeave,
}: {
  readonly client: GameClient;
  readonly state: ClientState;
  /** Al confirmar la salida; por defecto, solo sale de la sala. */
  readonly onLeave?: () => void;
}) {
  const layout = useLayout();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const colorOf = useCallback((playerId: string | null) => client.colorOf(playerId), [client]);
  const match = state.match;
  const size = match?.puzzle.size ?? 9;
  const loading = state.phase === "entering" || state.phase === "loading" || !match;
  const ended = state.phase === "ended";
  // Sin servidor se bloquea todo lo que se envía (docs/diseno.md §9).
  const offline = state.connection === "unavailable";
  const disabled = loading || ended || offline;
  const networkIssue =
    offline || state.connection === "reconnecting" || state.connection === "connecting";
  const self = me(state);
  const canPlace = client.canPlace();
  const spectator = self?.role === "spectator";
  const wide = layout === "desktop" || layout === "tablet";
  const compact = !wide;
  const hintsText = match ? `${String(match.hintsLeft)}/${String(match.hintsTotal)}` : "–";
  const difficulty = state.room ? t(`difficulty.${state.room.difficulty}`) : "";
  const selectedName = state.selected === null ? "" : cellName(state.selected, size);

  const openHint = useCallback(() => {
    if (!disabled && hintBlock(client.getState(), client.canPlace()) === null) setDialog("hint");
  }, [client, disabled]);

  // Atajos de teclado (§7): flechas, 1–9, N, G, Supr, Ctrl+Z y H. Esc lo maneja cada diálogo.
  useEffect(() => {
    if (dialog !== null) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select")) return;
      if (event.altKey) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl) {
        if (event.key.toLowerCase() === "z" && !disabled) {
          event.preventDefault();
          client.undo();
        }
        return;
      }
      const arrows: Record<string, readonly [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      const arrow = arrows[event.key];
      if (arrow && !disabled) {
        event.preventDefault();
        client.move(arrow[0], arrow[1]);
        return;
      }
      if (/^[1-9]$/.test(event.key) && !disabled) {
        client.input(Number(event.key));
        return;
      }
      switch (event.key.toLowerCase()) {
        case "n":
          if (!disabled) client.toggleMode();
          return;
        case "g":
          if (!disabled) client.toggleLayer();
          return;
        case "delete":
        case "backspace":
          if (!disabled) {
            event.preventDefault();
            client.clearNotes();
          }
          return;
        case "h":
          openHint();
          return;
        case "escape":
          setMenuOpen(false);
          return;
      }
    };
    // Sincrónico: la jugada se ve en la celda en el mismo ciclo del evento (jugada inmediata).
    const onKey = (event: KeyboardEvent) => {
      flushSync(() => {
        handle(event);
      });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [client, dialog, disabled, openHint]);

  const close = () => {
    setDialog(null);
  };
  const lastActivity = state.activity.at(-1);
  const notes = state.notesEnabled;
  const toasts = (
    <Toasts
      toasts={state.toasts}
      onDismiss={(id) => {
        client.dismissToast(id);
      }}
    />
  );
  const spectatorNotice =
    spectator && !ended ? (
      <div className="notice" role="status">
        <Icon name="info" />
        <span>{t("state.spectatorNotice")}</span>
      </div>
    ) : null;
  const controls = { state, client, disabled, canPlace };
  const tools = <Tools {...controls} onHint={openHint} stack={layout === "desktop"} />;

  return (
    <div className="pg">
      <header className="pg-head">
        {wide ? (
          <>
            <div className="pg-headl">
              {layout === "desktop" ? <span className="brand">{t("appTitle")}</span> : null}
              <dl className="pg-meta">
                <div>
                  <dt className="lbl">{t("head.room")}</dt>
                  <dd className="pts pg-code">{state.room?.code ?? ""}</dd>
                </div>
                <div>
                  <dt className="sr-only">{t("head.difficulty")}</dt>
                  <dd>{difficulty}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="time" label={t("head.time")} />
                  </dt>
                  <dd>
                    <Timer state={state} client={client} className="timer" />
                  </dd>
                </div>
                <div>
                  <dt style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Icon name="hint" />
                    <span>{t("head.hints")}</span>
                  </dt>
                  <dd className="pts" style={{ fontWeight: "var(--fw-semibold)" }}>
                    {hintsText}
                  </dd>
                </div>
              </dl>
            </div>
            <nav className="pg-nav" aria-label={t("head.menu")}>
              <button
                className="btn ghost"
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setDialog("settings");
                }}
              >
                {t("head.settings")}
              </button>
              <button
                className="btn"
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setDialog("leave");
                }}
              >
                <Icon name="leave" />
                {t("head.leave")}
              </button>
            </nav>
          </>
        ) : (
          <>
            <div className="pg-room">
              <span className="sr-only">{t("head.room")}</span>
              <span className="pts pg-code">{state.room?.code ?? ""}</span>
              <span className="lbl">{difficulty}</span>
            </div>
            <div className="pg-compact">
              <span>
                <Icon name="time" label={t("head.time")} />
                <Timer state={state} client={client} className="timer" />
              </span>
              <span>
                <Icon name="hint" label={t("head.hints")} />
                <span className="pts" style={{ fontWeight: "var(--fw-semibold)" }}>
                  {hintsText}
                </span>
              </span>
              {layout === "landscape" ? (
                <button
                  className="btn ghost"
                  type="button"
                  aria-label={t("head.activity")}
                  aria-expanded={activityOpen}
                  aria-controls="act-list"
                  onClick={() => {
                    setActivityOpen(!activityOpen);
                  }}
                >
                  <Icon name="list" />
                </button>
              ) : null}
              <button
                className="btn ghost"
                type="button"
                aria-label={t("head.menu")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  setMenuOpen(!menuOpen);
                }}
              >
                <Icon name="dots" />
              </button>
            </div>
            {menuOpen ? (
              <div className="menu" role="menu" aria-label={t("head.menu")}>
                <button
                  className="btn"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog("settings");
                  }}
                >
                  {t("head.settings")}
                </button>
                <button
                  className="btn"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog("leave");
                  }}
                >
                  {t("head.menuLeave")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </header>

      {(ended && match) || networkIssue ? (
        <div className="pg-banner">
          <div className="banners">
            <NetworkBanner state={state} game />
            {ended && match ? (
              <div className="banner" role="status">
                <Icon name="info" />
                <span className="banner-text">
                  {match.result === "victory"
                    ? t("ended.victory", {
                        time: formatClock(elapsedMs(state, client.clientNow())),
                      })
                    : t("ended.defeat", { reason: defeatTexts(match.defeatCause).title })}
                </span>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    client.viewResults();
                  }}
                >
                  {t("ended.results")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="pg-board">
        <Board
          state={state}
          colorOf={colorOf}
          onSelect={(cell) => {
            flushSync(() => {
              client.select(cell);
            });
          }}
        />
        {loading ? (
          <div className="pg-loading" role="status" aria-live="polite">
            <span>
              <span className="bdots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t("loading")}
            </span>
          </div>
        ) : null}
      </div>

      <section className="pg-players" aria-label={t("players.label")}>
        {layout === "desktop" ? (
          <>
            <Players state={state} colorOf={colorOf} variant="list" loading={loading} />
            {spectatorNotice}
            {toasts}
            <Activity state={state} colorOf={colorOf} variant="line" />
          </>
        ) : (
          <>
            {spectatorNotice}
            <Players state={state} colorOf={colorOf} variant="strip" loading={loading} />
          </>
        )}
      </section>

      <div className="pg-side">
        {layout === "desktop" ? (
          <>
            {notes ? (
              <>
                <div className="ctlgroup">
                  <ModeSeg {...controls} kbd />
                </div>
                <LayersWide {...controls} />
              </>
            ) : null}
            <Keypad {...controls} />
            {tools}
          </>
        ) : (
          <>
            {layout === "landscape" ? <div className="pg-toastover">{toasts}</div> : null}
            {layout === "landscape" ? null : state.toasts.length > 0 ? (
              toasts
            ) : (
              <Activity state={state} colorOf={colorOf} variant="fold" />
            )}
            {notes ? (
              <div className="pg-ctl">
                {compact ? (
                  <figure className="lupa">
                    <Board state={state} colorOf={colorOf} onSelect={() => undefined} single />
                    {layout === "mobile" && state.selected !== null ? (
                      <figcaption className="pts">
                        {t("magnifier", { cell: selectedName })}
                      </figcaption>
                    ) : null}
                  </figure>
                ) : null}
                <div className="ctl-stack">
                  <ModeSeg {...controls} kbd={false} />
                  <LayersCompact {...controls} />
                </div>
              </div>
            ) : null}
            {compact ? tools : null}
            <Keypad {...controls} />
            {compact ? null : tools}
          </>
        )}
        <div className="sr-only" role="log" aria-live="polite">
          {lastActivity ? activityText(state, lastActivity) : ""}
        </div>
      </div>

      {layout === "landscape" && activityOpen ? (
        <Activity state={state} colorOf={colorOf} variant="overlay" />
      ) : null}
      {dialog === "hint" && match ? (
        <HintDialog
          cell={selectedName}
          hintsLeft={match.hintsLeft}
          onCancel={close}
          onConfirm={() => {
            close();
            client.useHint();
          }}
        />
      ) : null}
      {dialog === "leave" ? (
        <LeaveDialog
          heir={nextStarter(state.players, state.playerId, state.room?.starterId ?? null)}
          onCancel={close}
          onConfirm={() => {
            close();
            if (onLeave) onLeave();
            else client.leave();
          }}
        />
      ) : null}
      {dialog === "settings" ? (
        <SettingsDialog
          autoClean={state.settings.autoCleanPersonalNotes}
          useNotes={notes}
          onUseNotes={(value) => {
            client.setNotesEnabled(value);
          }}
          onChange={(value) => {
            client.setAutoClean(value);
          }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
