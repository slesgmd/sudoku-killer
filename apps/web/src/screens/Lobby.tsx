// Lobby (design/pantallas.md §1.3): el código con «Copiar código» y «Compartir», los jugadores con
// sus asientos, la dificultad (solo quien inicia la elige) e «Iniciar partida» o el bloque de espera.
// En móvil, la acción principal queda fija al pie.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NORMAL_RULES } from "@sudoku-killer/game/client";
import {
  DIFFICULTIES,
  DIFFICULTY_GIVENS,
  type Difficulty,
  type PublicPlayer,
} from "@sudoku-killer/protocol";
import { AppHeader } from "../components/AppHeader.tsx";
import { NetworkBanner } from "../components/Network.tsx";
import { CopyDialog, LeaveDialog, SettingsDialog, nextStarter } from "../components/Dialogs.tsx";
import { Icon } from "../components/Icon.tsx";
import { Toasts } from "../components/Toasts.tsx";
import { copyText, shareLink, type ShareApi } from "../components/share.ts";
import type { GameClient } from "../game/client.ts";
import { playerName, type ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";

/** Cuánto dura «Código copiado» o «Enlace copiado» en el botón. */
export const COPIED_MS = 3000;

type Dialog = "leave" | "settings" | "copyCode" | "copyLink" | null;

export interface LobbyProps {
  readonly client: GameClient;
  readonly state: ClientState;
  readonly share: ShareApi;
  /** El enlace a la sala (`…/#/sala/CODIGO`). */
  readonly link: string;
  readonly onLeave: () => void;
}

/** «H P Q 6 N Z»: el lector de pantalla lee el código letra por letra. */
function spelled(code: string): string {
  return code.replace(/(.)(?=.)/g, "$1 ");
}

/** «30 números iniciales» o «Sin números iniciales», con la cantidad de la equivalencia versión 2. */
export function givensNote(difficulty: Difficulty): string {
  const count = DIFFICULTY_GIVENS[difficulty];
  return count === 0 ? t("difficulty.noGivens") : t("difficulty.givensNote", { count });
}

export function Lobby({ client, state, share, link, onLeave }: LobbyProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const room = state.room;
  if (!room) return null;
  const code = room.code;
  const starter = room.starterId === state.playerId;
  const starterName = playerName(state, room.starterId);
  const seated = [...state.players]
    .filter((p): p is PublicPlayer & { seat: number } => p.seat !== null)
    .sort((a, b) => a.seat - b.seat);
  const total = NORMAL_RULES.maxSeats;
  const free = Math.max(0, total - seated.length);
  const notice = state.lobbyNotice;

  const flash = (what: "code" | "link") => {
    setCopied(what);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(null);
    }, COPIED_MS);
  };
  const close = () => {
    setDialog(null);
  };

  return (
    <div className="scr">
      <AppHeader
        onSettings={() => {
          setDialog("settings");
        }}
      />
      <NetworkBanner state={state} game={false} />
      <main className="wrap lobby">
        <div className="lobby-head">
          <h1 className="h-l">{t("lobby.title")}</h1>
          <button
            className="linkbtn"
            type="button"
            aria-haspopup="dialog"
            onClick={() => {
              setDialog("leave");
            }}
          >
            {t("lobby.leave")}
          </button>
        </div>

        {notice ? (
          <div className="notice" role="status">
            <Icon name="info" />
            <span>
              {notice.kind === "reset"
                ? t("lobby.reset", { name: notice.by })
                : notice.to === state.playerId
                  ? t("lobby.handoverYou", { name: notice.from })
                  : t("lobby.handover", {
                      name: notice.from,
                      to: playerName(state, notice.to),
                    })}
            </span>
          </div>
        ) : null}
        <Toasts
          toasts={state.toasts}
          onDismiss={(id) => {
            client.dismissToast(id);
          }}
        />

        <div className="lobby-grid">
          <div className="stack-xl">
            <section aria-labelledby="code-title" className="stack-m">
              <h2 id="code-title" className="lbl">
                {t("lobby.code")}
              </h2>
              <p className="code-big" aria-label={spelled(code)}>
                {code}
              </p>
              <div className="row-wrap">
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void copyText(share, code).then((result) => {
                      if (result === "copied") flash("code");
                      else setDialog("copyCode");
                    });
                  }}
                >
                  <Icon name={copied === "code" ? "check" : "copy"} />
                  {copied === "code" ? t("lobby.copied") : t("lobby.copy")}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void shareLink(share, {
                      url: link,
                      title: t("appTitle"),
                      text: t("share.shareText", { code }),
                    }).then((result) => {
                      if (result === "copied") flash("link");
                      else if (result === "manual") setDialog("copyLink");
                    });
                  }}
                >
                  <Icon name={copied === "link" ? "check" : "share"} />
                  {copied === "link" ? t("lobby.linkCopied") : t("lobby.share")}
                </button>
              </div>
              <p className="hint">{t("lobby.codeHint")}</p>
              <p className="sr-only" aria-live="polite">
                {copied === "code"
                  ? t("lobby.copiedLive", { code })
                  : copied === "link"
                    ? t("lobby.linkCopiedLive", { code })
                    : ""}
              </p>
            </section>

            <section aria-labelledby="players-title" className="stack-m">
              <div className="row-between">
                <h2 id="players-title" className="h-sec">
                  {t("lobby.players")}
                </h2>
                <span className="pts small muted">
                  {t("lobby.seats", { count: seated.length, total })}
                </span>
              </div>
              <ul className="prows">
                {seated.map((player) => {
                  const off = player.connection !== "connected";
                  return (
                    <li key={player.id} className="prow">
                      <span
                        className={`mono${off ? " off" : ""}`}
                        aria-hidden="true"
                        style={{ "--pc": client.colorOf(player.id) } as CSSProperties}
                      >
                        {player.nickname.charAt(0).toLocaleUpperCase("es")}
                      </span>
                      <span className="prow-main">
                        <span className="pname">
                          {player.nickname}
                          {player.id === state.playerId ? (
                            <span className="pme">{` · ${t("players.you")}`}</span>
                          ) : null}
                        </span>
                        {player.id === room.starterId ? (
                          <span className="tag strong">{t("players.starter")}</span>
                        ) : null}
                        {off ? <span className="tag">{t("players.disconnected")}</span> : null}
                      </span>
                    </li>
                  );
                })}
                {Array.from({ length: free }, (_, k) => (
                  <li key={`free-${String(k)}`} className="prow free">
                    <span className="mono" aria-hidden="true" />
                    {t("lobby.freeSeat")}
                  </li>
                ))}
              </ul>
              {free === 0 ? (
                <p className="fnote">
                  <Icon name="info" />
                  <span>{t("lobby.full")}</span>
                </p>
              ) : null}
            </section>
          </div>

          <div className="stack-xl">
            {starter ? (
              <fieldset className="stack-m">
                <legend className="h-sec">{t("lobby.difficulty")}</legend>
                <div className="radios">
                  {DIFFICULTIES.map((d) => (
                    <label key={d} className="radio">
                      <input
                        type="radio"
                        name="difficulty"
                        value={d}
                        checked={room.difficulty === d}
                        disabled={state.starting}
                        onChange={() => {
                          client.setDifficulty(d);
                        }}
                      />
                      <span>
                        <span className="rname">{t(`difficulty.${d}`)}</span>
                        <span className="rnote">{givensNote(d)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="hint">{t("lobby.difficultyStarter")}</p>
              </fieldset>
            ) : (
              <section aria-labelledby="difficulty-title" className="stack-m">
                <h2 id="difficulty-title" className="h-sec">
                  {t("lobby.difficulty")}
                </h2>
                <p className="lobby-diff">{t(`difficulty.${room.difficulty}`)}</p>
                <p className="hint">{t("lobby.difficultyOther", { name: starterName })}</p>
              </section>
            )}

            <div className="lobby-act">
              {starter ? (
                <div className="stack-s">
                  <button
                    className="btn primary lg block"
                    type="button"
                    aria-disabled={state.starting ? "true" : undefined}
                    onClick={() => {
                      client.startMatch();
                    }}
                  >
                    {state.starting ? (
                      <>
                        {t("lobby.starting")}
                        <span className="bdots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </>
                    ) : (
                      t("lobby.start")
                    )}
                  </button>
                  <p className="hint">{t("lobby.startHint")}</p>
                </div>
              ) : (
                <div className="waiting" role="status" aria-live="polite">
                  <span className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{t("lobby.waiting", { name: starterName })}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {dialog === "leave" ? (
        <LeaveDialog
          heir={nextStarter(state.players, state.playerId, room.starterId)}
          onCancel={close}
          onConfirm={() => {
            close();
            onLeave();
          }}
        />
      ) : null}
      {dialog === "settings" ? (
        <SettingsDialog
          autoClean={state.settings.autoCleanPersonalNotes}
          useNotes={state.notesEnabled}
          onUseNotes={(value) => {
            client.setNotesEnabled(value);
          }}
          onChange={(value) => {
            client.setAutoClean(value);
          }}
          onClose={close}
        />
      ) : null}
      {dialog === "copyCode" ? (
        <CopyDialog
          title={t("share.codeTitle")}
          text={t("share.codeText")}
          label={t("share.codeLabel")}
          value={code}
          onClose={close}
        />
      ) : null}
      {dialog === "copyLink" ? (
        <CopyDialog
          title={t("share.title")}
          text={t("share.text")}
          label={t("share.label")}
          value={link}
          onClose={close}
        />
      ) : null}
    </div>
  );
}
