/**
 * Arrêter la règle de change d'un dossier (R10 ; revue de #148).
 *
 * La source du cours, le jour retenu, le recul jusqu'au dernier cours publié
 * et la règle d'écart sont des défauts livrés par Malica, à confirmer par un
 * expert-comptable. Le cabinet les arrête — pour ce dossier, ou pour tout le
 * cabinet — par le même geste que la déclaration de TVA
 * (`ArreterUnParametrage`). La base vérifie qui décide et ce qui se décide
 * (`app.regle_de_change_arreter`) ; les pièces en devise se rejugent à leur
 * ouverture.
 */
import { useQuery } from "@tanstack/react-query";

import { ArreterUnParametrage } from "@/components/malica/arreter-un-parametrage";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/arreter-la-regle-de-change";

/** Le nom de chaque code de la règle (`ref.socle_params`, `change.*`). */
const NOM: Record<string, MessageKey> = {
  "change.source": "change.regle.source",
  "change.date_retenue": "change.regle.date_retenue",
  "change.recul_jours": "change.regle.recul_jours",
  "change.ecart": "change.regle.ecart",
};

export function ArreterLaRegleDeChange({
  cabinetId,
  dossierId,
  packId,
  periode,
}: {
  cabinetId: string;
  dossierId: string;
  packId: string;
  /** Le mois affiché : la décision vaut à partir de son premier jour. */
  periode: string;
}) {
  const { t, locale } = useI18n();
  const depuis = `${periode}-01`;
  const regle = useQuery({
    queryKey: ["regle-de-change", packId, dossierId, depuis, locale],
    queryFn: () => office().referential.regleDeChange(packId, dossierId, depuis, locale),
  });
  // Une lecture refusée se dit ; elle ne laisse pas un écran muet.
  if (regle.isError)
    return (
      <section className="border border-border bg-card p-4">
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {texteDeLErreur(regle.error, OU, t("common.error"))}
        </p>
      </section>
    );
  const valeurs = regle.data?.valeurs ?? [];
  if (valeurs.length === 0) return null;

  return (
    <section className="border border-border bg-card p-4">
      <ArreterUnParametrage
        titre={t("change.regle.titre")}
        aide={[t("change.regle.aide"), t("tva.affectation.aide.portee")]}
        valeurs={valeurs.map((v) => ({
          cle: v.code,
          libelle: NOM[v.code] ? t(NOM[v.code]!) : v.code,
          valeur: v.valeur ?? "",
          origine: v.origine,
          options: v.options,
        }))}
        arretee={{ titre: t("change.regle.arretee"), detail: t("change.regle.arretee.detail") }}
        arreter={(portee, choix) =>
          office().parametrage.arreterRegleDeChange({
            cabinetId,
            portee,
            porteeId: portee === "dossier" ? dossierId : cabinetId,
            packId,
            depuis,
            valeurs: valeurs.map((v) => ({ code: v.code, valeur: choix[v.code] || null })),
          })
        }
        invalider={["regle-de-change"]}
        contexte={[cabinetId, dossierId, periode]}
      />
    </section>
  );
}
