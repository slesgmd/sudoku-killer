// i18n con claves desde el primer día (ADR 0001): `t(clave, variables)`. Los plurales eligen la
// forma con `Intl.PluralRules` según la variable `count`.
import { es, type Message, type MessageKey } from "./es.ts";

export type { MessageKey } from "./es.ts";

const LOCALE = "es";
const plurals = new Intl.PluralRules(LOCALE);
const catalog: Record<MessageKey, Message> = es;

export type Vars = Readonly<Record<string, string | number>>;

export function t(key: MessageKey, vars: Vars = {}): string {
  const message = catalog[key];
  const template =
    typeof message === "string"
      ? message
      : plurals.select(Number(vars["count"] ?? 0)) === "one"
        ? message.one
        : message.other;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** «Ana», «Ana y Tomás», «Ana, Tomás y Rafa». */
export function joinNames(names: readonly string[]): string {
  return new Intl.ListFormat(LOCALE, { type: "conjunction" }).format(names);
}
