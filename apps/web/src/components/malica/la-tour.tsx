/**
 * La tour, dans le SaaS — pour les opérateurs d'ALGORIA seulement.
 *
 * Pas dans l'application du client (décidé le 19 octobre 2026) : la tour est
 * un poste de travail d'ALGORIA, sur grand écran, dans la doctrine Edition One.
 *
 * Demandé le 19 octobre 2026 : « tout doit être paramétrable ». Le paiement,
 * l'émetteur des factures et la grille se règlent ICI, plus sur le serveur.
 * L'écran ne décide rien (R3) : il montre ce que la base rend, transmet le
 * geste, et dit le refus de la base. La base refuse tout à qui n'est pas
 * opérateur ; l'écran le dit et ne montre rien.
 *
 * Seuls les secrets du compte marchand restent sur le serveur : la tour dit
 * s'ils sont posés, jamais ce qu'ils valent.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { office } from "@/verticals/malica-office/composition";
import type {
  GrilleProposee,
  LigneDeRecharge,
  LigneDOffre,
  OrganisationEmettrice,
} from "@malica/socle/ports/repositories";

const OU = "components/malica/la-tour";
const CHAMP = "h-[38px] min-w-0 flex-1 border border-border bg-background px-2 text-[13px]";
const CARTE = "space-y-2 border border-border bg-card p-5";
const TITRE = "text-[15px] font-semibold";
const TEXTE = "text-[13px] leading-[1.5] text-muted-foreground";
const ALERTE = "text-[12.5px] text-signal-warn";
const BOUTON =
  "h-[38px] bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-40";

/** Les colonnes d'une offre qu'on règle, dans l'ordre de lecture, et leur libellé. */
const CHAMPS_OFFRE: Array<[string, MessageKey, "nombre" | "nombre_vide" | "case"]> = [
  ["prix_mensuel_ht", "tour.champ.prix_mensuel_ht", "nombre"],
  ["lectures_par_organisation", "tour.champ.lectures_par_organisation", "nombre"],
  ["sieges_inclus", "tour.champ.sieges_inclus", "nombre"],
  ["sieges_max", "tour.champ.sieges_max", "nombre_vide"],
  ["prix_siege_sup", "tour.champ.prix_siege_sup", "nombre"],
  ["lectures_par_siege_sup", "tour.champ.lectures_par_siege_sup", "nombre"],
  ["organisations_incluses", "tour.champ.organisations_incluses", "nombre"],
  ["organisations_max", "tour.champ.organisations_max", "nombre_vide"],
  ["prix_organisation_sup", "tour.champ.prix_organisation_sup", "nombre"],
  ["recharges_permises", "tour.champ.recharges_permises", "case"],
];
const CHAMPS_RECHARGE: Array<[string, MessageKey]> = [
  ["prix_ht", "tour.champ.prix_ht"],
  ["lectures", "tour.champ.lectures"],
  ["validite_mois", "tour.champ.validite_mois"],
];

/** Les trous que la base nomme, et leur phrase. */
const TROUS: Record<string, MessageKey> = {
  date_passee: "tour.trou.date_passee",
  offres_absentes: "tour.trou.offres_absentes",
  offre_manquante: "tour.trou.offre_manquante",
  rang_double: "tour.trou.rang_double",
  offre_incomplete: "tour.trou.offre_incomplete",
  places_incoherentes: "tour.trou.places_incoherentes",
  prix_non_croissant: "tour.trou.prix_non_croissant",
  lectures_non_croissantes: "tour.trou.lectures_non_croissantes",
  personnes_decroissantes: "tour.trou.personnes_decroissantes",
  monter_coute_plus_a_la_lecture: "tour.trou.monter_coute_plus_a_la_lecture",
  recharge_incomplete: "tour.trou.recharge_incomplete",
  recharge_brule_l_offre_suivante: "tour.trou.recharge_brule_l_offre_suivante",
  paliers_non_croissants: "tour.trou.paliers_non_croissants",
  gros_palier_moins_avantageux: "tour.trou.gros_palier_moins_avantageux",
};

/** Demain, au format de la base : une grille ne se publie jamais pour hier. */
function demain(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** La tour, si l'appelant est opérateur ; rien sinon. */
export function LaTour() {
  const { t } = useI18n();
  const plateforme = useQuery({
    queryKey: ["tour-suis-je"],
    queryFn: () => office().tour.suisJePlateforme(),
    retry: false,
  });
  if (plateforme.isPending) return <p className={TEXTE}>{t("common.loading")}</p>;
  if (!plateforme.data) return <p className={TEXTE}>{t("tour.reserve")}</p>;
  return (
    <div data-tour className="grid gap-6">
      <ReglerLePaiement />
      <DesignerLEmetteur />
      <LaGrille />
      <ReglerLAbonnement />
      <LesLicences />
    </div>
  );
}

/* --------------------------------------------------------- l'abonnement */

/**
 * L'abonnement, réglé par la tour (19 octobre 2026) : le report d'un mois, et
 * l'année — ouverte ou non, et combien de mois elle offre.
 *
 * La base calcule tout (`facturation.report_de`, `public.mon_annuel`) ; la
 * tour ne règle que les interrupteurs et le nombre, datés et motivés. Un
 * changement de mois offerts ne touche pas les engagements déjà pris : ils
 * gardent le nombre du jour où ils ont été souscrits.
 */
function ReglerLAbonnement() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-abonnement"],
    queryFn: () => office().tour.reglageAbonnement(),
  });
  const [report, setReport] = useState<0 | 1>(1);
  const [annuel, setAnnuel] = useState(true);
  const [offerts, setOfferts] = useState("2");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (!reglage.data) return;
    setReport(reglage.data.report_mois === 1 ? 1 : 0);
    setAnnuel(reglage.data.annuel_ouvert);
    setOfferts(String(reglage.data.annuel_mois_offerts));
  }, [reglage.data]);

  const nOfferts = Number.parseInt(offerts, 10);
  const offertsValide = Number.isInteger(nOfferts) && nOfferts >= 0 && nOfferts <= 11;

  const regler = useMutation({
    mutationFn: () => office().tour.reglerAbonnement(report, annuel, nOfferts, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-abonnement"] });
    },
    onError: echec,
  });

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.abonnement")}</h2>
      <p className={TEXTE}>{t("tour.abonnement.report.aide")}</p>
      {reglage.data?.decide_le ? (
        <p className={TEXTE}>
          {t(
            reglage.data.report_mois === 1
              ? "tour.abonnement.report.oui"
              : "tour.abonnement.report.non",
            {
              date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                new Date(reglage.data.decide_le),
              ),
            },
          )}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <select
          value={report}
          onChange={(e) => setReport(e.target.value === "1" ? 1 : 0)}
          aria-label={t("tour.abonnement.report")}
          className={CHAMP}
        >
          <option value="1">{t("tour.abonnement.report.un")}</option>
          <option value="0">{t("tour.abonnement.report.aucun")}</option>
        </select>
        <p className={TEXTE}>{t("tour.abonnement.annuel.aide")}</p>
        <select
          value={annuel ? "1" : "0"}
          onChange={(e) => setAnnuel(e.target.value === "1")}
          aria-label={t("tour.abonnement.annuel")}
          className={CHAMP}
        >
          <option value="1">{t("tour.abonnement.annuel.ouvert")}</option>
          <option value="0">{t("tour.abonnement.annuel.ferme")}</option>
        </select>
        <label className={TEXTE}>
          {t("tour.abonnement.annuel.offerts")}
          <input
            value={offerts}
            onChange={(e) => setOfferts(e.target.value)}
            inputMode="numeric"
            aria-label={t("tour.abonnement.annuel.offerts")}
            className={`${CHAMP} mt-1 w-full`}
          />
        </label>
        {!offertsValide ? (
          <p className={ALERTE}>{t("tour.abonnement.annuel.offerts.borne")}</p>
        ) : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("tour.motif")}
          aria-label={t("tour.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={regler.isPending || motif.trim() === "" || !offertsValide}
          onClick={() => regler.mutate()}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

function useRetour() {
  const { t } = useI18n();
  const [retour, setRetour] = useState<string | null>(null);
  const echec = (e: unknown) => setRetour(texteDeLErreur(e, OU, t("common.error")));
  return { retour, setRetour, echec };
}

/* ------------------------------------------------------------- le paiement */

function ReglerLePaiement() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-paiement"],
    queryFn: () => office().tour.reglagePaiement(),
  });
  const [prestataire, setPrestataire] = useState<"aucun" | "simulateur" | "clictopay">("aucun");
  const [urlApi, setUrlApi] = useState("");
  const [urlRetour, setUrlRetour] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = reglage.data;
    if (!r) return;
    setPrestataire(r.prestataire);
    setUrlApi(r.url_api ?? "");
    setUrlRetour(r.url_retour ?? (typeof window === "undefined" ? "" : window.location.origin));
  }, [reglage.data]);

  const regler = useMutation({
    mutationFn: () =>
      office().tour.reglerPaiement(prestataire, urlApi || null, urlRetour || null, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-paiement"] });
    },
    onError: echec,
  });

  const libelle: Record<string, MessageKey> = {
    aucun: "tour.paiement.aucun",
    simulateur: "tour.paiement.simulateur",
    clictopay: "tour.paiement.clictopay",
  };

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.paiement")}</h2>
      {reglage.data ? (
        <p className={TEXTE}>
          {t("tour.paiement.actuel", { prestataire: t(libelle[reglage.data.prestataire]!) })}
          {" — "}
          {reglage.data.secrets_clictopay
            ? t("tour.paiement.secretsOui")
            : t("tour.paiement.secretsNon")}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        <select
          value={prestataire}
          onChange={(e) => setPrestataire(e.target.value as typeof prestataire)}
          aria-label={t("tour.paiement.prestataire")}
          className={CHAMP}
        >
          {(["aucun", "simulateur", "clictopay"] as const).map((p) => (
            <option key={p} value={p}>
              {t(libelle[p]!)}
            </option>
          ))}
        </select>
        {prestataire === "clictopay" ? (
          <input
            value={urlApi}
            onChange={(e) => setUrlApi(e.target.value)}
            placeholder={t("tour.paiement.urlApi")}
            aria-label={t("tour.paiement.urlApi")}
            className={CHAMP}
          />
        ) : null}
        {prestataire !== "aucun" ? (
          <input
            value={urlRetour}
            onChange={(e) => setUrlRetour(e.target.value)}
            placeholder={t("tour.paiement.urlRetour")}
            aria-label={t("tour.paiement.urlRetour")}
            className={CHAMP}
          />
        ) : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("tour.motif")}
          aria-label={t("tour.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={regler.isPending || motif.trim() === ""}
          onClick={() => regler.mutate()}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- l'émetteur */

function DesignerLEmetteur() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const emetteur = useQuery({
    queryKey: ["tour-emetteur"],
    queryFn: () => office().tour.emetteur(),
  });
  const [texte, setTexte] = useState("");
  const [depuis, setDepuis] = useState(new Date().toISOString().slice(0, 10));
  const trouvees = useQuery({
    queryKey: ["tour-organisations", texte],
    queryFn: () => office().tour.chercherOrganisations(texte),
    enabled: texte.trim().length >= 2,
  });

  const designer = useMutation({
    mutationFn: (o: OrganisationEmettrice) =>
      office().tour.designerEmetteur(o.organisation_id, depuis),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      await qc.invalidateQueries({ queryKey: ["tour-emetteur"] });
    },
    onError: echec,
  });

  const e = emetteur.data;
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.emetteur")}</h2>
      <p className={TEXTE}>
        {e
          ? t("tour.emetteur.actuel", {
              nom: e.nom,
              matricule: e.matricule ?? "—",
              date: e.valide_des
                ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
                    new Date(`${e.valide_des}T00:00:00Z`),
                  )
                : "—",
            })
          : t("tour.emetteur.aucun")}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <input
          value={texte}
          onChange={(ev) => setTexte(ev.target.value)}
          placeholder={t("tour.emetteur.chercher")}
          aria-label={t("tour.emetteur.chercher")}
          className={CHAMP}
        />
        <label className={TEXTE}>
          {t("tour.emetteur.depuis")}{" "}
          <input
            type="date"
            value={depuis}
            onChange={(ev) => setDepuis(ev.target.value)}
            className={CHAMP}
          />
        </label>
        {(trouvees.data ?? []).map((o) => (
          <button
            key={o.organisation_id}
            type="button"
            className={BOUTON}
            disabled={designer.isPending}
            onClick={() => designer.mutate(o)}
          >
            {t("tour.emetteur.designer", { nom: `${o.nom} · ${o.matricule ?? "—"}` })}
          </button>
        ))}
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- la grille */

function LaGrille() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const enVigueur = useQuery({
    queryKey: ["tour-grille"],
    queryFn: () => office().tour.grilleEnVigueur(),
  });
  const [grille, setGrille] = useState<GrilleProposee | null>(null);
  const [date, setDate] = useState(demain());
  const [motif, setMotif] = useState("");
  const [trous, setTrous] = useState<Array<{ code: string; detail: string }> | null>(null);

  useEffect(() => {
    if (enVigueur.data && !grille) setGrille(structuredClone(enVigueur.data));
  }, [enVigueur.data, grille]);

  const verifier = useMutation({
    mutationFn: () => office().tour.trousDeLaGrille(date, grille!.offres, grille!.recharges),
    onSuccess: (r) => {
      setTrous(r);
      setRetour(r.length === 0 ? t("tour.grille.sansTrou") : null);
    },
    onError: echec,
  });
  const publier = useMutation({
    mutationFn: () => office().tour.publierGrille(date, grille!.offres, grille!.recharges, motif),
    onSuccess: async () => {
      setTrous(null);
      setRetour(t("tour.grille.publiee", { date }));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-grille"] });
    },
    onError: echec,
  });

  if (!grille) return null;

  const changerOffre = (i: number, cle: string, valeur: string | boolean | null) => {
    const g = structuredClone(grille);
    (g.offres[i] as LigneDOffre)[cle] = valeur;
    setGrille(g);
    setTrous(null);
  };
  const changerRecharge = (i: number, cle: string, valeur: string) => {
    const g = structuredClone(grille);
    (g.recharges[i] as LigneDeRecharge)[cle] = valeur;
    setGrille(g);
    setTrous(null);
  };

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.grille")}</h2>
      <label className={`${TEXTE} block`}>
        {t("tour.grille.date")}{" "}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={CHAMP}
        />
      </label>

      <p className={TEXTE}>
        <b>{t("tour.grille.offres")}</b> — {t("tour.grille.vide")}
      </p>
      {grille.offres.map((o, i) => (
        <fieldset key={o.code} className="mt-2" data-offre={o.code}>
          <legend>
            <b>{String(o["libelle"] ?? o.code)}</b>
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {CHAMPS_OFFRE.map(([cle, libelle, forme]) =>
              forme === "case" ? (
                <label key={cle} className={TEXTE}>
                  <input
                    type="checkbox"
                    checked={Boolean(o[cle])}
                    onChange={(e) => changerOffre(i, cle, e.target.checked)}
                  />{" "}
                  {t(libelle)}
                </label>
              ) : (
                <label key={cle} className={`${TEXTE} flex flex-col gap-1`}>
                  {t(libelle)}
                  <input
                    inputMode="decimal"
                    value={o[cle] === null || o[cle] === undefined ? "" : String(o[cle])}
                    onChange={(e) =>
                      changerOffre(
                        i,
                        cle,
                        forme === "nombre_vide" && e.target.value.trim() === ""
                          ? null
                          : e.target.value.replace(",", "."),
                      )
                    }
                    className={CHAMP}
                  />
                </label>
              ),
            )}
          </div>
        </fieldset>
      ))}

      <p className={TEXTE}>
        <b>{t("tour.grille.recharges")}</b>
      </p>
      {grille.recharges.map((r, i) => (
        <fieldset key={r.code} className="mt-2" data-recharge={r.code}>
          <legend>
            <b>{String(r["libelle"] ?? r.code)}</b>
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {CHAMPS_RECHARGE.map(([cle, libelle]) => (
              <label key={cle} className={`${TEXTE} flex flex-col gap-1`}>
                {t(libelle)}
                <input
                  inputMode="decimal"
                  value={r[cle] === null || r[cle] === undefined ? "" : String(r[cle])}
                  onChange={(e) => changerRecharge(i, cle, e.target.value.replace(",", "."))}
                  className={CHAMP}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          className={BOUTON}
          disabled={verifier.isPending}
          onClick={() => verifier.mutate()}
        >
          {t("tour.grille.verifier")}
        </button>
        {(trous ?? []).map((x, k) => (
          <p key={`${x.code}-${k}`} className={ALERTE}>
            {TROUS[x.code] ? t(TROUS[x.code]!, { detail: x.detail }) : `${x.code} ${x.detail}`}
          </p>
        ))}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("tour.motif")}
          aria-label={t("tour.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={publier.isPending || motif.trim() === "" || trous === null || trous.length > 0}
          onClick={() => publier.mutate()}
        >
          {t("tour.grille.publier")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- les licences */

function LesLicences() {
  const { t } = useI18n();
  const licences = useQuery({
    queryKey: ["tour-licences"],
    queryFn: () => office().tour.licences(),
  });
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.licences")}</h2>
      {(licences.data ?? []).map((l) => (
        <p key={l.licence_id} className={TEXTE} data-licence={l.licence_id}>
          <b>{l.societes ?? "—"}</b>
          <br />
          {t("tour.licences.ligne", {
            offre: l.offre_code,
            statut: l.statut,
            lectures: l.lectures_consommees,
            droit: l.lectures_droit,
            sieges: l.sieges_occupes,
            recharges: l.recharges_disponibles,
          })}
        </p>
      ))}
    </div>
  );
}
