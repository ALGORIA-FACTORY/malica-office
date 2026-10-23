/**
 * L'abonnement piloté depuis l'application (décisions du 19 octobre 2026).
 *
 * Quatre blocs pour l'écran des réglages : le nom de la personne, le choix de
 * l'offre, les recharges, et les propriétaires. Aucun ne décide rien (R3) :
 * la grille, les empêchements, les plafonds et les refus viennent de la base,
 * l'écran les montre et transmet le geste. Les prix sont des chaînes `numeric`
 * et restent des chaînes : on n'en calcule aucun ici (R4).
 *
 * Le propriétaire principal se reconnaît à ce que la base lui rend : le prix
 * de sa licence. Un propriétaire ou un utilisateur le reçoit vide — il voit
 * alors la règle, pas les boutons.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { usePme } from "@/components/malica/pme-context";
import { usePrix } from "@/hooks/use-decimales";
import {
  libelleDOffre,
  offreQuiPermetDeRecharger,
  useCatalogueDesOffres,
} from "@/hooks/use-offres";
import { useI18n, type MessageKey } from "@/i18n";
import { montant } from "@/lib/lisible";
import { libelleDuPaiement } from "@/lib/paiement";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type { FactureDuTitulaire, OffreDeLaGrille } from "@malica/socle/ports/repositories";

const OU = "components/malica/abonnement-pilote";

/** Les clés que ces gestes rendent caduques. */
const CLES = [
  ["mon-forfait"],
  ["forfait-sieges"],
  ["forfait-organisations"],
  ["mes-offres"],
  ["mes-recharges"],
  ["recharge-automatique"],
  ["mes-paiements"],
  ["mon-annuel"],
];

function useInvalider() {
  const qc = useQueryClient();
  return async () => {
    for (const queryKey of CLES) await qc.invalidateQueries({ queryKey });
  };
}

/** Les empêchements que la base nomme, et leur phrase. Un code inconnu se tait. */
const EMPECHEMENTS: Record<string, MessageKey> = {
  deja_courant: "pme.reglages.offres.empechement.deja_courant",
  commande_speciale: "pme.reglages.offres.empechement.commande_speciale",
  sieges_occupes: "pme.reglages.offres.empechement.sieges_occupes",
  organisations: "pme.reglages.offres.empechement.organisations",
  offre_inconnue: "pme.reglages.offres.empechement.offre_inconnue",
  pas_de_licence: "pme.reglages.offres.empechement.pas_de_licence",
  engagement_annuel: "pme.reglages.offres.empechement.engagement_annuel",
};

/** Ce qui ferme l'année, nommé par la base, et sa phrase. */
const FERMETURES: Record<string, MessageKey> = {
  annuel_ferme: "pme.reglages.annuel.ferme.annuel_ferme",
  offre_sans_prix: "pme.reglages.annuel.ferme.offre_sans_prix",
  paye_par_un_cabinet: "pme.reglages.annuel.ferme.paye_par_un_cabinet",
  licence_inactive: "pme.reglages.annuel.ferme.licence_inactive",
  deja_engage: "pme.reglages.annuel.ferme.deja_engage",
};

/** Un refus de la base dit en clair ; sinon le texte d'erreur commun. */
function refus(e: unknown, t: (k: MessageKey) => string): string {
  const message = e instanceof Error ? e.message : String(e ?? "");
  const forfait = /forfait_refuse:([a-z_]+)/.exec(message);
  if (forfait && EMPECHEMENTS[forfait[1]!]) return t(EMPECHEMENTS[forfait[1]!]!);
  const annuel = /annuel_refuse:([a-z_]+)/.exec(message);
  if (annuel && FERMETURES[annuel[1]!]) return t(FERMETURES[annuel[1]!]!);
  if (/offre_sans_recharge/.test(message)) return t("pme.reglages.recharges.verrou");
  return texteDeLErreur(e, OU, t("common.error"));
}

/** Le propriétaire principal : celui à qui la base rend le prix de la licence. */
function useEstPrincipal(): boolean {
  const pme = usePme();
  return Boolean(pme.forfait.ligne && pme.forfait.ligne.prix_mensuel_ht !== null);
}

/* ------------------------------------------------------------------ le nom */

export function MonNom() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const profil = useQuery({
    queryKey: ["mon-profil"],
    queryFn: () => office().identity.monProfil(),
  });
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [retour, setRetour] = useState<string | null>(null);
  const [edition, setEdition] = useState(false);

  useEffect(() => {
    if (profil.data && !edition) {
      setPrenom(profil.data.prenom ?? "");
      setNom(profil.data.nom ?? "");
    }
  }, [profil.data, edition]);

  const ecrire = useMutation({
    mutationFn: () => office().identity.ecrireMonProfil(prenom, nom),
    onSuccess: async (enregistre) => {
      setRetour(t("pme.reglages.profil.enregistre"));
      qc.setQueryData(["mon-profil"], enregistre);
      setEdition(false);
      await qc.invalidateQueries({ queryKey: ["compte"] });
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const champ = "h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]";
  /*
   * Posé DANS la carte du compte, pas à côté : le nom et l'adresse sont la
   * même personne, et deux cartes pour elle se lisaient comme deux comptes.
   */
  return (
    <div className="mt-3">
      <p className="t-body">{t("pme.reglages.profil.aide")}</p>
      {profil.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : profil.isError ? (
        <p role="alert">{refus(profil.error, t)}</p>
      ) : !edition ? (
        <div className="mt-3 flex items-start justify-between gap-4">
          <dl className="grid flex-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="t-body">{t("pme.reglages.profil.prenom")}</dt>
              <dd>{profil.data?.prenom || "—"}</dd>
            </div>
            <div>
              <dt className="t-body">{t("pme.reglages.profil.nom")}</dt>
              <dd>{profil.data?.nom || "—"}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="btn"
            style={{ width: "auto" }}
            onClick={() => {
              setRetour(null);
              setEdition(true);
            }}
          >
            {t("pme.reglages.profil.editer")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            disabled={ecrire.isPending}
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            placeholder={t("pme.reglages.profil.prenom")}
            aria-label={t("pme.reglages.profil.prenom")}
            autoComplete="given-name"
            className={champ}
          />
          <input
            disabled={ecrire.isPending}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder={t("pme.reglages.profil.nom")}
            aria-label={t("pme.reglages.profil.nom")}
            autoComplete="family-name"
            className={champ}
          />
          <button
            type="button"
            className="btn"
            style={{ width: "auto" }}
            disabled={ecrire.isPending}
            onClick={() => ecrire.mutate()}
          >
            {t("pme.reglages.profil.enregistrer")}
          </button>
          <button
            type="button"
            className="btn sec"
            style={{ width: "auto" }}
            disabled={ecrire.isPending}
            onClick={() => {
              setEdition(false);
              setRetour(null);
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {retour ? (
        <p className="t-body" role={ecrire.isError ? "alert" : "status"} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- l'offre */

export function ChangerDOffre() {
  const catalogue = useCatalogueDesOffres().data;
  const { t, locale } = useI18n();
  const pme = usePme();
  const aLEchelle = usePrix();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const offres = useQuery({
    queryKey: ["mes-offres", pme.tenantId],
    queryFn: () => office().facturation.mesOffres(pme.tenantId),
    enabled: principal,
    retry: false,
  });
  const [armee, setArmee] = useState<string | null>(null);
  const [retour, setRetour] = useState<string | null>(null);

  const changer = useMutation({
    mutationFn: (code: string) => office().facturation.changerForfait(code, pme.tenantId),
    onSuccess: async (r, code) => {
      setArmee(null);
      // Une montée mène au paiement : le bloc « À régler » apparaît juste dessous.
      setRetour(
        r.paiement
          ? t("pme.reglages.offres.aRegler", { offre: libelleDOffre(catalogue, code) })
          : t("pme.reglages.offres.fait", { offre: libelleDOffre(catalogue, code) }),
      );
      await invalider();
    },
    onError: (e: unknown) => {
      setArmee(null);
      setRetour(refus(e, t));
    },
  });

  if (!principal) {
    return (
      <div className="card">
        <p className="t-body">{t("pme.reglages.offres.principalSeul")}</p>
      </div>
    );
  }

  const entier = (n: number) => new Intl.NumberFormat(locale).format(n);
  const ligne = (o: OffreDeLaGrille) =>
    [
      t("pme.reglages.offres.prix", { prix: aLEchelle(o.prix_mensuel_ht), devise: pme.currency }),
      t("pme.reglages.offres.lectures", { n: entier(o.lectures_par_organisation) }),
      o.sieges_inclus > 0
        ? t("pme.reglages.offres.places", { count: o.sieges_inclus })
        : t("pme.reglages.offres.seul"),
      t("pme.reglages.offres.societes", { count: o.organisations_incluses }),
    ].join(" · ");

  return (
    <div className="rows">
      {/*
       * L'offre en cours ne se répète pas ici : la carte « L'abonnement »,
       * juste au-dessus, la porte déjà avec son prix. La relister faisait deux
       * fois la même carte sur le même écran (relevé le 19 octobre).
       */}
      {(offres.data ?? [])
        .filter((o) => !o.courant)
        .map((o) => {
          const bloque = o.empechement ? EMPECHEMENTS[o.empechement] : undefined;
          return (
            <div key={o.code} className="card abo" data-offre={o.code} data-courant={o.courant}>
              <div className="nm">
                <b>{o.libelle}</b>
                <span className="px">
                  {t("pme.reglages.offres.incluses", { n: entier(o.lectures_incluses) })}
                </span>
              </div>
              <p className="t-body">{ligne(o)}</p>
              {/* Le TTC vient de la base, par la fiscalité de la facture (R4). */}
              {o.prix_ttc !== null ? (
                <p className="t-body">
                  {t("pme.reglages.offres.ttc", {
                    prix: aLEchelle(o.prix_ttc),
                    devise: pme.currency,
                  })}
                </p>
              ) : null}
              {o.empechement ? (
                <p className="t-body">{bloque ? t(bloque) : null}</p>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={changer.isPending}
                  onClick={() =>
                    armee === o.code ? changer.mutate(o.code) : (setArmee(o.code), setRetour(null))
                  }
                >
                  {armee === o.code
                    ? t("pme.reglages.offres.confirmer", { offre: o.libelle })
                    : t("pme.reglages.offres.passer", { offre: o.libelle })}
                </button>
              )}
            </div>
          );
        })}
      {offres.error ? <p className="warn">{refus(offres.error, t)}</p> : null}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- l'année */

/**
 * Payer à l'année (19 octobre 2026) : douze mois, dont des mois offerts que
 * la tour règle. L'engagement commence le premier du mois suivant ; le mois
 * en cours reste facturé au mois. Tout chiffre vient de `mon_annuel` — prix,
 * mois offerts, TTC, dates. L'écran n'en calcule aucun (R3, R4).
 *
 * Deux touches : la première arme, la seconde engage. Le paiement à régler,
 * s'il y en a un, apparaît dans « À régler », juste dessous.
 */
export function PayerALAnnee() {
  const catalogue = useCatalogueDesOffres().data;
  const { t, locale } = useI18n();
  const pme = usePme();
  const aLEchelle = usePrix();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const [armee, setArmee] = useState(false);
  const [retour, setRetour] = useState<string | null>(null);
  const annuel = useQuery({
    queryKey: ["mon-annuel", pme.tenantId],
    queryFn: () => office().facturation.monAnnuel(pme.tenantId),
    enabled: principal,
  });
  const souscrire = useMutation({
    mutationFn: () => office().facturation.souscrireAnnuel(pme.tenantId),
    onSuccess: async (r) => {
      setArmee(false);
      setRetour(t(r.paiement ? "pme.reglages.annuel.fait.aRegler" : "pme.reglages.annuel.fait"));
      await invalider();
    },
    onError: (e: unknown) => {
      setArmee(false);
      setRetour(refus(e, t));
    },
  });

  if (!principal || !annuel.data) return null;
  const a = annuel.data;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(`${iso}T12:00:00`),
    );

  if (a.en_cours) {
    return (
      <div className="card abo">
        <div className="nm">
          <b>{t("pme.reglages.annuel.enCours")}</b>
          <span className="px">{`${aLEchelle(a.en_cours.montant_ht)} ${pme.currency}`}</span>
        </div>
        <p className="t-body">
          {t("pme.reglages.annuel.enCours.sous", {
            offre: libelleDOffre(catalogue, a.en_cours.offre),
            du: date(a.en_cours.du),
            au: date(a.en_cours.au),
            offerts: a.en_cours.mois_offerts,
          })}
        </p>
      </div>
    );
  }

  const p = a.proposition;
  if (!p) return null;
  const ferme = a.ferme ? FERMETURES[a.ferme] : undefined;

  return (
    <div className="card abo" data-annuel>
      <div className="nm">
        <b>{t("pme.reglages.annuel.titre", { offerts: p.mois_offerts })}</b>
        <span className="px">{`${aLEchelle(p.montant_ht)} ${pme.currency}`}</span>
      </div>
      <p className="t-body">
        {t("pme.reglages.annuel.detail", {
          offre: libelleDOffre(catalogue, p.offre),
          prix: p.prix_mensuel_ht,
          payes: 12 - p.mois_offerts,
          offerts: p.mois_offerts,
          devise: pme.currency,
        })}
      </p>
      {p.ttc !== null ? (
        <p className="t-body">
          {t("pme.reglages.annuel.ttc", { ttc: aLEchelle(p.ttc), devise: pme.currency })}
        </p>
      ) : null}
      <p className="t-body">{t("pme.reglages.annuel.dates", { du: date(p.du), au: date(p.au) })}</p>
      {a.ferme ? (
        <p className="t-body">{ferme ? t(ferme) : null}</p>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={souscrire.isPending}
          onClick={() => (armee ? souscrire.mutate() : (setArmee(true), setRetour(null)))}
        >
          {armee
            ? t("pme.reglages.annuel.confirmer", {
                montant: aLEchelle(p.montant_ht),
                devise: pme.currency,
              })
            : t("pme.reglages.annuel.passer")}
        </button>
      )}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- les recharges */

export function MesRecharges() {
  const catalogue = useCatalogueDesOffres().data;
  const { t, locale } = useI18n();
  const pme = usePme();
  const aLEchelle = usePrix();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const paliers = useQuery({
    queryKey: ["paliers-de-recharge"],
    queryFn: () => office().facturation.paliersDeRecharge(),
    enabled: principal,
  });
  const miennes = useQuery({
    queryKey: ["mes-recharges"],
    queryFn: () => office().facturation.mesRecharges(),
    enabled: principal,
    retry: false,
  });
  const auto = useQuery({
    queryKey: ["recharge-automatique"],
    queryFn: () => office().facturation.maRechargeAutomatique(),
    enabled: principal,
    retry: false,
  });
  const [retour, setRetour] = useState<string | null>(null);
  const [palierAuto, setPalierAuto] = useState("");
  const [plafond, setPlafond] = useState("");

  useEffect(() => {
    if (auto.data?.active) {
      setPalierAuto(auto.data.recharge_code ?? "");
      setPlafond(auto.data.plafond_mois_ht ?? "");
    }
  }, [auto.data]);

  const acheter = useMutation({
    mutationFn: (code: string) => office().facturation.acheterRecharge(code, pme.tenantId),
    onSuccess: async (r) => {
      setRetour(
        r.paiement ? t("pme.reglages.recharges.aRegler") : t("pme.reglages.recharges.achetee"),
      );
      await invalider();
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const regler = useMutation({
    mutationFn: (active: boolean) =>
      office().facturation.reglerRechargeAutomatique(
        active,
        active ? palierAuto : null,
        active ? plafond.replace(",", ".") : null,
        pme.tenantId,
      ),
    onSuccess: async () => {
      setRetour(null);
      await invalider();
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  if (!principal) return null;

  const offre = pme.forfait.ligne?.offre ?? null;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(`${iso.slice(0, 10)}T00:00:00Z`),
    );
  const liste = [...(paliers.data ?? [])].sort((a, b) => a.rang - b.rang);
  const libelleDu = (code: string | null) =>
    liste.find((p) => p.code === code)
      ? t("pme.reglages.recharges.palier", { n: liste.find((p) => p.code === code)!.lectures })
      : (code ?? "");
  const champ = "h-[46px] min-w-0 flex-1 border border-line-strong bg-transparent px-3 text-[14px]";

  // Une offre sans recharge (`ref.offres.recharges_permises`) : la carte reste
  // visible, verrouillée, et nomme l'offre qui les ouvre.
  if (catalogue && offre && catalogue.find((o) => o.code === offre)?.recharges_permises === false) {
    return (
      <div className="inv off" data-verrou={offreQuiPermetDeRecharger(catalogue, offre)?.libelle}>
        <span className="bd">
          <b>{t("pme.reglages.recharges")}</b>
          <span>{t("pme.reglages.recharges.verrou")}</span>
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="rows">
        {liste.map((p) => (
          <div key={p.code} className="card abo" data-palier={p.code}>
            <div className="nm">
              <b>{t("pme.reglages.recharges.palier", { n: p.lectures })}</b>
              <span className="px">
                {t("pme.reglages.recharges.prix", {
                  prix: aLEchelle(p.prix_ht),
                  devise: pme.currency,
                })}
              </span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={acheter.isPending}
              onClick={() => acheter.mutate(p.code)}
            >
              {t("pme.reglages.recharges.acheter")}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <b>{t("pme.reglages.recharges.miennes")}</b>
        {(miennes.data ?? []).length === 0 ? (
          <p className="t-body">{t("pme.reglages.recharges.aucune")}</p>
        ) : (
          (miennes.data ?? []).map((r) => (
            <p key={r.recharge_id} className="t-body" data-recharge={r.recharge_id}>
              {t("pme.reglages.recharges.reste", {
                restantes: r.restantes,
                lectures: r.lectures,
                date: date(r.expire_le),
              })}
              {r.gelee ? ` — ${t("pme.reglages.recharges.gelee")}` : ""}
              {r.expiree ? ` — ${t("pme.reglages.recharges.expiree")}` : ""}
            </p>
          ))
        )}
      </div>

      <div className="card">
        <b>{t("pme.reglages.recharges.auto")}</b>
        <p className="t-body">{t("pme.reglages.recharges.auto.sous")}</p>
        <p className="t-body">
          {auto.data?.active
            ? t("pme.reglages.recharges.auto.active", {
                palier: libelleDu(auto.data.recharge_code),
                plafond: auto.data.plafond_mois_ht ?? "",
                devise: pme.currency,
              })
            : t("pme.reglages.recharges.auto.inactive")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={palierAuto}
            onChange={(e) => setPalierAuto(e.target.value)}
            aria-label={t("pme.reglages.recharges.auto.palier")}
            className={champ}
          >
            <option value="">{t("pme.reglages.recharges.auto.palier")}</option>
            {liste.map((p) => (
              <option key={p.code} value={p.code}>
                {t("pme.reglages.recharges.palier", { n: p.lectures })} —{" "}
                {t("pme.reglages.recharges.prix", {
                  prix: aLEchelle(p.prix_ht),
                  devise: pme.currency,
                })}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            value={plafond}
            onChange={(e) => setPlafond(e.target.value)}
            placeholder={t("pme.reglages.recharges.auto.plafond")}
            aria-label={t("pme.reglages.recharges.auto.plafond")}
            className={champ}
          />
          <button
            type="button"
            className="btn"
            style={{ width: "auto" }}
            disabled={regler.isPending || palierAuto === "" || plafond.trim() === ""}
            onClick={() => regler.mutate(true)}
          >
            {t("pme.reglages.recharges.auto.activer")}
          </button>
          {auto.data?.active ? (
            <button
              type="button"
              className="btn"
              style={{ width: "auto" }}
              disabled={regler.isPending}
              onClick={() => regler.mutate(false)}
            >
              {t("pme.reglages.recharges.auto.arreter")}
            </button>
          ) : null}
        </div>
      </div>
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}

/* --------------------------------------------------------- les propriétaires */

export function MesProprietaires() {
  const { t } = useI18n();
  const pme = usePme();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const compte = useQuery({ queryKey: ["compte"], queryFn: () => office().auth.session() });
  const sieges = useQuery({
    queryKey: ["forfait-sieges", pme.tenantId],
    queryFn: () => office().facturation.sieges(),
    enabled: principal,
    retry: false,
  });
  const [armee, setArmee] = useState<string | null>(null);
  const [retour, setRetour] = useState<string | null>(null);

  /*
   * L'invitation d'un propriétaire est partie dans « Inviter dans mon
   * dossier » (`inviter-dans-mon-dossier.tsx`), le 19 octobre : l'écran en
   * portait trois. Il ne reste ici que ce qui n'existe nulle part ailleurs —
   * transmettre la licence —, et seulement quand il y a quelqu'un à qui la
   * transmettre.
   */
  const transmettre = useMutation({
    mutationFn: (p: { id: string; nom: string }) =>
      office().facturation.transmettreLicence(pme.tenantId, p.id),
    onSuccess: async (_r, p) => {
      setArmee(null);
      setRetour(t("pme.reglages.proprietaires.transmis", { nom: p.nom }));
      await invalider();
    },
    onError: (e: unknown) => {
      setArmee(null);
      setRetour(refus(e, t));
    },
  });

  if (!principal) return null;

  const moi = compte.data?.id ?? null;
  const autres = (sieges.data ?? []).filter(
    (s) => s.role === "dirigeant" && s.tenant_id === pme.tenantId && s.user_id !== moi,
  );

  if (autres.length === 0 && !retour) return null;

  return (
    <>
      <div className="card">
        <b>{t("pme.reglages.proprietaires.transmettre")}</b>
        <p className="t-body">{t("pme.reglages.proprietaires.transmettre.sous")}</p>
        {autres.map((s) => {
          const nom = s.nom ?? s.user_id;
          return (
            <button
              key={s.user_id}
              type="button"
              className="btn mt-2"
              disabled={transmettre.isPending}
              onClick={() =>
                armee === s.user_id
                  ? transmettre.mutate({ id: s.user_id, nom })
                  : (setArmee(s.user_id), setRetour(null))
              }
            >
              {armee === s.user_id
                ? t("pme.reglages.proprietaires.transmettre.confirmer", { nom })
                : t("pme.reglages.proprietaires.transmettre.a", { nom })}
            </button>
          );
        })}
      </div>
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------- à régler */

/**
 * Ce qui reste à payer — une montée, une recharge — et le geste qui le paie.
 *
 * Une montée ou une recharge s'ouvrent TOUT DE SUITE ; le paiement suit, ici,
 * sans que la personne ait à le chercher : le bloc se place sous l'offre, et
 * il apparaît dès que la base a préparé le montant.
 *
 * Au retour de la page du prestataire, l'adresse porte `?paiement=<id>` : on
 * demande alors à l'API de demander au PRESTATAIRE où en est le paiement. En
 * staging, `&simulateur=1` montre les deux boutons du simulateur à la place
 * d'une vraie page de carte.
 */
export function ARegler() {
  const { t, locale } = useI18n();
  const invalider = useInvalider();
  const principal = useEstPrincipal();
  const qc = useQueryClient();
  const paiements = useQuery({
    queryKey: ["mes-paiements"],
    queryFn: () => office().facturation.mesPaiements(),
    enabled: principal,
    retry: false,
  });
  const [retour, setRetour] = useState<string | null>(null);

  const ici = typeof window === "undefined" ? null : new URL(window.location.href);
  const revenu = ici?.searchParams.get("paiement") ?? null;
  const simulateur = ici?.searchParams.get("simulateur") === "1";

  const verifier = useMutation({
    mutationFn: (id: string) => office().facturation.verifierPaiement(id),
    onSuccess: async (p) => {
      setRetour(
        p.etat === "paye"
          ? t("pme.reglages.paiement.paye")
          : p.etat === "refuse"
            ? t("pme.reglages.paiement.refuse")
            : t("pme.reglages.paiement.enAttente"),
      );
      await qc.invalidateQueries({ queryKey: ["mes-paiements"] });
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  const simuler = useMutation({
    mutationFn: (p: { id: string; decision: "paye" | "refuse" }) =>
      office().facturation.simulerPaiement(p.id, p.decision),
    onSuccess: async (p) => {
      setRetour(
        p.etat === "paye" ? t("pme.reglages.paiement.paye") : t("pme.reglages.paiement.refuse"),
      );
      await invalider();
      await qc.invalidateQueries({ queryKey: ["mes-paiements"] });
    },
    onError: (e: unknown) => setRetour(refus(e, t)),
  });

  // Revenu du prestataire : une seule vérification, au montage.
  const { mutate: verifierUneFois } = verifier;
  useEffect(() => {
    if (principal && revenu && !simulateur) verifierUneFois(revenu);
  }, [principal, revenu, simulateur, verifierUneFois]);

  if (!principal) return null;
  const ouverts = (paiements.data ?? []).filter((p) => p.etat !== "paye");
  if (ouverts.length === 0 && !retour) return null;

  return (
    <div className="rows" data-a-regler>
      <div className="sec">
        <h2>{t("pme.reglages.paiement.titre")}</h2>
      </div>
      {ouverts.map((p) => (
        <div key={p.paiement_id} className="card abo" data-paiement={p.paiement_id}>
          <div className="nm">
            <b>{libelleDuPaiement(p, t)}</b>
            <span className="px">
              {t("pme.reglages.paiement.montant", {
                ttc: montant(p.montant_ttc, locale),
                devise: p.devise,
              })}
            </span>
          </div>
          {p.etat === "refuse" ? <p className="warn">{t("pme.reglages.paiement.refuse")}</p> : null}
          {simulateur && revenu === p.paiement_id ? (
            <>
              <p className="t-body">{t("pme.reglages.paiement.simulateur")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  style={{ width: "auto" }}
                  disabled={simuler.isPending}
                  onClick={() => simuler.mutate({ id: p.paiement_id, decision: "paye" })}
                >
                  {t("pme.reglages.paiement.simuler.payer")}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ width: "auto" }}
                  disabled={simuler.isPending}
                  onClick={() => simuler.mutate({ id: p.paiement_id, decision: "refuse" })}
                >
                  {t("pme.reglages.paiement.simuler.refuser")}
                </button>
              </div>
            </>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Ce bloc n'existe que sur le web et la PWA (`COMMERCE`). Le moyen
                  se choisit sur sa page : logos et noms viennent des tables. */}
              <Link
                to="/pme/payer/$paiementId"
                params={{ paiementId: p.paiement_id }}
                className="btn"
              >
                {t("pme.reglages.paiement.payer")}
              </Link>
              {p.etat === "lien_cree" ? (
                <button
                  type="button"
                  className="btn"
                  style={{ width: "auto" }}
                  disabled={verifier.isPending}
                  onClick={() => verifier.mutate(p.paiement_id)}
                >
                  {t("pme.reglages.paiement.verifier")}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ))}
      {retour ? (
        <p className="t-body" aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/** L'état d'une facture (`facturation.encours_v`), dit dans la langue de la personne. */
const ETAT_DE_FACTURE: Record<FactureDuTitulaire["etat"], MessageKey> = {
  a_echoir: "pme.reglages.factures.etat.a_echoir",
  en_retard: "pme.reglages.factures.etat.en_retard",
  partielle: "cab.abo.fac.statut.partielle",
  payee: "cab.abo.fac.statut.payee",
  annulee: "cab.abo.fac.statut.annulee",
  irrecouvrable: "cab.abo.fac.statut.irrecouvrable",
};

/**
 * Vos factures — et le paiement en ligne de ce qui reste dû (23 octobre 2026).
 *
 * Décisions de Wissem : on paie le RESTE DÛ, en entier ; le paiement s'inscrit
 * sur la facture dès que le prestataire le confirme ; une licence suspendue
 * pour impayé reprend d'elle-même quand plus aucune facture n'est en retard.
 * L'écran ne calcule rien : l'état et le reste dû viennent de
 * `facturation.encours_v`, le montant du paiement de la base. « Payer » mène à
 * la page de choix du moyen, comme tout paiement en ligne.
 *
 * Web et PWA seulement : ce bloc est rendu sous `COMMERCE`.
 */
export function MesFactures() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const principal = useEstPrincipal();
  const [erreur, setErreur] = useState<string | null>(null);
  const factures = useQuery({
    queryKey: ["mes-factures"],
    queryFn: () => office().facturation.mesFactures(),
    enabled: principal,
    retry: false,
  });
  const payer = useMutation({
    mutationFn: (factureId: string) => office().facturation.payerFacture(factureId),
    onSuccess: async (p) => {
      // La page de choix lit `mes-paiements` : le paiement neuf doit y être
      // avant d'y arriver, sinon elle dirait « rien à régler ».
      await qc.invalidateQueries({ queryKey: ["mes-paiements"] });
      await navigate({ to: "/pme/payer/$paiementId", params: { paiementId: p.paiement_id } });
    },
    onError: (e: unknown) => setErreur(refus(e, t)),
  });

  if (!principal || !factures.data || factures.data.length === 0) return null;

  return (
    <div className="rows" data-mes-factures>
      <div className="sec">
        <h2>{t("pme.reglages.factures.titre")}</h2>
      </div>
      {factures.data.map((f) => {
        const due = f.etat === "a_echoir" || f.etat === "en_retard" || f.etat === "partielle";
        return (
          <div key={f.facture_id} className="card abo" data-facture={f.facture_id}>
            <div className="nm">
              <b>{f.numero}</b>
              <span className="px">{montant(f.montant_ttc, locale)}</span>
            </div>
            <p className="ttc">
              {f.periode.slice(0, 7)} · {t(ETAT_DE_FACTURE[f.etat])}
            </p>
            {due ? (
              <>
                <p className={f.etat === "en_retard" ? "warn" : "t-body"}>
                  {t("pme.reglages.factures.reste", {
                    montant: montant(f.reste_du, locale),
                    devise: f.devise,
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn"
                    disabled={payer.isPending}
                    onClick={() => payer.mutate(f.facture_id)}
                  >
                    {t("pme.reglages.paiement.payer")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        );
      })}
      {erreur ? (
        <p className="warn" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
