/**
 * Les factures de la plateforme (écran de la tour, 23 novembre 2026).
 *
 * Décision du dirigeant : Malica Office émet ses propres factures, série `MO-TN-I11`, hors
 * El Fatoora. Deux cartes :
 *
 *   - le RÉGLAGE : la série, et ce que chaque facture imprime au-delà de ses lignes — l'adresse
 *     de l'émetteur, son RNE, son site, les conditions de paiement, les coordonnées bancaires.
 *     Daté, motivé, en ajout seul (`plateforme.factures_regler`) ; un aperçu dessine la
 *     dernière facture émise avec ce qui est saisi, sous un filigrane « spécimen » ;
 *   - les FACTURES ÉMISES : chacune se télécharge en PDF, et le courriel d'une facture de
 *     société se renvoie (`plateforme.facture_renvoyer`, une fois par facture dans la fenêtre
 *     du moteur).
 *
 * L'écran ne valide rien lui-même : la base juge la série, la date et le motif, et l'écran
 * dit son refus. Aucune coordonnée bancaire n'est écrite dans le code : elles se saisissent ici.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useTelechargerLaFacture } from "@/hooks/use-telecharger-la-facture";
import { useI18n, type MessageKey } from "@/i18n";
import { jourOuInstant, montant, montantEtDevise } from "@/lib/lisible";
import { ETAT_DE_FACTURE } from "@/lib/paiement";
import { office } from "@/verticals/malica-office/composition";
import type {
  EnteteDeFacture,
  FactureDeLaTour,
  SaisieDesFactures,
} from "@malica/socle/ports/repositories";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

const VIDE: SaisieDesFactures = {
  serie: "",
  chiffres: 6,
  adresse: null,
  rne: null,
  site_web: null,
  conditions_paiement: null,
  banque_titulaire: null,
  banque_nom: null,
  banque_agence: null,
  banque_rib: null,
  banque_iban: null,
  banque_bic: null,
  banque_devise: null,
};

/** Les champs d'une ligne, dans l'ordre de la facture imprimée. */
const CHAMPS_SIMPLES: ReadonlyArray<[keyof SaisieDesFactures, MessageKey]> = [
  ["rne", "tour.factures.rne"],
  ["site_web", "tour.factures.site"],
];
const CHAMPS_BANQUE: ReadonlyArray<[keyof SaisieDesFactures, MessageKey]> = [
  ["banque_titulaire", "tour.factures.banque.titulaire"],
  ["banque_nom", "tour.factures.banque.banque"],
  ["banque_agence", "tour.factures.banque.agence"],
  ["banque_rib", "tour.factures.banque.rib"],
  ["banque_iban", "tour.factures.banque.iban"],
  ["banque_bic", "tour.factures.banque.bic"],
  ["banque_devise", "tour.factures.banque.devise"],
];

const ZONE = "min-h-[76px] w-full border border-border bg-background px-2 py-1 text-[13px]";
const SECONDAIRE =
  "h-[34px] border border-border px-3 text-[12.5px] font-medium disabled:opacity-40";

const texte = (v: string | number | null): string => (v === null ? "" : String(v));
const ouNul = (v: string): string | null => (v.trim() === "" ? null : v);

/** L'en-tête lu, revu par la saisie : ce que l'aperçu imprime. */
function enteteRevu(e: EnteteDeFacture, s: SaisieDesFactures): EnteteDeFacture {
  return {
    ...e,
    emetteur: e.emetteur
      ? {
          ...e.emetteur,
          adresse: s.adresse ?? e.emetteur.adresse,
          rne: s.rne,
          site_web: s.site_web,
        }
      : null,
    conditions_paiement: s.conditions_paiement,
    banque:
      s.banque_rib || s.banque_iban
        ? {
            titulaire: s.banque_titulaire,
            banque: s.banque_nom,
            agence: s.banque_agence,
            rib: s.banque_rib,
            iban: s.banque_iban,
            bic: s.banque_bic,
            devise: s.banque_devise,
          }
        : null,
  };
}

export function ReglerLesFactures() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const reglage = useQuery({
    queryKey: ["tour-factures-reglage"],
    queryFn: () => office().tour.reglageFactures(),
  });
  const emises = useQuery({
    queryKey: ["tour-factures-emises"],
    queryFn: () => office().tour.facturesEmises(),
  });
  const [saisie, setSaisie] = useState<SaisieDesFactures>(VIDE);
  const [depuis, setDepuis] = useState(new Date().toISOString().slice(0, 10));
  const [motif, setMotif] = useState("");
  const { telecharger, erreur } = useTelechargerLaFacture();

  useEffect(() => {
    const v = reglage.data?.en_vigueur;
    if (!v) return;
    // Seuls les champs de la saisie : ni la date, ni le motif, ni l'auteur de la version lue.
    setSaisie(
      Object.fromEntries(
        (Object.keys(VIDE) as (keyof SaisieDesFactures)[]).map((k) => [k, v[k]]),
      ) as unknown as SaisieDesFactures,
    );
  }, [reglage.data]);

  const regler = useMutation({
    mutationFn: () => office().tour.reglerFactures(saisie, depuis, motif.trim()),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-factures-reglage"] });
    },
    onError: echec,
  });

  const poser = (cle: keyof SaisieDesFactures, valeur: string) =>
    setSaisie((s) => ({
      ...s,
      [cle]: cle === "chiffres" ? Number(valeur) : cle === "serie" ? valeur : ouNul(valeur),
    }));
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  const v = reglage.data?.en_vigueur ?? null;
  const exemple = `${saisie.serie.trim().toUpperCase()}-${depuis.slice(0, 4)}-${"1".padStart(
    Math.max(1, saisie.chiffres),
    "0",
  )}`;
  const derniere = emises.data?.[0] ?? null;

  const ligne = (cle: keyof SaisieDesFactures, libelle: MessageKey) => (
    <label key={cle} className={`${TEXTE} flex flex-wrap items-center gap-2`}>
      <span className="w-full sm:w-[220px]">{t(libelle)}</span>
      <input
        value={texte(saisie[cle])}
        onChange={(ev) => poser(cle, ev.target.value)}
        aria-label={t(libelle)}
        className={CHAMP}
        dir="auto"
      />
    </label>
  );

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.factures")}</h2>
      <p className={TEXTE}>{t("tour.factures.aide")}</p>
      {v ? (
        <p className={TEXTE}>
          {t("tour.factures.en_vigueur", { date: date(v.valide_des), serie: v.serie })}
          {v.livre ? ` ${t("tour.factures.livre")}` : ""}
        </p>
      ) : null}
      {(reglage.data?.a_venir ?? []).map((a) => (
        <p key={`${a.valide_des}-${a.decide_le}`} className={TEXTE}>
          {t("tour.factures.a_venir", { date: date(a.valide_des), serie: a.serie })}
        </p>
      ))}

      <div className="mt-2 flex flex-col gap-2">
        {ligne("serie", "tour.factures.serie")}
        <label className={`${TEXTE} flex flex-wrap items-center gap-2`}>
          <span className="w-full sm:w-[220px]">{t("tour.factures.chiffres")}</span>
          <input
            type="number"
            min={4}
            max={9}
            value={saisie.chiffres}
            onChange={(ev) => poser("chiffres", ev.target.value)}
            aria-label={t("tour.factures.chiffres")}
            className={CHAMP}
          />
        </label>
        <p className={TEXTE}>
          {t("tour.factures.exemple")} <span className="font-mono text-foreground">{exemple}</span>
        </p>

        <label className={`${TEXTE} flex flex-col gap-1`}>
          {t("tour.factures.adresse")}
          <textarea
            value={texte(saisie.adresse)}
            onChange={(ev) => poser("adresse", ev.target.value)}
            className={ZONE}
            dir="auto"
          />
        </label>
        {CHAMPS_SIMPLES.map(([cle, libelle]) => ligne(cle, libelle))}
        <label className={`${TEXTE} flex flex-col gap-1`}>
          {t("tour.factures.conditions")}
          <textarea
            value={texte(saisie.conditions_paiement)}
            onChange={(ev) => poser("conditions_paiement", ev.target.value)}
            className={ZONE}
            dir="auto"
          />
        </label>

        <h3 className="mt-2 text-[13px] font-semibold">{t("tour.factures.banque")}</h3>
        {CHAMPS_BANQUE.map(([cle, libelle]) => ligne(cle, libelle))}

        <label className={`${TEXTE} flex flex-wrap items-center gap-2`}>
          <span className="w-full sm:w-[220px]">{t("tour.factures.depuis")}</span>
          <input
            type="date"
            value={depuis}
            onChange={(ev) => setDepuis(ev.target.value)}
            className={CHAMP}
          />
        </label>
        <input
          value={motif}
          onChange={(ev) => setMotif(ev.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BOUTON}
            disabled={regler.isPending || motif.trim() === "" || !reglage.isSuccess}
            onClick={() => regler.mutate()}
          >
            {t("tour.enregistrer")}
          </button>
          <button
            type="button"
            className={SECONDAIRE}
            disabled={!derniere || telecharger.isPending}
            onClick={() =>
              derniere &&
              telecharger.mutate({
                factureId: derniere.facture_id,
                apercu: (e) => enteteRevu(e, saisie),
              })
            }
          >
            {t("tour.factures.apercu")}
          </button>
        </div>
        {emises.isSuccess && !derniere ? (
          <p className={TEXTE}>{t("tour.factures.apercu.aucune")}</p>
        ) : null}
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
      {erreur ? (
        <p className={ALERTE} role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/** La facture choisie pour un renvoi, en attente de son motif. */
interface Renvoi {
  facture: FactureDeLaTour;
  motif: string;
}

export function LesFacturesEmises() {
  const { t, locale } = useI18n();
  const { retour, setRetour, echec } = useRetour();
  const emises = useQuery({
    queryKey: ["tour-factures-emises"],
    queryFn: () => office().tour.facturesEmises(),
  });
  const { telecharger, erreur } = useTelechargerLaFacture();
  const [renvoi, setRenvoi] = useState<Renvoi | null>(null);

  const renvoyer = useMutation({
    mutationFn: (r: Renvoi) => office().tour.renvoyerFacture(r.facture.facture_id, r.motif.trim()),
    onSuccess: (r) => {
      setRenvoi(null);
      setRetour(
        r.deja
          ? t("tour.factures.deja", { numero: r.numero })
          : r.poste
            ? t("tour.factures.renvoyee", { numero: r.numero })
            : t("tour.factures.abandon", { numero: r.numero }),
      );
    },
    onError: echec,
  });

  const factures = emises.data ?? [];
  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.factures.emises")}</h2>
      <p className={TEXTE}>{t("tour.factures.emises.aide")}</p>
      {emises.isSuccess && factures.length === 0 ? (
        <p className={TEXTE}>{t("tour.factures.emises.aucune")}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {factures.map((f) => (
          <li key={f.facture_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <span className="min-w-[200px] flex-1">
              <span className="block font-mono text-[13px] text-foreground">{f.numero}</span>
              <span className={`${TEXTE} block`}>
                {jourOuInstant(f.emise_le, locale, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
                {" · "}
                {f.destinataire}
                {" · "}
                {t(
                  f.payeur_type === "cabinet"
                    ? "tour.factures.payeur.cabinet"
                    : "tour.factures.payeur.titulaire",
                )}
                {f.etat ? ` · ${t(ETAT_DE_FACTURE[f.etat])}` : ""}
              </span>
            </span>
            <span className="font-mono text-[13px] text-foreground" dir="ltr">
              {montantEtDevise(montant(f.montant_ttc, locale), f.devise)}
            </span>
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className={SECONDAIRE}
                disabled={telecharger.isPending}
                onClick={() => telecharger.mutate({ factureId: f.facture_id })}
              >
                {t("tour.factures.telecharger")}
              </button>
              {f.payeur_type === "titulaire" ? (
                <button
                  type="button"
                  className={SECONDAIRE}
                  disabled={renvoyer.isPending}
                  onClick={() => setRenvoi({ facture: f, motif: "" })}
                >
                  {t("tour.factures.renvoyer")}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {renvoi ? (
        <div className="flex flex-col gap-2">
          <p className={TEXTE}>
            {t("tour.factures.renvoyer.confirmer", { numero: renvoi.facture.numero })}
          </p>
          <input
            value={renvoi.motif}
            onChange={(ev) => setRenvoi({ ...renvoi, motif: ev.target.value })}
            placeholder={t("common.motif")}
            aria-label={t("common.motif")}
            className={CHAMP}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BOUTON}
              disabled={renvoyer.isPending || renvoi.motif.trim() === ""}
              onClick={() => renvoyer.mutate(renvoi)}
            >
              {t("tour.factures.renvoyer")}
            </button>
            <button
              type="button"
              className={SECONDAIRE}
              disabled={renvoyer.isPending}
              onClick={() => setRenvoi(null)}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
      {erreur ? (
        <p className={ALERTE} role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}

/**
 * L'argent qui attend : reçu, pas encore imputé à une facture (un acompte d'avant D7, un
 * paiement plus grand que sa facture, un lien payé deux fois). Il s'applique de lui-même à
 * la facture suivante de la licence ; la tour le voit, et le rembourse au besoin (lot B).
 */
export function LesSoldesCrediteurs() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const soldes = useQuery({
    queryKey: ["tour-soldes-crediteurs"],
    queryFn: () => office().tour.soldesCrediteurs(),
  });
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [motif, setMotif] = useState("");
  const rembourser = useMutation({
    mutationFn: (l: { licence_id: string | null; cabinet_id: string | null }) =>
      office().tour.rembourserSolde(l.licence_id, l.cabinet_id, reference.trim(), motif.trim()),
    onSuccess: async (r) => {
      setRetour(
        t("tour.soldes.fait", { montant: montantEtDevise(montant(r.montant, locale), r.devise) }),
      );
      setOuvert(null);
      setReference("");
      setMotif("");
      await qc.invalidateQueries({ queryKey: ["tour-soldes-crediteurs"] });
    },
    onError: echec,
  });
  const lignes = soldes.data ?? [];
  return (
    <div className={CARTE} data-soldes-crediteurs>
      <h2 className={TITRE}>{t("tour.soldes.titre")}</h2>
      <p className={TEXTE}>{t("tour.soldes.aide")}</p>
      {soldes.isError ? <p className={ALERTE}>{t("common.error")}</p> : null}
      {soldes.isSuccess && lignes.length === 0 ? (
        <p className={TEXTE}>{t("tour.soldes.aucun")}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {lignes.map((l) => {
          const cle = l.licence_id ?? l.cabinet_id ?? "";
          return (
            <li key={cle} className="py-2" data-solde={cle}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-[200px] flex-1">
                  <span className="block text-foreground">{l.societe ?? l.titulaire}</span>
                  <span className={`${TEXTE} block`}>
                    {[
                      l.titulaire,
                      l.doubles > 0 ? t("tour.soldes.doubles", { count: l.doubles }) : "",
                      l.depuis
                        ? t("tour.soldes.depuis", {
                            date: jourOuInstant(l.depuis, locale, {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            }),
                          })
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="font-mono text-[13px] text-foreground" dir="ltr">
                  {montantEtDevise(montant(l.solde, locale), l.devise ?? "")}
                </span>
                <button
                  type="button"
                  className={BOUTON}
                  aria-expanded={ouvert === cle}
                  onClick={() => setOuvert(ouvert === cle ? null : cle)}
                >
                  {t("tour.soldes.rembourser")}
                </button>
              </div>
              {ouvert === cle ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className={TEXTE}>
                    {t("tour.soldes.reference")}
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className={`${CHAMP} mt-1 w-full`}
                    />
                  </label>
                  <input
                    value={motif}
                    onChange={(e) => setMotif(e.target.value)}
                    placeholder={t("common.motif")}
                    aria-label={t("common.motif")}
                    className={CHAMP}
                  />
                  <button
                    type="button"
                    className={BOUTON}
                    disabled={
                      rembourser.isPending || reference.trim() === "" || motif.trim() === ""
                    }
                    onClick={() => rembourser.mutate(l)}
                  >
                    {t("tour.soldes.inscrire")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Les relevés des comptabilités qui attendent leur paiement (D8). Un virement reçu
 * s'inscrit ici, par toute personne de la tour, au montant exact (D10) : la facture naît
 * aussitôt, réglée. En ligne, la comptabilité paie depuis son espace.
 */
export function LesRelevesAEncaisser() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const releves = useQuery({
    queryKey: ["tour-releves"],
    queryFn: () => office().tour.relevesAEncaisser(),
  });
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [montantRecu, setMontantRecu] = useState("");
  const [le, setLe] = useState("");
  const [reference, setReference] = useState("");
  const encaisser = useMutation({
    mutationFn: (releveId: string) =>
      office().tour.encaisserVirement(releveId, montantRecu.trim(), le, reference.trim()),
    onSuccess: async (r) => {
      setRetour(t("tour.releves.fait", { numero: r.numero }));
      setOuvert(null);
      setMontantRecu("");
      setLe("");
      setReference("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tour-releves"] }),
        qc.invalidateQueries({ queryKey: ["tour-factures-emises"] }),
      ]);
    },
    onError: echec,
  });
  const jour = (iso: string) =>
    jourOuInstant(iso, locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const lignes = releves.data ?? [];
  return (
    <div className={CARTE} data-releves>
      <h2 className={TITRE}>{t("tour.releves.titre")}</h2>
      <p className={TEXTE}>{t("tour.releves.aide")}</p>
      {releves.isError ? <p className={ALERTE}>{t("common.error")}</p> : null}
      {releves.isSuccess && lignes.length === 0 ? (
        <p className={TEXTE}>{t("tour.releves.aucun")}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {lignes.map((r) => {
          const suspendu = r.suspendu_le !== null && r.suspendu_le <= aujourdHui;
          const bloque = r.bloque_le !== null && r.bloque_le <= aujourdHui;
          return (
            <li key={r.releve_id} className="py-2" data-releve={r.releve_id}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="min-w-[200px] flex-1">
                  <span className="block text-foreground">
                    {r.cabinet} · <span className="num">{r.periode.slice(0, 7)}</span>
                  </span>
                  <span
                    className={`${TEXTE} block ${suspendu ? "text-signal-stop" : bloque ? "text-signal-warn" : ""}`}
                    data-etat
                  >
                    {suspendu
                      ? t("tour.releves.etat.suspendu", { date: jour(r.suspendu_le!) })
                      : bloque
                        ? t("tour.releves.etat.bloque", { date: jour(r.bloque_le!) })
                        : t("tour.releves.etat.attente", { date: jour(r.etabli_le) })}
                  </span>
                </span>
                <span className="font-mono text-[13px] text-foreground" dir="ltr">
                  {montantEtDevise(montant(r.montant_ttc, locale), r.devise)}
                </span>
                <button
                  type="button"
                  className={BOUTON}
                  aria-expanded={ouvert === r.releve_id}
                  onClick={() => setOuvert(ouvert === r.releve_id ? null : r.releve_id)}
                >
                  {t("tour.releves.virement")}
                </button>
              </div>
              {ouvert === r.releve_id ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className={TEXTE}>
                    {t("tour.releves.montant")}
                    <input
                      value={montantRecu}
                      onChange={(e) => setMontantRecu(e.target.value)}
                      inputMode="decimal"
                      dir="ltr"
                      className={`${CHAMP} mt-1 w-full`}
                    />
                  </label>
                  <label className={TEXTE}>
                    {t("tour.releves.date")}
                    <input
                      type="date"
                      value={le}
                      max={aujourdHui}
                      onChange={(e) => setLe(e.target.value)}
                      className={`${CHAMP} mt-1 w-full`}
                    />
                  </label>
                  <label className={TEXTE}>
                    {t("tour.releves.reference")}
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className={`${CHAMP} mt-1 w-full`}
                    />
                  </label>
                  <button
                    type="button"
                    className={BOUTON}
                    disabled={
                      encaisser.isPending ||
                      !/^\d+([.,]\d+)?$/.test(montantRecu.trim()) ||
                      le === "" ||
                      reference.trim() === ""
                    }
                    onClick={() => encaisser.mutate(r.releve_id)}
                  >
                    {t("tour.releves.encaisser")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
