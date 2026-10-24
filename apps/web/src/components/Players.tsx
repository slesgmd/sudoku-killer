// Jugadores con vidas y puntos (docs/diseno.md §5.5): lista en escritorio, franja desplazable en el
// resto. Siempre con monograma: el color nunca va solo.
import type { CSSProperties } from "react";
import { NORMAL_RULES } from "@sudoku-killer/game/client";
import type { PublicPlayer } from "@sudoku-killer/protocol";
import type { ClientState } from "../game/state.ts";
import { t } from "../i18n/index.ts";
import { Hearts } from "./Icon.tsx";

export interface PlayersProps {
  readonly state: ClientState;
  readonly colorOf: (playerId: string | null) => string;
  readonly variant: "list" | "strip";
  readonly loading: boolean;
}

function tagOf(player: PublicPlayer, starterId: string | null): string | null {
  if (player.connection === "left" || player.connection === "expired") return t("players.left");
  if (player.connection === "disconnected") return t("players.disconnected");
  if (player.role === "spectator") return t("players.spectator");
  if (player.id === starterId && player.role === null) return t("players.starter");
  return null;
}

export function Players({ state, colorOf, variant, loading }: PlayersProps) {
  const total = NORMAL_RULES.initialLives;
  const seated = state.players.filter((p) => p.seat !== null).length;
  const free = Math.max(0, NORMAL_RULES.maxSeats - seated);
  const players = [...state.players].sort(
    (a, b) => (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER),
  );
  const monoStyle = (player: PublicPlayer) => ({ "--pc": colorOf(player.id) }) as CSSProperties;
  const offline = (player: PublicPlayer) => player.connection !== "connected";
  const freeText = t("players.freeSeats", { count: free });

  if (variant === "list") {
    return (
      <>
        <div className="plist-head">
          <h2>{t("players.label")}</h2>
          <span className="lbl pts">{`${String(seated)}/${String(NORMAL_RULES.maxSeats)}`}</span>
        </div>
        <ul className="plist">
          {loading
            ? [0, 1, 2].map((k) => (
                <li key={k} aria-hidden="true">
                  <span className="mono free" />
                  <span className="skel" style={{ width: 96 }} />
                </li>
              ))
            : players.map((player) => {
                const tag = tagOf(player, state.room?.starterId ?? null);
                return (
                  <li key={player.id}>
                    <span
                      className={`mono${offline(player) ? " off" : ""}`}
                      aria-hidden="true"
                      style={monoStyle(player)}
                    >
                      {player.nickname.charAt(0).toLocaleUpperCase("es")}
                    </span>
                    <div className="pmain">
                      <span className="pname">
                        {player.nickname}
                        {player.id === state.playerId ? (
                          <span className="pyou">{` · ${t("players.you")}`}</span>
                        ) : null}
                      </span>
                      {tag ? (
                        <span>
                          <span className="tag">{tag}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="pstats">
                      <span className="pts">
                        {player.score}
                        <span className="sr-only">{` ${t("players.pointsUnit")}`}</span>
                      </span>
                      <Hearts lives={player.lives} total={total} />
                      <span className="sr-only">
                        {t("players.lives", { lives: player.lives, total })}
                      </span>
                    </div>
                  </li>
                );
              })}
          {loading || free === 0 ? null : (
            <li className="pfree">
              <span className="mono free" aria-hidden="true" />
              {freeText}
            </li>
          )}
        </ul>
      </>
    );
  }

  return (
    <div
      className="strip"
      tabIndex={0}
      role="group"
      aria-label={`${t("players.label")}. ${t("players.swipe")}`}
    >
      <ul>
        {loading
          ? [0, 1, 2].map((k) => (
              <li key={k} aria-hidden="true">
                <span className="mono sm free" />
                <span className="skel" style={{ width: 64 }} />
              </li>
            ))
          : players.map((player) => {
              const tag = tagOf(player, state.room?.starterId ?? null);
              return (
                <li key={player.id}>
                  <span
                    className={`mono sm${offline(player) ? " off" : ""}`}
                    aria-hidden="true"
                    style={monoStyle(player)}
                  >
                    {player.nickname.charAt(0).toLocaleUpperCase("es")}
                  </span>
                  <span className="pl">
                    <span className="pl1">
                      {player.nickname}
                      {player.id === state.playerId ? (
                        <span className="pyou">{` · ${t("players.you")}`}</span>
                      ) : null}
                    </span>
                    <span className="pl2">
                      <Hearts lives={player.lives} total={total} />
                      <span className="sr-only">
                        {t("players.lives", { lives: player.lives, total })}
                      </span>
                      <span className="pts">
                        {player.score}
                        <span className="sr-only">{` ${t("players.pointsUnit")}`}</span>
                      </span>
                      {tag ? <span>{`· ${tag}`}</span> : null}
                    </span>
                  </span>
                </li>
              );
            })}
        {loading || free === 0 ? null : (
          <li className="pfree">
            <span className="mono sm free" aria-hidden="true" />
            {freeText}
          </li>
        )}
      </ul>
    </div>
  );
}
