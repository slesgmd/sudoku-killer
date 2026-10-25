// Ayuda (design/pantallas.md §1.6): las reglas y la mecánica cooperativa, con el índice «En esta
// página» (fijo a la izquierda desde 1024 px; desplegable debajo). «Volver» lleva a la pantalla
// anterior. Ajustes solo aparece si se abrió desde una sala (decisión 1).
import { AppHeader } from "../components/AppHeader.tsx";
import { Icon } from "../components/Icon.tsx";
import { t, type MessageKey } from "../i18n/index.ts";

interface Section {
  readonly id: string;
  readonly title: MessageKey;
  readonly paragraphs: readonly MessageKey[];
  readonly bullets?: readonly MessageKey[];
}

const SECTIONS: readonly Section[] = [
  { id: "reglas", title: "help.rules", paragraphs: ["help.rules.1", "help.rules.2"] },
  { id: "equipo", title: "help.team", paragraphs: ["help.team.1", "help.team.2", "help.team.3"] },
  { id: "vidas", title: "help.lives", paragraphs: ["help.lives.1", "help.lives.2"] },
  {
    id: "notas",
    title: "help.notes",
    paragraphs: ["help.notes.1", "help.notes.2"],
    bullets: ["help.notes.3", "help.notes.4"],
  },
  { id: "pistas", title: "help.hints", paragraphs: ["help.hints.1"] },
  {
    id: "simultaneas",
    title: "help.simultaneous",
    paragraphs: ["help.simultaneous.1", "help.simultaneous.2"],
  },
  {
    id: "desconexion",
    title: "help.disconnect",
    paragraphs: ["help.disconnect.1", "help.disconnect.2"],
  },
];

const KEYS: readonly (readonly [readonly string[], MessageKey])[] = [
  [["←", "→", "↑", "↓"], "help.keys.arrows"],
  [["1–9"], "help.keys.digits"],
  [["N"], "help.keys.mode"],
  [["G"], "help.keys.layer"],
  [["Supr"], "help.keys.clear"],
  [["Ctrl", "Z"], "help.keys.undo"],
  [["H"], "help.keys.hint"],
  [["Esc"], "help.keys.escape"],
];

const TOC: readonly { readonly id: string; readonly title: MessageKey }[] = [
  ...SECTIONS,
  { id: "atajos", title: "help.keys" },
];

/** Los enlaces del índice desplazan sin cambiar el hash, que es la ruta de la aplicación. */
function TocLinks() {
  return TOC.map((section) => (
    <a
      key={section.id}
      href={`#${section.id}`}
      onClick={(event) => {
        event.preventDefault();
        const target = document.getElementById(section.id);
        target?.scrollIntoView({ block: "start" });
        target?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
      }}
    >
      {t(section.title)}
    </a>
  ));
}

export function Help({
  onBack,
  onSettings,
}: {
  readonly onBack: () => void;
  readonly onSettings?: (() => void) | undefined;
}) {
  return (
    <div className="scr">
      <AppHeader current="help" onSettings={onSettings} />
      <main className="wrap help">
        <nav className="help-toc" aria-label={t("help.toc")}>
          <p className="lbl">{t("help.toc")}</p>
          <div className="toc">
            <TocLinks />
          </div>
        </nav>

        <article className="help-article">
          <div className="stack-m">
            <button className="linkbtn back" type="button" onClick={onBack}>
              <Icon name="back" />
              {t("help.back")}
            </button>
            <h1 className="h-xl">{t("help.title")}</h1>
            <p className="lead">{t("help.lead")}</p>
          </div>

          <details className="help-toc-m">
            <summary>
              {t("help.toc")}
              <Icon name="chevron" />
            </summary>
            <nav className="toc" aria-label={t("help.toc")}>
              <TocLinks />
            </nav>
          </details>

          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="help-sec"
              aria-labelledby={`h-${section.id}`}
            >
              <h2 id={`h-${section.id}`} tabIndex={-1}>
                {t(section.title)}
              </h2>
              {section.paragraphs.map((key) => (
                <p key={key}>{t(key)}</p>
              ))}
              {section.bullets ? (
                <ul className="dots">
                  {section.bullets.map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section id="atajos" className="help-sec" aria-labelledby="h-atajos">
            <h2 id="h-atajos" tabIndex={-1}>
              {t("help.keys")}
            </h2>
            <table className="kt">
              <tbody>
                {KEYS.map(([keys, what]) => (
                  <tr key={what}>
                    <td className="kt-keys">
                      {keys.map((key) => (
                        <span key={key} className="kbd">
                          {key}
                        </span>
                      ))}
                    </td>
                    <td>{t(what)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </article>
      </main>
    </div>
  );
}
