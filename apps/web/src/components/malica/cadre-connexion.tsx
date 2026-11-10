/**
 * Le cadre de la page de connexion : à gauche le panneau « preuve » — une
 * écriture, sa référence, et le trait qui la relie au passage de la pièce d'où
 * elle vient —, à droite le formulaire. Même composition que la connexion de
 * Regalica Desk, aux couleurs et aux mots de Malica Office.
 *
 * Le panneau preuve est décoratif (le message est le titre qui l'accompagne) :
 * il est masqué aux lecteurs d'écran, et la feuille de style ne le dessine pas
 * sous 900 px — rien n'est construit pour être caché.
 */
import type { ReactNode } from "react";

import { LanguageSwitcher } from "@/components/malica/LanguageSwitcher";
import { useI18n } from "@/i18n";
import "@/styles-connexion.css";

const EDITEUR = "ALGORIA FACTORY";

/** La pièce source, en largeurs de lignes (%) ; `cite` = le passage dont l'écriture dépend. */
const LIGNES: ReadonlyArray<{ w: number; vide?: boolean; cite?: boolean }> = [
  { w: 100 }, { w: 92 }, { w: 96 }, { w: 64 },
  { w: 100, vide: true }, { w: 88 }, { w: 95 }, { w: 90 }, { w: 48 },
  { w: 100, cite: true }, { w: 62, cite: true },
  { w: 94, vide: true }, { w: 98 }, { w: 72 },
  { w: 100, vide: true }, { w: 86 }, { w: 40 },
  { w: 97, vide: true }, { w: 91 },
];

function Preuve() {
  const { t } = useI18n();
  const cites = LIGNES.filter((l) => l.cite);
  return (
    <figure className="cx-proof" aria-hidden="true">
      <div className="cx-claim">
        <p>{t("auth.proof.claim")}</p>
        <div className="cx-ref">
          <span className="cx-cite">[1]</span>
          <span>{t("auth.proof.ref")}</span>
        </div>
      </div>
      <span className="cx-link" />
      <span className="cx-dot" />
      <div className="cx-page">
        <div className="cx-page-head">{t("auth.proof.page")}</div>
        <hr />
        {LIGNES.map((l, i) =>
          l.cite ? (
            LIGNES[i - 1]?.cite ? null : (
              <div key={i} className="cx-cited">
                {cites.map((c, j) => (
                  <span key={j} className="cx-line" style={{ width: `${c.w}%` }} />
                ))}
              </div>
            )
          ) : (
            <span
              key={i}
              className={l.vide ? "cx-line cx-gap" : "cx-line"}
              style={{ width: `${l.w}%` }}
            />
          ),
        )}
      </div>
    </figure>
  );
}

export function CadreConnexion({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="cx pt-safe">
      <aside className="cx-art" aria-label={t("auth.eyebrow")}>
        <span className="cx-mark" aria-hidden="true" />
        <Preuve />
        <h2 className="cx-hero">
          {t("auth.hero.1")}
          <br />
          <strong>{t("auth.hero.2")}</strong>
        </h2>
      </aside>
      <main className="cx-panel">
        <header className="cx-top">
          <span className="cx-brand">
            <span className="cx-mark" aria-hidden="true" />
            {t("brand.name")}
          </span>
          <LanguageSwitcher />
        </header>
        <div className="cx-content">{children}</div>
        <footer className="cx-foot">
          <p className="cx-principle">{t("auth.principle")}</p>
          <span className="cx-copy">
            © {new Date().getFullYear()} {EDITEUR}
          </span>
        </footer>
      </main>
    </div>
  );
}
