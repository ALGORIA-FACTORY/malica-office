/**
 * Réglages comptabilité — ce que le cabinet arrête, sujet par sujet (R10).
 *
 * ================================================================= POURQUOI
 *
 * Le 31 octobre 2026, le dirigeant a tranché onze arbitrages comptables et
 * fiscaux (immobilisation, FODEC, timbre, change, avoirs…) : « tout ceci on
 * peut les paramétrer dans la partie réglages comptabilité ». Chaque choix est
 * un DÉFAUT du pack, à confirmer par un expert-comptable ; le cabinet le
 * confirme ou le change, pour lui ou pour un dossier.
 *
 * Une ligne par sujet, par le même geste que la déclaration de TVA et la
 * règle de change (`ArreterUnParametrage`) : la valeur, d'où elle vient, la
 * liste des options, la puce « à confirmer » tant que le défaut n'est pas
 * arrêté, et le ⓘ qui porte le texte, la pratique, le risque, l'INCERTAIN en
 * rouge, ce que le pack impute aujourd'hui et les sources. Confirmer sans
 * rien changer est une décision. Un réglage que le Socle n'applique pas
 * encore le dit sur sa ligne. Tout texte vient du référentiel : l'écran
 * n'écrit ni compte, ni seuil, ni article.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { ReglagesComptables as Reglages } from "@malica/socle/ports/repositories";

import type { ParagrapheDAide } from "@/components/malica/aide";
import { ArreterUnParametrage } from "@/components/malica/arreter-un-parametrage";
import { EmptyState, SectionTitle } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnChiffres } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

const OU = "components/malica/reglages-comptables";
const CABINET = "";

type Sujet = Reglages["sujets"][number];
type I18n = ReturnType<typeof useI18n>;

export function ReglagesComptables({
  cabinetId,
  packId,
  jour,
}: {
  cabinetId: string;
  packId: string;
  /** Le jour du cabinet : les réglages se lisent à ce jour. */
  jour: string;
}) {
  const { t, locale } = useI18n();
  const [dossier, setDossier] = useState(CABINET);
  /*
   * La date d'effet d'une décision : par défaut le début de l'exercice en
   * cours (la fiche fiscale du dossier ; le 1er janvier sinon). Une décision
   * datée du jour ne toucherait pas les pièces de l'exercice déjà reçues
   * (revue de #154). Nulle : le défaut, relu à chaque changement de vue.
   */
  const [depuisChoisi, setDepuis] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ["cab-clients", cabinetId],
    queryFn: () => office().supervision.listClients(cabinetId),
  });
  const reglages = useQuery({
    queryKey: ["reglages-comptables", packId, cabinetId, dossier, jour, locale],
    queryFn: () =>
      office().parametrage.reglagesComptables(cabinetId, dossier || null, packId, jour, locale),
  });
  const depuis = depuisChoisi ?? reglages.data?.debutExercice ?? null;

  return (
    <section className="space-y-4">
      <SectionTitle>{t("cab.settings.tab.comptabilite")}</SectionTitle>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-[12px]">{t("reglages.compta.portee")}</span>
        <select
          value={dossier}
          onChange={(e) => {
            setDossier(e.target.value);
            setDepuis(null);
          }}
          className="min-h-[48px] w-full min-w-0 max-w-full truncate border border-border bg-card px-3 text-[13px] sm:max-w-[360px]"
        >
          <option value={CABINET}>{t("reglages.compta.portee.cabinet")}</option>
          {(clients.data ?? []).map((c) => (
            <option key={c.tenantId} value={c.tenantId}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {depuis ? (
        <div className="flex min-w-0 flex-col gap-1">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px]">{t("reglages.compta.depuis.champ")}</span>
            <input
              type="date"
              value={depuis}
              onChange={(e) => setDepuis(e.target.value || null)}
              className="num min-h-[48px] w-full min-w-0 max-w-full border border-border bg-card px-3 text-[13px] sm:max-w-[360px]"
            />
          </label>
          <span className="text-[11px] text-muted-foreground">
            {t("reglages.compta.depuis", { date: dateEnChiffres(depuis, locale) })}
          </span>
        </div>
      ) : null}
      {reglages.isError ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {texteDeLErreur(reglages.error, OU, t("common.error"))}
        </p>
      ) : reglages.data && reglages.data.sujets.length === 0 ? (
        <EmptyState>{t("reglages.compta.vide")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {(reglages.data?.sujets ?? []).map((s) => (
            <li key={s.code} className="min-w-0 border border-border bg-card px-4 pb-4">
              <ArreterUnParametrage
                titre={s.titre}
                aide={aideDuSujet(s, { t, locale })}
                aConfirmer={
                  s.reglages.some((r) => r.origine === "pack")
                    ? t("reglages.compta.aConfirmer")
                    : null
                }
                valeurs={s.reglages.map((r) => ({
                  cle: r.code,
                  libelle: r.libelle,
                  valeur: r.valeur ?? "",
                  origine: r.origine,
                  // « Pas encore appliqué » se dit AVANT de choisir, sur l'option.
                  options:
                    r.options?.map((o) => ({
                      code: o.code,
                      label: o.appliquee
                        ? o.label
                        : `${o.label} — ${t("reglages.compta.option.nonAppliquee")}`,
                    })) ?? null,
                  note: r.appliquee ? null : t("reglages.compta.nonApplique"),
                }))}
                arretee={{
                  titre: t("reglages.compta.arrete"),
                  detail: t("reglages.compta.depuis", {
                    date: depuis ? dateEnChiffres(depuis, locale) : "",
                  }),
                }}
                portees={dossier ? ["dossier", "cabinet"] : ["cabinet"]}
                disponible={(portee, choix, modifiees) =>
                  Boolean(depuis) && aArreter(s, portee, choix, modifiees).length > 0
                }
                arreter={(portee, choix, modifiees) =>
                  office().parametrage.arreterReglagesComptables({
                    cabinetId,
                    portee,
                    porteeId: portee === "dossier" ? dossier : cabinetId,
                    packId,
                    depuis: depuis!,
                    valeurs: aArreter(s, portee, choix, modifiees),
                  })
                }
                invalider={["reglages-comptables"]}
                contexte={[cabinetId, dossier, depuis, s.code]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Ce qu'un geste arrête — et rien de plus (revue de #154).
 *
 * Pour un DOSSIER : les seules valeurs que la personne a changées. Ce qui
 * vient du cabinet ou du pack n'est pas recopié sur le dossier : il le suit.
 *
 * Pour tout le CABINET : les valeurs changées, comparées à celles du cabinet
 * (jamais à celles du dossier affiché, qui se recopieraient sur tous) ; sans
 * rien changer, c'est CONFIRMER les défauts du pack que le cabinet n'a pas
 * encore arrêtés — une décision, même à valeur égale (#145).
 */
function aArreter(
  s: Sujet,
  portee: "dossier" | "cabinet",
  choix: Record<string, string>,
  modifiees: ReadonlySet<string>,
): Array<{ code: string; valeur: string | null }> {
  const valeur = (code: string) => choix[code] || null;
  if (portee === "dossier")
    return s.reglages
      .filter((r) => modifiees.has(r.code))
      .map((r) => ({ code: r.code, valeur: valeur(r.code) }));
  if (modifiees.size === 0)
    return s.reglages
      .filter((r) => r.origineDuCabinet === "pack" && r.valeurDuCabinet !== null)
      .map((r) => ({ code: r.code, valeur: r.valeurDuCabinet }));
  return s.reglages
    .filter(
      (r) =>
        modifiees.has(r.code) &&
        (valeur(r.code) !== r.valeurDuCabinet || r.origineDuCabinet === "pack"),
    )
    .map((r) => ({ code: r.code, valeur: valeur(r.code) }));
}

/**
 * Le ⓘ d'un sujet : le texte, la pratique, le risque, l'INCERTAIN en rouge,
 * le défaut du pack, ce que le pack impute aujourd'hui, et les sources datées.
 */
function aideDuSujet(s: Sujet, { t, locale }: Pick<I18n, "t" | "locale">): ParagrapheDAide[] {
  const imputations = [
    ...s.droits.map(
      (d) =>
        `${t(d.sens === "facture_achat" ? "reglages.compta.droit.achat" : "reglages.compta.droit.vente", { compte: d.compte })}${
          d.montantFixe
            ? ` · ${t("reglages.compta.droit.montant", { montant: d.montantFixe })}`
            : ""
        }${d.taux ? ` · ${t("reglages.compta.droit.taux", { taux: d.taux })}` : ""}`,
    ),
    ...s.bareme.map((b) =>
      b.a
        ? t("reglages.compta.bareme.tranche", {
            categorie: b.categorie,
            de: b.de,
            a: b.a,
            droit: b.droit,
          })
        : t("reglages.compta.bareme.auDela", { categorie: b.categorie, de: b.de, droit: b.droit }),
    ),
    ...s.categories.map(
      (c) =>
        `${t("reglages.compta.categorie", { libelle: c.libelle, compte: c.compte, taux: c.tauxLineaire })}${
          c.tauxMaximal ? ` · ${t("reglages.compta.categorie.max", { max: c.tauxMaximal })}` : ""
        }${c.depasse ? ` · ${t("reglages.compta.categorie.depasse")}` : ""}`,
    ),
    ...s.naturesDeVente.map(
      (n) =>
        `${t("reglages.compta.nature_de_vente", { libelle: n.libelle, compte: n.compte })}${
          n.repli ? ` · ${t("reglages.compta.nature_de_vente.repli")}` : ""
        }`,
    ),
  ];
  const references = s.reglages.flatMap((r) =>
    r.reference ? [`${r.libelle} : ${r.reference}`] : [],
  );
  return [
    { titre: t("reglages.compta.aide.texte"), texte: s.texte },
    { titre: t("reglages.compta.aide.pratique"), texte: s.pratique },
    { titre: t("reglages.compta.aide.risque"), texte: s.risque },
    ...(s.incertain
      ? [
          {
            titre: t("reglages.compta.aide.incertain"),
            texte: <span className="font-semibold text-signal-stop">{s.incertain}</span>,
          },
        ]
      : []),
    ...(references.length > 0
      ? [{ titre: t("reglages.compta.aide.defaut"), texte: <Liste lignes={references} /> }]
      : []),
    ...(imputations.length > 0
      ? [{ titre: t("reglages.compta.aide.imputation"), texte: <Liste lignes={imputations} /> }]
      : []),
    ...(s.sources.length > 0
      ? [
          {
            titre: t("reglages.compta.aide.sources"),
            texte: (
              <ul className="space-y-1">
                {s.sources.map((x) => (
                  <li key={x.url}>
                    <a
                      href={x.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-words text-signal-info underline"
                    >
                      {x.dateeDu
                        ? t("reglages.compta.source.datee", {
                            titre: x.titre,
                            datee: dateEnChiffres(x.dateeDu, locale),
                            date: dateEnChiffres(x.consulteeLe, locale),
                          })
                        : t("reglages.compta.source", {
                            titre: x.titre,
                            date: dateEnChiffres(x.consulteeLe, locale),
                          })}
                    </a>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];
}

function Liste({ lignes }: { lignes: readonly string[] }) {
  return (
    <ul className="list-disc space-y-1 ps-4">
      {lignes.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
