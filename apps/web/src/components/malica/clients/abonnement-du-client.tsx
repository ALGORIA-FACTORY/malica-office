/**
 * L'abonnement d'un client, vu par la comptabilité qui le paie — un module
 * du web seulement : il nomme des prix et des gestes de vente, absents de
 * l'application installée (`commerce.ts`, `coque-sans-commerce.mjs`).
 *
 * La comptabilité choisit l'offre et voit son prix ; le texte sous les offres
 * dit l'effet avant d'enregistrer : avant l'arrivée du dirigeant rien n'est
 * facturé (A2), une montée s'applique sur-le-champ, une descente attend son
 * accord, et arrêter la prise en charge rend l'abonnement au dirigeant.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AbonnementsDuCabinet } from "@/components/malica/abonnements-du-cabinet";
import { useCabinet } from "@/components/malica/cabinet-context";
import { Retour } from "@/components/malica/clients/fiche-client";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant, montantEtDevise } from "@/lib/lisible";
import { effetDuChoix, offreActuelle, type EffetDuChoix } from "@/lib/etat-des-clients";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  ClientSummary,
  EtatDuClient,
  OffreAuCatalogue,
} from "@malica/socle/ports/repositories";

const OU = "components/malica/clients/abonnement-du-client";
const ETIQUETTE = "block text-[11px] font-semibold text-text-2";

const EFFET: Record<EffetDuChoix, MessageKey> = {
  a_proposer: "cab.cli.abo.effet.a_proposer",
  attente_dirigeant: "cab.cli.abo.effet.attente",
  attente_reponse: "cab.cli.abo.effet.reponse",
  montee: "cab.cli.abo.effet.montee",
  descente: "cab.cli.abo.effet.descente",
  actuelle: "cab.cli.abo.effet.actuelle",
  prise_en_charge: "cab.cli.abo.effet.prise_en_charge",
  couvrir: "cab.cli.abo.effet.couvrir",
};

/** La facture Malica que la comptabilité règle, dans la vue Facturation. */
export function FacturesMalica() {
  const { org } = useCabinet();
  return <AbonnementsDuCabinet cabinet={org} facturesSeules />;
}

export function OngletAbonnement({
  client,
  etat,
  catalogue,
  parLaLicence = null,
  expert,
  annoncer,
}: {
  parLaLicence?: string | null;
  client: ClientSummary;
  etat: EtatDuClient | undefined;
  /** Les noms des offres, sans prix ; les prix viennent de `offresDuCabinet`. */
  catalogue: readonly OffreAuCatalogue[];
  expert: boolean;
  annoncer: (texte: string) => void;
}) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const grille = useQuery({
    queryKey: ["cab-abo-offres"],
    queryFn: () => office().facturation.offresDuCabinet(),
  });
  const offres = grille.data ?? [];
  const [choix, setChoix] = useState<string>(etat?.accesOffre ?? "");
  const [arret, setArret] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => setChoix(etat?.accesOffre ?? ""), [etat?.accesOffre]);

  const rafraichir = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] }),
      qc.invalidateQueries({ queryKey: ["cab-abo-attribues", org.id] }),
    ]);
  };
  const enregistrer = useMutation({
    mutationFn: async () => {
      if (!etat?.accesId) {
        await office().facturation.proposerAbonnement(org.id, client.tenantId, choix);
        return etat?.dirigeantPresent ? "propose" : "attente";
      }
      const r = await office().facturation.changerOffreAbonnement(etat.accesId, choix);
      return r.effet;
    },
    onSuccess: async (effet) => {
      setErreur(null);
      await rafraichir();
      const cles: Record<string, MessageKey> = {
        propose: "cab.cli.abo.ok.propose",
        attente: "cab.cli.abo.ok.attente",
        proposition: etat?.dirigeantPresent ? "cab.cli.abo.ok.propose" : "cab.cli.abo.ok.attente",
        immediat: "cab.cli.abo.ok.montee",
        accord_attendu: "cab.cli.abo.ok.descente",
        inchange: "cab.cli.rien.change",
      };
      annoncer(t(cles[effet] ?? "cab.cli.enregistre"));
    },
    onError: (e: unknown) => {
      // Une descente qui ne tient pas : dire pourquoi, avec les chiffres.
      const m = String((e as { message?: string })?.message ?? "");
      if (m.includes("motif=organisations")) setErreur(t("cab.cli.abo.refus.organisations"));
      else if (m.includes("motif=sieges_occupes")) setErreur(t("cab.cli.abo.refus.sieges"));
      else setErreur(texteDeLErreur(e, OU, t("common.error")));
    },
  });
  const arreter = useMutation({
    mutationFn: () => office().facturation.arreterAbonnement(etat!.accesId!),
    onSuccess: async (r) => {
      setArret(false);
      setErreur(null);
      await rafraichir();
      annoncer(r.effet === "retiree" ? t("cab.cli.abo.ok.retiree") : t("cab.cli.abo.ok.arrete"));
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  // Les décimales sont celles que la base sert (la colonne porte l'échelle de la devise) :
  // aucun « 3 » écrit ici, un seul formateur (`montant`, le Socle).
  const prix = (v: string) => montantEtDevise(montant(v, locale), org.currency);
  const libelle = (code: string | null) =>
    (offres.find((o) => o.code === code) ?? catalogue.find((o) => o.code === code))?.libelle ??
    code ??
    "";

  const actuelle = offreActuelle(etat, offres);
  const etatCourant = !etat?.accesStatut
    ? { titre: t("cab.cli.abo.aucun"), detail: t("cab.cli.abo.aucun.detail"), ton: "gris" }
    : etat.accesStatut === "propose"
      ? {
          titre: t("cab.cli.abo.propose", { offre: libelle(etat.accesOffre) }),
          detail: etat.dirigeantPresent
            ? t("cab.cli.abo.propose.detail")
            : t("cab.cli.abo.attente.detail"),
          ton: "attente",
        }
      : {
          titre:
            actuelle && actuelle !== etat.accesOffre
              ? t("cab.cli.abo.paye.monteeParLeClient", {
                  offre: libelle(etat.accesOffre),
                  client: libelle(actuelle),
                })
              : t("cab.cli.abo.paye", { offre: libelle(etat.accesOffre) }),
          detail: etat.descenteOffre
            ? t("cab.cli.abo.descente.attente", { offre: libelle(etat.descenteOffre) })
            : t("cab.cli.abo.paye.detail"),
          ton: "actif",
        };
  const effet = choix ? effetDuChoix(etat, choix, offres) : null;

  // Couverte par la licence de son dirigeant, que la comptabilité paie déjà.
  if (parLaLicence && !etat?.accesStatut) {
    return (
      <section className="rounded-xl border border-border p-4 text-[13px]">
        <strong className="block">
          {t("cab.cli.abo.licence", { offre: libelle(parLaLicence) })}
        </strong>
        <span className="text-muted-foreground">{t("cab.cli.abo.licence.detail")}</span>
      </section>
    );
  }

  return (
    <div className="space-y-4 text-[13px]">
      <section className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
        <span>
          <strong className="block">{etatCourant.titre}</strong>
          <span className="text-muted-foreground">{etatCourant.detail}</span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
            etatCourant.ton === "actif" && "bg-[#eef6f1] text-[#168b50]",
            etatCourant.ton === "attente" && "bg-[#fdf6e7] text-marigold",
            etatCourant.ton === "gris" && "bg-[#f2f4f7] text-text-2",
          )}
        >
          {t(`cab.cli.abo.ton.${etatCourant.ton}` as MessageKey)}
        </span>
      </section>

      {expert ? (
        <>
          <p className={ETIQUETTE}>{t("cab.cli.abo.choisir")}</p>
          <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {offres.map((o) => (
              <button
                key={o.code}
                type="button"
                role="radio"
                aria-checked={choix === o.code}
                onClick={() => {
                  setChoix(o.code);
                  setErreur(null);
                }}
                className={cn(
                  "flex flex-col gap-0.5 rounded-xl border-[1.5px] p-3 text-start",
                  choix === o.code
                    ? "border-[#168b50] bg-[#f4f8f5]"
                    : "border-border hover:border-text-2",
                )}
              >
                <span className="text-[14px] font-semibold">{o.libelle}</span>
                <span className="num text-[12px] text-muted-foreground">
                  {t("cab.cli.abo.prix", { prix: prix(o.prix_mensuel_ht) })}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("cab.cli.abo.inclus", {
                    places: o.sieges_inclus,
                    lectures: o.lectures_par_organisation,
                  })}
                </span>
              </button>
            ))}
          </div>
          {effet ? (
            <p
              className={cn(
                "rounded-xl p-3",
                (effet === "montee" || effet === "prise_en_charge") && "bg-[#f4f8f5]",
                (effet === "descente" || effet === "couvrir") && "bg-[#eef2fb] text-[#2b3f6b]",
                (effet === "attente_dirigeant" ||
                  effet === "attente_reponse" ||
                  effet === "a_proposer") &&
                  "bg-[#fdf6e7] text-[#7a5410]",
                effet === "actuelle" && "bg-[#f7f8f7]",
              )}
            >
              {t(EFFET[effet], {
                prix: prix(offres.find((o) => o.code === choix)?.prix_mensuel_ht ?? "0"),
                offre: libelle(actuelle),
              })}
            </p>
          ) : null}
          <p className="leading-[1.5] text-muted-foreground">{t("cab.cli.abo.regle")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!choix || effet === "actuelle" || enregistrer.isPending}
              onClick={() => enregistrer.mutate()}
              className="cab-button cab-button-primary"
            >
              {!etat?.accesId
                ? t("cab.cli.abo.proposer")
                : effet === "descente"
                  ? t("cab.cli.abo.demander")
                  : effet === "prise_en_charge"
                    ? t("cab.cli.abo.prendre", { offre: libelle(choix) })
                    : t("cab.cli.abo.appliquer")}
            </button>
            {etat?.accesId ? (
              <button
                type="button"
                onClick={() => setArret(true)}
                className="text-[12.5px] font-semibold text-signal-stop hover:underline"
              >
                {etat.accesStatut === "propose"
                  ? t("cab.cli.abo.retirer")
                  : t("cab.cli.abo.arreter")}
              </button>
            ) : null}
          </div>
          {arret ? (
            <div className="cab-pop space-y-2 rounded-xl border border-[#f1c3bd] bg-[#fef3f2] p-4 text-[#7a271a]">
              <strong className="block">
                {etat?.accesStatut === "propose"
                  ? t("cab.cli.abo.retirer.q")
                  : t("cab.cli.abo.arreter.q")}
              </strong>
              <p>
                {etat?.accesStatut === "propose"
                  ? t("cab.cli.abo.retirer.lede")
                  : t("cab.cli.abo.arreter.lede")}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={arreter.isPending}
                  onClick={() => arreter.mutate()}
                  className="cab-button bg-signal-stop text-white"
                >
                  {t("cab.cli.abo.confirmer")}
                </button>
                <button
                  type="button"
                  onClick={() => setArret(false)}
                  className="cab-button cab-button-secondary"
                >
                  {t("cab.cli.abo.garder")}
                </button>
              </div>
            </div>
          ) : null}
          <Retour ok={false} texte={erreur} />
        </>
      ) : (
        <p className="text-muted-foreground">{t("cab.cli.reserve.expert")}</p>
      )}
    </div>
  );
}
