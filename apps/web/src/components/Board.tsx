// Tablero (docs/diseno.md §6): cuadrícula con foco itinerante, `aria-selected` y la etiqueta completa
// de cada celda; jaulas discontinuas con esquinas cóncavas, suma en la franja reservada (variante A),
// notas en posición fija y la tabla de prioridad de estados (§6.3).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cageIndexByCell, digitBit, layoutOf } from "@sudoku-killer/engine/model";
import type { PublicPuzzle } from "@sudoku-killer/protocol";
import { me, playerName, viewNotes, type ClientState } from "../game/state.ts";
import { joinNames, t } from "../i18n/index.ts";

/** Medidas que salen de la celda (§3, «Tablero»; mismas fórmulas que el prototipo). */
export function cellVars(cellPx: number): CSSProperties {
  const sumFs = Math.max(10, Math.round(cellPx * 0.17));
  const sumH = sumFs + 1;
  const rowH = (cellPx - 1 - (sumH + 1) - 5) / 3;
  const nFs = Math.max(8, Math.round(Math.min(rowH * 0.95, rowH * 0.62 + 3)));
  const badge = Math.max(12, Math.round(cellPx * 0.22));
  const px = (n: number) => `${String(n)}px`;
  return {
    "--cell": px(cellPx),
    "--sum-fs": px(sumFs),
    "--sum-h": px(sumH),
    "--dg-fs": px(Math.round(cellPx * 0.52)),
    "--dg-top": px(sumH),
    "--n-fs": px(nFs),
    "--band": px(sumH),
    "--badge": px(badge),
    "--badge-fs": px(Math.max(9, Math.round(badge * 0.68))),
    "--ear": px(Math.max(7, Math.round(cellPx * 0.18))),
  } as CSSProperties;
}

/** Ancho de un elemento, medido (en las pruebas, sin `ResizeObserver`, usa `fallback`). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

interface Geometry {
  readonly size: number;
  readonly cageOf: Int16Array;
  /** Celda ancla (la de menor índice) de cada jaula. */
  readonly anchors: Set<number>;
  /** Segmentos de la línea de jaula de cada celda (sin el grosor). */
  readonly segments: readonly (readonly string[])[];
  readonly boxOf: Uint8Array;
}

function geometryOf(puzzle: PublicPuzzle): Geometry {
  const layout = layoutOf(puzzle);
  const size = puzzle.size;
  const cageOf = cageIndexByCell(layout.cellCount, puzzle.cages);
  const anchors = new Set(puzzle.cages.map((cage) => Math.min(...cage.cells)));
  const same = (cell: number, dr: number, dc: number) => {
    const r = Math.floor(cell / size) + dr;
    const c = (cell % size) + dc;
    return r >= 0 && r < size && c >= 0 && c < size && cageOf[r * size + c] === cageOf[cell];
  };
  const segments = Array.from({ length: layout.cellCount }, (_, i) => {
    const up = same(i, -1, 0);
    const down = same(i, 1, 0);
    const left = same(i, 0, -1);
    const right = same(i, 0, 1);
    const segs: string[] = [];
    if (!up) segs.push(`t${left ? " xl" : ""}${right ? " xr" : ""}`);
    if (!down) segs.push(`b${left ? " xl" : ""}${right ? " xr" : ""}`);
    if (!left) segs.push(`l${up ? " xt" : ""}${down ? " xb" : ""}`);
    if (!right) segs.push(`r${up ? " xt" : ""}${down ? " xb" : ""}`);
    if (up && right && !same(i, -1, 1)) segs.push("ktr-h", "ktr-v");
    if (up && left && !same(i, -1, -1)) segs.push("ktl-h", "ktl-v");
    if (down && right && !same(i, 1, 1)) segs.push("kbr-h", "kbr-v");
    if (down && left && !same(i, 1, -1)) segs.push("kbl-h", "kbl-v");
    return segs;
  });
  return { size, cageOf, anchors, segments, boxOf: layout.boxOf };
}

export interface BoardProps {
  readonly state: ClientState;
  /** Color (`var(--player-N)`) de un jugador. */
  readonly colorOf: (playerId: string | null) => string;
  readonly onSelect: (cell: number) => void;
  /** Lupa: solo la celda seleccionada, ampliada. Es una ayuda visual: la información ya está en la cuadrícula. */
  readonly single?: boolean;
}

function initial(name: string): string {
  return name.charAt(0).toLocaleUpperCase("es");
}

export function Board({ state, colorOf, onSelect, single = false }: BoardProps) {
  const puzzle = state.match?.puzzle;
  const geometry = useMemo(() => (puzzle ? geometryOf(puzzle) : null), [puzzle]);
  const [ref, width] = useWidth(single ? 88 : 336);
  const grid = useRef<HTMLDivElement>(null);
  const loading = state.phase === "entering" || state.phase === "loading" || !geometry;
  const ended = state.phase === "ended";
  const selected = ended ? null : state.selected;

  // El foco sigue a la selección cuando ya estaba en el tablero (flechas).
  useEffect(() => {
    if (single || selected === null) return;
    const board = grid.current;
    if (!board?.contains(document.activeElement)) return;
    board.querySelector<HTMLButtonElement>(`[data-cell="${String(selected)}"]`)?.focus();
  }, [selected, single]);

  const size = geometry?.size ?? 9;
  const group = state.visible.group ? viewNotes(state, "group") : null;
  const personal = state.visible.personal ? viewNotes(state, "personal") : null;
  const myId = me(state)?.id ?? null;
  const selLocked = selected === null ? null : (state.locked[selected]?.value ?? null);
  const presenceAt = new Map<number, string[]>();
  for (const [playerId, cell] of state.presence) {
    if (cell === null || playerId === myId) continue;
    presenceAt.set(cell, [...(presenceAt.get(cell) ?? []), playerId]);
  }
  const related = (i: number) => {
    if (selected === null || !geometry || i === selected) return false;
    return (
      Math.floor(i / size) === Math.floor(selected / size) ||
      i % size === selected % size ||
      geometry.boxOf[i] === geometry.boxOf[selected] ||
      geometry.cageOf[i] === geometry.cageOf[selected]
    );
  };

  const renderCell = (i: number) => {
    const row = Math.floor(i / size);
    const col = i % size;
    const cageIndex = geometry?.cageOf[i] ?? -1;
    const cage = puzzle?.cages[cageIndex];
    const isSel = !single && i === selected;
    const hot = !single && selected !== null && geometry?.cageOf[selected] === cageIndex;
    const lock = state.locked[i] ?? null;
    const pending = lock ? undefined : state.pending.get(i);
    const flash = lock ? undefined : state.flashes.get(i);
    const kind = lock ? lock.source : pending ? "pend" : flash ? "err" : "empty";
    const digit = lock?.value ?? (pending && pending.digit > 0 ? pending.digit : flash?.digit);
    const g = kind === "empty" && group ? (group[i] ?? 0) : 0;
    const p = kind === "empty" && personal ? (personal[i] ?? 0) : 0;
    const presence = single ? [] : (presenceAt.get(i) ?? []);
    const same = !single && !isSel && selLocked !== null && lock?.value === selLocked;
    const isRelated = !single && related(i);

    const classes = ["sk-gc"];
    if (!single) {
      if (col === 0) classes.push("c0");
      if (row === 0) classes.push("r0");
      if (col % 3 === 2) classes.push("bxr");
      if (row % 3 === 2) classes.push("bxb");
    }
    if (kind !== "empty") classes.push(kind);
    if (isRelated) classes.push("rel");
    if (isSel) classes.push("sel");
    if (same) classes.push("same");

    // Etiqueta completa (§7).
    const parts = [t("cell.position", { row: row + 1, col: col + 1 })];
    if (cage) parts.push(t("cell.cage", { sum: cage.sum }));
    const value = digit ?? "";
    if (kind === "given") parts.push(t("cell.given", { value }));
    else if (kind === "solved" || kind === "hint") {
      const by = lock?.by ?? null;
      const key =
        kind === "solved"
          ? by === myId
            ? "cell.solvedYou"
            : "cell.solved"
          : by === myId
            ? "cell.hintYou"
            : "cell.hint";
      parts.push(t(key, { value, name: playerName(state, by) }));
    } else if (kind === "pend") parts.push(t("cell.pending", { value }));
    else if (kind === "err")
      parts.push(t("cell.mistake", { name: playerName(state, flash?.by ?? null), digit: value }));
    else {
      parts.push(t("cell.empty"));
      const digits = (mask: number) =>
        joinNames(
          Array.from({ length: size }, (_, d) => d + 1)
            .filter((d) => mask & digitBit(d))
            .map(String),
        );
      if (g) parts.push(t("cell.groupNotes", { digits: digits(g) }));
      if (p) parts.push(t("cell.personalNotes", { digits: digits(p) }));
    }
    if (same) parts.push(t("cell.sameDigit"));
    if (presence.length > 0) {
      const names = joinNames(presence.map((id) => playerName(state, id)));
      parts.push(t(presence.length > 1 ? "cell.presenceMany" : "cell.presence", { names }));
    }

    const firstPresence = presence[0] ?? null;
    return (
      <div
        key={i}
        className={classes.join(" ")}
        role={single ? "presentation" : "gridcell"}
        aria-selected={single ? undefined : isSel}
        data-related={isRelated || undefined}
      >
        {loading
          ? null
          : (geometry.segments[i] ?? []).map((seg) => (
              <i key={seg} className={`cg ${seg}${hot ? " hot" : ""}`} aria-hidden="true" />
            ))}
        {!loading && cage && geometry.anchors.has(i) ? (
          <span className="sum" aria-hidden="true">
            {cage.sum}
          </span>
        ) : null}
        {g || p ? (
          <span className="notes" aria-hidden="true">
            {Array.from({ length: 9 }, (_, d) => {
              const bit = digitBit(d + 1);
              const inG = (g & bit) !== 0;
              const inP = (p & bit) !== 0;
              const cls = inG && inP ? "gp" : inG ? "g" : inP ? "p" : "";
              return (
                <span key={d} className={`n ${cls}`}>
                  {inG || inP ? d + 1 : ""}
                </span>
              );
            })}
          </span>
        ) : null}
        {digit !== undefined ? (
          <span className="dg" aria-hidden="true">
            <span className="dgt">{digit}</span>
            {kind === "err" && flash ? (
              <span className="who" style={{ "--pc": colorOf(flash.by) } as CSSProperties}>
                {initial(playerName(state, flash.by))}
              </span>
            ) : null}
          </span>
        ) : null}
        {kind === "pend" ? (
          <span className="wait" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        {kind === "hint" ? <span className="ear" aria-hidden="true" /> : null}
        {firstPresence !== null ? (
          <>
            <span
              className="pres"
              aria-hidden="true"
              style={{ "--pc": colorOf(firstPresence) } as CSSProperties}
            />
            <span
              className="ptag"
              aria-hidden="true"
              style={{ "--pc": colorOf(firstPresence) } as CSSProperties}
            >
              {initial(playerName(state, firstPresence))}
              {presence.length > 1 ? `+${String(presence.length - 1)}` : ""}
            </span>
          </>
        ) : null}
        {isSel ? <span className="sk-selring" aria-hidden="true" /> : null}
        {single ? null : (
          <button
            className="sk-btn"
            type="button"
            data-cell={i}
            tabIndex={i === (selected ?? 0) ? 0 : -1}
            aria-label={parts.join(", ")}
            disabled={loading || ended}
            onClick={() => {
              onSelect(i);
            }}
          />
        )}
      </div>
    );
  };

  if (single) {
    const cell = state.selected ?? 0;
    return (
      <div ref={ref} style={{ width: "100%" }} aria-hidden="true">
        <div className="sk-board one" style={cellVars(width)}>
          <div className="sk-row" role="presentation">
            {renderCell(cell)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <div
        ref={grid}
        className="sk-board"
        role="grid"
        aria-label={t("board.label")}
        aria-busy={loading || undefined}
        style={cellVars(width / size)}
      >
        {Array.from({ length: size }, (_, row) => (
          <div key={row} className="sk-row" role="row">
            {Array.from({ length: size }, (_, col) => renderCell(row * size + col))}
          </div>
        ))}
      </div>
    </div>
  );
}
