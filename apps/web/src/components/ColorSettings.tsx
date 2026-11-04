// Colores personales en Ajustes (SPEC, R-42 y R-43): vista previa en vivo, Aleatorio y un selector por
// elemento. Los selectores son radios nativos: las flechas, Tab y el grupo deshabilitado son del
// navegador. Los colores salen de los tokens: sin colores en atributos `style`.
import { useId } from "react";
import type { GameClient } from "../game/client.ts";
import type { ColorChange } from "../game/color-prefs.ts";
import { layerShown, type ClientState } from "../game/state.ts";
import { t, type MessageKey } from "../i18n/index.ts";
import { cageSegments, cellVars, colorAttrs } from "./Board.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Switch } from "./Switch.tsx";

const COLOR_NAMES: readonly MessageKey[] = [
  "color.0",
  "color.1",
  "color.2",
  "color.3",
  "color.4",
  "color.5",
  "color.6",
  "color.7",
  "color.8",
  "color.9",
];

function ColorField({
  label,
  icon,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly icon: IconName;
  readonly value: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  const name = useId();
  return (
    <fieldset className="colorfield" disabled={disabled}>
      <legend>
        <Icon name={icon} />
        {label}
      </legend>
      <div className="swatches">
        {COLOR_NAMES.map((key, option) => (
          <label key={key} className="swatch" data-color={option} title={t(key)}>
            <input
              type="radio"
              name={name}
              aria-label={t(key)}
              checked={value === option}
              onChange={() => {
                onChange(option);
              }}
            />
            <span className="dot" aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Dos jaulas en una cuadrícula de 2 × 3, con notas de las dos capas. */
const PREVIEW_ROWS = 2;
const PREVIEW_COLS = 3;
const PREVIEW_CELL = 56;
const PREVIEW_CAGES = [0, 0, 1, 0, 1, 1] as const;
const PREVIEW_SEGMENTS = cageSegments(PREVIEW_ROWS, PREVIEW_COLS, PREVIEW_CAGES);
const PREVIEW_SUMS = new Map([
  [0, 12],
  [2, 9],
]);
/** Colores de ejemplo de las dos jaulas con Aleatorio. */
const PREVIEW_RANDOM = [1, 6] as const;
/** El dígito que se ve en negrita. */
const PREVIEW_STRONG = 5;
/** Las notas de cada celda: grupales y personales. */
const PREVIEW_NOTES: readonly { readonly g: readonly number[]; readonly p: readonly number[] }[] = [
  { g: [1], p: [4] },
  { g: [3, 5], p: [5] },
  { g: [2], p: [8] },
  { g: [], p: [7] },
  { g: [6], p: [6] },
  { g: [9], p: [] },
];

function ColorPreview({ state }: { readonly state: ClientState }) {
  const showGroup = layerShown(state, "group");
  const showPersonal = layerShown(state, "personal");
  return (
    <div className="cpreview">
      <div
        className="sk-board preview"
        role="img"
        aria-label={t("settings.preview")}
        style={cellVars(PREVIEW_CELL)}
        {...colorAttrs(state.colors)}
      >
        {Array.from({ length: PREVIEW_ROWS }, (_, row) => (
          <div key={row} className="sk-row">
            {Array.from({ length: PREVIEW_COLS }, (_, col) => {
              const cell = row * PREVIEW_COLS + col;
              const cage = PREVIEW_CAGES[cell] ?? 0;
              const notes = PREVIEW_NOTES[cell];
              const sum = PREVIEW_SUMS.get(cell);
              return (
                <div
                  key={cell}
                  className="sk-gc"
                  data-cage-color={state.colors.random ? PREVIEW_RANDOM[cage] : undefined}
                >
                  {(PREVIEW_SEGMENTS[cell] ?? []).map((seg) => (
                    <i key={seg} className={`cg ${seg}`} />
                  ))}
                  {sum === undefined ? null : <span className="sum">{sum}</span>}
                  <span className="notes">
                    {Array.from({ length: 9 }, (_, d) => {
                      const digit = d + 1;
                      const inG = showGroup && (notes?.g.includes(digit) ?? false);
                      const inP = showPersonal && (notes?.p.includes(digit) ?? false);
                      const cls = inG && inP ? "gp" : inG ? "g" : inP ? "p" : "";
                      const strong = digit === PREVIEW_STRONG && cls !== "" ? " strong" : "";
                      return (
                        <span key={d} className={`n ${cls}${strong}`}>
                          {cls === "" ? "" : digit}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorSettings({
  client,
  state,
}: {
  readonly client: GameClient;
  readonly state: ClientState;
}) {
  const { colors } = state;
  const change = (value: ColorChange) => {
    client.setColors(value);
  };
  return (
    <>
      <h3 className="settings-h">{t("settings.colors")}</h3>
      <ColorPreview state={state} />
      <Switch
        label={t("settings.random")}
        help={t("settings.randomHelp")}
        checked={colors.random}
        onChange={(random) => {
          change({ random });
        }}
      />
      <ColorField
        label={t("settings.cage")}
        icon="cage"
        value={colors.cage}
        disabled={colors.random}
        onChange={(cage) => {
          change({ cage });
        }}
      />
      <ColorField
        label={t("settings.sum")}
        icon="sum"
        value={colors.sum}
        disabled={colors.random}
        onChange={(sum) => {
          change({ sum });
        }}
      />
      <ColorField
        label={t("settings.notePersonal")}
        icon="note"
        value={colors.personal}
        disabled={!state.notesEnabled || !state.personalNotesEnabled}
        onChange={(personal) => {
          change({ personal });
        }}
      />
      <ColorField
        label={t("settings.noteGroup")}
        icon="note"
        value={colors.group}
        disabled={!state.notesEnabled}
        onChange={(group) => {
          change({ group });
        }}
      />
    </>
  );
}
