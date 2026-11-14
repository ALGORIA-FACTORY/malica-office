/**
 * Une société par ligne — ce que TVA, Charges, les réglages de société et la capture montrent
 * quand l'en-tête dit « Toutes les sociétés » (maquette approuvée le 13 novembre 2026).
 *
 * Deux gestes, une seule liste :
 *  - `ouvrir` : l'écran est celui d'UNE société ; toucher une ligne la montre, et la vue quitte
 *    « Toutes » (l'en-tête le dit) ;
 *  - `choisir` : la pièce va à UNE société ; la ligne prise est celle du dossier ouvert, et la
 *    vue reste « Toutes ».
 * Un écran qui a un chiffre (TVA, Charges) le montre sur chaque ligne : celui que le moteur du Socle
 * rend pour CETTE société, dans sa devise, ou l'état qui dit pourquoi il n'y en a pas. Jamais de
 * total : ce que le moteur ne rend pas ne s'additionne pas (R3).
 */
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";

import { useChiffresParSociete, type NatureDuChiffre } from "@/hooks/use-chiffres-par-societe";
import type { ChiffreDeLaLigne } from "@/hooks/use-chiffres-par-societe";
import { montant } from "@/lib/lisible";

import { usePme } from "./pme-context";

/** Ce qu'un écran par société montre sur chaque ligne : sa nature de chiffre et son mois. */
export interface ChiffreDeLEcran {
  nature: NatureDuChiffre;
  periode: string;
}

/** La légende d'une ligne : ce que le chiffre est, ou la raison de son absence. */
function legendeDe(
  t: ReturnType<typeof useI18n>["t"],
  nature: NatureDuChiffre,
  c: ChiffreDeLaLigne,
) {
  switch (c.etat) {
    case "enCours":
      return t("pme.toutes.chiffre.enCours");
    case "illisible":
      return t("pme.toutes.chiffre.indisponible");
    case "calcule":
      if (nature === "charges") return t("pme.toutes.chiffre.charges");
      return c.sens === "du"
        ? t("pme.tva.aPayer")
        : c.sens === "credit"
          ? t("pme.tva.credit")
          : c.sens === "nul"
            ? t("pme.tva.soldeNul")
            : t("pme.tva.soldeInconnu");
    default:
      return t(`pme.toutes.etat.${c.etat}`);
  }
}

export function SocietesALaLigne({
  note,
  mode,
  chiffre,
}: {
  /** La clé du libellé qui dit pourquoi l'écran est par société. */
  note: MessageKey;
  mode: "ouvrir" | "choisir";
  /** Le chiffre de chaque société, quand l'écran en a un. */
  chiffre?: ChiffreDeLEcran;
}) {
  const { t, locale } = useI18n();
  const pme = usePme();
  const chiffres = useChiffresParSociete(
    chiffre?.nature ?? "tva",
    chiffre?.periode ?? "",
    chiffre !== undefined,
  );
  const triees = [...pme.dossiers].sort((a, b) => a.name.localeCompare(b.name, locale));

  return (
    <div data-ecran="a-la-ligne" data-famille="papiers" className="a-la-ligne">
      <p className="invite">{t(note)}</p>
      <ul className="lignes" role={mode === "choisir" ? "radiogroup" : undefined}>
        {triees.map((d) => {
          const prise = mode === "choisir" && d.id === pme.tenantId;
          const c = chiffre ? chiffres.get(d.id) : undefined;
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
                  {c ? <span data-chiffre={c.etat}>{legendeDe(t, chiffre!.nature, c)}</span> : null}
                </span>
                {c?.etat === "calcule" ? (
                  <span className="mt" dir="ltr">
                    {montant(c.sens === "credit" ? c.montant.replace(/^-/, "") : c.montant, locale)}{" "}
                    <small>{c.devise}</small>
                  </span>
                ) : null}
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
export function UneSocieteALaFois({
  children,
  chiffre,
}: {
  children: ReactNode;
  chiffre?: ChiffreDeLEcran;
}) {
  const pme = usePme();
  if (pme.societeAffichee !== null) return <>{children}</>;
  return (
    <SocietesALaLigne
      note="pme.toutes.parSociete"
      mode="ouvrir"
      {...(chiffre ? { chiffre } : {})}
    />
  );
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
