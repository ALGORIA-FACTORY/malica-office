/**
 * La feuille du crayon : corriger une composante de la facture lue.
 *
 * ================================================================= POURQUOI
 *
 * 10 novembre 2026, décision du dirigeant : un crayon à côté de chaque
 * composante de la facture, comme pour le nom du tiers et le type de la pièce.
 * La feuille monte du bas, montre LA ZONE DE LA PHOTO du champ au-dessus de la
 * saisie, puis — la correction inscrite — le message du JUGEMENT.
 *
 * ================================================================ CE QU'ELLE NE FAIT PAS
 *
 *   — elle ne calcule rien : « la facture tombe juste » est la réponse du
 *     moteur déterministe (`JugementDUneCorrection`), jamais un calcul d'écran ;
 *   — elle ne lit pas un flottant : la saisie passe par `saisieDecimale` et
 *     `refusDeSaisie` du Socle, aux décimales de la devise du référentiel ;
 *   — elle ne bloque pas : une facture qui ne ferme pas se dit, et la personne
 *     continue.
 *
 * Le texte rappelle, une fois et simplement : on corrige ce que la machine a
 * mal lu, on ne change pas la facture.
 */
import { useRef, useState, type ReactNode } from "react";

import { FeuilleDuBas } from "@/components/malica/feuille-du-bas";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n } from "@/i18n";
import { phraseDuRefus } from "@/lib/refus-de-saisie";
import type { JugementDUneCorrection } from "@malica/socle/ports/repositories";
import { saisieDecimale } from "@malica/socle/saisie-decimale";

/**
 * Ce que la saisie est : un montant (les décimales de la devise du référentiel),
 * une quantité, un libellé, ou un code de TVA CHOISI dans la liste du
 * référentiel à la date de la pièce — jamais un taux saisi (R4).
 */
export type GenreDeSaisie = "montant" | "quantite" | "texte" | "code";

/** Les décimales d'une quantité : la borne que la base pose (`precision_de_lecture`). */
const DECIMALES_DE_QUANTITE = 6;

/** Un code de TVA du référentiel, avec son libellé traduit. */
export interface ChoixDeTva {
  code: string;
  label: string;
  taux: string;
}

export function FeuilleDeCorrection({
  champ,
  genre = "montant",
  choix = [],
  lu,
  devise,
  decimales,
  zone,
  enCours,
  erreur,
  jugement,
  montantsRetenus,
  champsAVerifier,
  onEnregistrer,
  onFermer,
  onEncore,
  onValider,
}: {
  /** Le nom du champ, dans la langue de la personne (« TVA », « Total »). */
  champ: string;
  genre?: GenreDeSaisie;
  /** Les codes de TVA parmi lesquels choisir (`genre = "code"`) ; vide tant qu'ils se chargent. */
  choix?: readonly ChoixDeTva[];
  /** Ce que la lecture a lu, tel qu'on l'affiche ; `null` si rien n'a été lu. */
  lu: string | null;
  devise: string;
  /** Les décimales de la devise du référentiel (R4), pour un montant. */
  decimales: number;
  /** La zone de la photo (`ZoneDeLaPhoto`). */
  zone: ReactNode;
  enCours: boolean;
  /** Le refus, dit dans la langue de la personne. */
  erreur: string | null;
  /** Le jugement rendu après l'enregistrement ; `null` tant que la personne saisit. */
  jugement: JugementDUneCorrection | null;
  /** Les montants que le moteur retient, déjà libellés, quand la facture ferme. */
  montantsRetenus: Array<{ libelle: string; valeur: string }>;
  /** Les champs à vérifier, déjà libellés, quand elle ne ferme pas. */
  champsAVerifier: string[];
  onEnregistrer: (canonique: string) => void;
  onFermer: () => void;
  onEncore: () => void;
  onValider: () => void;
}) {
  const { t, locale } = useI18n();
  const feuille = useRef<HTMLDivElement | null>(null);
  const [saisie, setSaisie] = useState("");
  useSuperposition(true, onFermer, feuille);

  const [choisi, setChoisi] = useState<string | null>(null);
  const bornes = genre === "quantite" ? DECIMALES_DE_QUANTITE : decimales;
  const decimal = genre === "montant" || genre === "quantite";
  const canonique = decimal
    ? saisieDecimale(saisie)
    : genre === "code"
      ? choisi
      : saisie.replace(/\s+/g, " ").trim() || null;
  const refus = decimal ? phraseDuRefus(saisie, bornes) : null;
  const peutEnregistrer = !enCours && canonique !== null && refus === null;

  return (
    <FeuilleDuBas
      titre={t("pme.crayon.titre", { champ })}
      onFermer={onFermer}
      feuilleRef={feuille}
      disposition="flex flex-col gap-3.5 overflow-y-auto"
    >
      {jugement === null ? (
        <>
          {zone}
          <p className="num text-[13px] text-text-2">
            {lu !== null ? t("pme.crayon.lu", { valeur: lu }) : t("pme.crayon.luRien")}
          </p>
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (peutEnregistrer && canonique !== null) onEnregistrer(canonique);
            }}
          >
            {genre === "code" ? (
              <div
                role="radiogroup"
                aria-label={t("pme.crayon.champCode")}
                className="grid gap-1.5"
              >
                <p className="text-[12px] font-semibold text-text-2">{t("pme.crayon.champCode")}</p>
                {choix.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    role="radio"
                    aria-checked={choisi === c.code}
                    disabled={enCours}
                    onClick={() => setChoisi(c.code)}
                    className={`flex min-h-[48px] items-center justify-between gap-3 rounded-xl border px-3 text-start text-[14px] ${
                      choisi === c.code
                        ? "border-2 border-foreground font-semibold"
                        : "border-border"
                    }`}
                  >
                    <span>
                      <span className="num font-semibold">{c.code}</span>
                      <span className="text-text-2"> · {c.label}</span>
                    </span>
                    <span aria-hidden>{choisi === c.code ? "●" : "○"}</span>
                  </button>
                ))}
                {choix.length === 0 ? (
                  <p className="text-[12.5px] text-text-2">{t("common.loading")}</p>
                ) : null}
              </div>
            ) : (
              <>
                <label htmlFor="valeur-corrigee" className="text-[12px] font-semibold text-text-2">
                  {genre === "montant"
                    ? t("pme.crayon.champ", { devise })
                    : genre === "quantite"
                      ? t("pme.crayon.champQuantite")
                      : t("pme.crayon.champTexte")}
                </label>
                <input
                  id="valeur-corrigee"
                  type="text"
                  inputMode={decimal ? "decimal" : "text"}
                  dir={decimal ? "ltr" : "auto"}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={decimal ? undefined : 200}
                  autoFocus
                  value={saisie}
                  disabled={enCours}
                  onChange={(e) => setSaisie(e.target.value)}
                  aria-invalid={refus !== null}
                  aria-describedby="valeur-corrigee-aide"
                  className={`min-h-[48px] rounded-xl border border-border bg-background px-3 text-[17px] font-semibold text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground ${decimal ? "num" : ""}`}
                />
              </>
            )}
            <p id="valeur-corrigee-aide" className="text-[12.5px] leading-[1.45] text-text-2">
              {t("pme.crayon.aide")}
            </p>
            {refus !== null ? (
              <p
                role="alert"
                className="border-s-4 border-signal-stop ps-2 text-[12.5px] leading-[1.45]"
              >
                {t(refus, { max: bornes })}
              </p>
            ) : null}
            {erreur ? (
              <p
                role="alert"
                className="border-s-4 border-signal-stop ps-2 text-[12.5px] leading-[1.45]"
              >
                {erreur}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!peutEnregistrer}
              className="min-h-[48px] rounded-xl bg-foreground px-4 text-[14.5px] font-semibold text-background disabled:opacity-40"
            >
              {enCours ? t("common.loading") : t("pme.crayon.enregistrer")}
            </button>
            <button
              type="button"
              onClick={onFermer}
              disabled={enCours}
              className="min-h-[44px] text-[13.5px] font-semibold"
            >
              {t("common.cancel")}
            </button>
          </form>
        </>
      ) : jugement.ferme ? (
        <div className="grid gap-3" role="status" data-testid="correction-ferme">
          {/* Le texte est à l'encre (contraste AAA) ; la couleur du sens est la barre. */}
          <p className="border-s-4 border-signal-ok ps-3 text-[16px] font-semibold leading-[1.35]">
            {t("pme.crayon.ferme")}
          </p>
          <div className="border border-border bg-card p-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-2">
              {t("pme.crayon.retenus")}
            </p>
            {montantsRetenus.map((m) => (
              <div key={m.libelle} className="flex items-baseline justify-between gap-3 py-0.5">
                <span className="text-[13.5px]">{m.libelle}</span>
                <span className="num text-[13.5px] font-semibold">
                  {m.valeur} {devise}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onValider}
            className="min-h-[48px] rounded-xl bg-foreground px-4 text-[14.5px] font-semibold text-background"
          >
            {t("pme.crayon.valider")}
          </button>
        </div>
      ) : (
        <div className="grid gap-3" role="status" data-testid="correction-ne-ferme-pas">
          <p className="border-s-4 border-signal-warn ps-3 text-[16px] font-semibold leading-[1.35]">
            {t("pme.crayon.neFermePas")}
          </p>
          {champsAVerifier.length > 0 ? (
            <p className="text-[13.5px] leading-[1.5]">
              {t("pme.crayon.aVerifier", {
                champs: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
                  champsAVerifier,
                ),
              })}
            </p>
          ) : null}
          <p className="text-[13px] leading-[1.45] text-text-2">{t("pme.crayon.sansBloquer")}</p>
          <button
            type="button"
            onClick={onEncore}
            className="min-h-[48px] rounded-xl bg-foreground px-4 text-[14.5px] font-semibold text-background"
          >
            {t("pme.crayon.encore")}
          </button>
          <button
            type="button"
            onClick={onFermer}
            className="min-h-[44px] text-[13.5px] font-semibold"
          >
            {t("common.fermer")}
          </button>
        </div>
      )}
    </FeuilleDuBas>
  );
}
