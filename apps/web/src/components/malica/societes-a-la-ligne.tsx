/**
 * Une société par ligne — ce que TVA, Charges, les réglages de société et la capture montrent
 * quand l'en-tête dit « Toutes les sociétés » (maquette approuvée le 13 novembre 2026).
 *
 * Deux gestes, une seule liste :
 *  - `ouvrir` : l'écran est celui d'UNE société ; toucher une ligne la montre, et la vue quitte
 *    « Toutes » (l'en-tête le dit) ;
 *  - `choisir` : la pièce va à UNE société ; la ligne prise est celle du dossier ouvert, et la
 *    vue reste « Toutes ».
 * Aucun chiffre : ce que le moteur ne rend pas pour une société ne s'additionne pas (R3).
 */
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";

import { usePme } from "./pme-context";

export function SocietesALaLigne({
  note,
  mode,
}: {
  /** La clé du libellé qui dit pourquoi l'écran est par société. */
  note: MessageKey;
  mode: "ouvrir" | "choisir";
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const triees = [...pme.dossiers].sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <div data-ecran="a-la-ligne" data-famille="papiers" className="a-la-ligne">
      <p className="invite">{t(note)}</p>
      <ul className="lignes" role={mode === "choisir" ? "radiogroup" : undefined}>
        {triees.map((d) => {
          const prise = mode === "choisir" && d.id === pme.tenantId;
          return (
            <li key={d.id}>
              <button
                type="button"
                {...(mode === "choisir" ? { role: "radio", "aria-checked": prise } : {})}
                onClick={() =>
                  mode === "choisir" ? pme.choisirDossier(d.id) : pme.afficherSociete(d.id)
                }
              >
                <span className="bd">
                  <b>{d.name}</b>
                  {prise ? <span>{t("pme.toutes.derniereUtilisee")}</span> : null}
                </span>
                {prise ? (
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                ) : null}
                {mode === "ouvrir" ? (
                  <svg viewBox="0 0 24 24" className="g" aria-hidden>
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Un écran par nature d'UNE société (TVA, Charges) : sous « Toutes », il dit pourquoi et laisse
 * choisir la société, au lieu de montrer celle qui se trouve ouverte sous un en-tête qui dit
 * « Toutes ».
 */
export function UneSocieteALaFois({ children }: { children: ReactNode }) {
  const pme = usePme();
  if (pme.societeAffichee !== null) return <>{children}</>;
  return <SocietesALaLigne note="pme.toutes.parSociete" mode="ouvrir" />;
}

/** Sur une pièce : elle est d'une société, le bandeau la nomme et mène à toutes les pièces. */
export function BandeauSocieteDeLaPiece() {
  const { t } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();
  if (pme.societeAffichee !== null) return null;
  return (
    <div data-ecran="a-la-ligne" data-famille="papiers" className="mb-3">
      <p className="invite">
        {t("pme.toutes.pieceDe", { societe: pme.orgName })}{" "}
        <button
          type="button"
          className="underline"
          onClick={() => void navigate({ to: "/pme/list" })}
        >
          {t("pme.toutes.voirToutesLesPieces")}
        </button>
      </p>
    </div>
  );
}
