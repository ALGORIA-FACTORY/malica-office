/**
 * Arrêter la déclaration de TVA d'un dossier (R10 ; revue Codex de #145).
 *
 * Les lignes de la déclaration sont un défaut livré par Malica. Le cabinet
 * choisit pour chaque sens et chaque nature la ligne qui la reçoit — pour ce
 * dossier, ou pour tout le cabinet — et l'arrête. La base vérifie qui décide
 * (`app.tva_affecter`). Le geste est celui de tout paramétrage arrêté
 * (`ArreterUnParametrage`).
 */
import type { SensDeTva } from "@malica/socle/contracts/tva.v1";
import type { DeclarationTva } from "@malica/socle/ports/repositories";

import { ArreterUnParametrage } from "@/components/malica/arreter-un-parametrage";
import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

const SENS: Record<SensDeTva, MessageKey> = {
  collectee: "pme.tva.col.collectee",
  deductible: "pme.tva.col.deductible",
};

export function ArreterLaDeclaration({
  cabinetId,
  dossierId,
  packId,
  periode,
  declaration,
}: {
  cabinetId: string;
  dossierId: string;
  packId: string;
  /** Le mois affiché : la décision vaut à partir de sa déclaration. */
  periode: string;
  declaration: DeclarationTva;
}) {
  const { t } = useI18n();
  const cle = (a: { sens: string; nature: string }) => `${a.sens}|${a.nature}`;
  const nomDeLaNature = (code: string) =>
    declaration.natures.find((n) => n.code === code)?.label ?? code;

  return (
    <ArreterUnParametrage
      titre={t("tva.affectation.titre")}
      aide={[t("tva.affectation.aide"), t("tva.affectation.aide.portee")]}
      valeurs={declaration.affectations.map((a) => ({
        cle: cle(a),
        libelle: `${t(SENS[a.sens])} · ${nomDeLaNature(a.nature)}`,
        valeur: a.ligne ?? "",
        origine: a.origine,
        options: declaration.lignes
          .filter((l) => l.sens === a.sens)
          .map((l) => ({ code: l.code, label: l.label })),
      }))}
      arretee={{ titre: t("tva.affectation.arretee"), detail: t("tva.affectation.arretee.detail") }}
      arreter={(portee, choix) =>
        office().parametrage.arreterDeclarationTva({
          cabinetId,
          portee,
          porteeId: portee === "dossier" ? dossierId : cabinetId,
          packId,
          depuis: `${periode}-01`,
          affectations: declaration.affectations.map((a) => ({
            sens: a.sens,
            nature: a.nature,
            ligne: choix[cle(a)] || null,
          })),
        })
      }
      invalider={["declaration-tva"]}
      contexte={[cabinetId, dossierId, periode]}
    />
  );
}
