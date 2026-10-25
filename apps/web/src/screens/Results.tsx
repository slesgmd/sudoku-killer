// Resultados (design/pantallas.md §1.5): el resultado del equipo, el tiempo, las pistas y el ranking
// de aporte con empates y «Salió». Quien inicia vuelve al lobby; los demás esperan. Sin foto de
// fondo en la v1: el panel va sobre el lienzo (plan de F10).
import { useState, type CSSProperties } from "react";
import type { RankingEntry } from "@sudoku-killer/protocol";
import { AppHeader } from "../components/AppHeader.tsx";
import { NetworkBanner } from "../components/Network.tsx";
import { LeaveDialog, SettingsDialog, nextStarter } from "../components/Dialogs.tsx";
import { Toasts } from "../components/Toasts.tsx";
import type { GameClient } from "../game/client.ts";
import { formatClock, playerName, type ClientState } from "../game/state.ts";
import { joinNames, t } from "../i18n/index.ts";

export interface ResultsProps {
  readonly client: GameClient;
  readonly state: ClientState;
  readonly onLeave: () => void;
}

/** Los grupos de dos o más jugadores que comparten un puesto. */
export function ties(ranking: readonly RankingEntry[]): RankingEntry[][] {
  const groups = new Map<number, RankingEntry[]>();
  for (const entry of ranking)
    groups.set(entry.position, [...(groups.get(entry.position) ?? []), entry]);
  return [...groups.values()].filter((group) => group.length > 1);
}

export function Results({ client, state, onLeave }: ResultsProps) {
  const [dialog, setDialog] = useState<"leave" | "settings" | null>(null);
  const match = state.match;
  const room = state.room;
  if (!match || !room) return null;
  const victory = match.result === "victory";
  const ranking = match.ranking ?? [];
  const tied = ties(ranking);
  const tiedIds = new Set(tied.flat().map((e) => e.playerId));
  const seated = new Set(state.players.filter((p) => p.seat !== null).map((p) => p.id));
  const starter = room.starterId === state.playerId;
  const cells = match.puzzle.size * match.puzzle.size;
  const time = formatClock(Math.max(0, (match.endedAt ?? match.startedAt) - match.startedAt));
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
      <main className="results">
        <section aria-labelledby="results-title" className="results-panel">
          <div className="stack-s">
            <p className="lbl">
              {t("results.kicker", { difficulty: t(`difficulty.${match.puzzle.difficulty}`) })}
            </p>
            <h1 id="results-title" className="h-xl">
              {victory ? t("results.victory") : t("results.defeat")}
            </h1>
            <p className="lead">
              {victory ? t("results.victoryLead", { cells }) : t("results.defeatLead")}
            </p>
          </div>
          <dl className="stats">
            <div>
              <dt>{t("results.time")}</dt>
              <dd>{time}</dd>
            </div>
            <div>
              <dt>{t("results.hints")}</dt>
              <dd>
                {t("results.hintsValue", {
                  used: match.hintsTotal - match.hintsLeft,
                  total: match.hintsTotal,
                })}
              </dd>
            </div>
          </dl>
          <div className="stack-s">
            <table className="rank">
              <caption>{t("results.ranking")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("results.position")}</th>
                  <th scope="col">{t("results.player")}</th>
                  <th scope="col" className="num">
                    {t("results.points")}
                  </th>
                  <th scope="col" className="num">
                    {t("results.mistakes")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((entry) => {
                  const tie = tiedIds.has(entry.playerId);
                  const left = !seated.has(entry.playerId);
                  return (
                    <tr key={entry.playerId}>
                      <td className="pos">
                        <span aria-hidden="true">{entry.position}</span>
                        <span className="sr-only">
                          {t(tie ? "results.positionTieSr" : "results.positionSr", {
                            position: entry.position,
                          })}
                        </span>
                      </td>
                      <td>
                        <span className="rank-player">
                          <span
                            className="mono sm"
                            aria-hidden="true"
                            style={{ "--pc": client.colorOf(entry.playerId) } as CSSProperties}
                          >
                            {entry.nickname.charAt(0).toLocaleUpperCase("es")}
                          </span>
                          <span className="rank-name">
                            <span className="pname">
                              {entry.nickname}
                              {entry.playerId === state.playerId ? (
                                <span className="pme">{` · ${t("players.you")}`}</span>
                              ) : null}
                            </span>
                            {tie ? <span className="tag strong">{t("results.tie")}</span> : null}
                            {left ? <span className="tag">{t("results.left")}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="num">{entry.score}</td>
                      <td className="num">{entry.mistakes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="hint">
              {tied.length > 0
                ? tied
                    .map((group) =>
                      t("results.tieNote", {
                        names: joinNames(group.map((e) => e.nickname)),
                        position: group[0]?.position ?? 0,
                      }),
                    )
                    .join(" ")
                : t("results.ruleNote")}
            </p>
          </div>
          <Toasts
            toasts={state.toasts}
            onDismiss={(id) => {
              client.dismissToast(id);
            }}
          />
          <div className="results-act">
            {starter ? (
              <button
                className="btn primary lg"
                type="button"
                onClick={() => {
                  client.returnToLobby();
                }}
              >
                {t("results.toLobby")}
              </button>
            ) : (
              <div className="waiting" role="status" aria-live="polite">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{t("results.waiting", { name: playerName(state, room.starterId) })}</span>
              </div>
            )}
            <button
              className="btn secondary lg"
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setDialog("leave");
              }}
            >
              {t("results.leave")}
            </button>
          </div>
        </section>
      </main>
      {dialog === "leave" ? (
        <LeaveDialog
          heir={nextStarter(state.players, state.playerId, room.starterId)}
          body={t("results.leaveBody")}
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
    </div>
  );
}
