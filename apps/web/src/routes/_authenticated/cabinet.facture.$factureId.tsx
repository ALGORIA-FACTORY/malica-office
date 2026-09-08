/**
 * Une facture d'honoraires — brouillon modifiable, puis pièce figée.
 *
 * ============================================================== POURQUOI
 *
 * Tant qu'elle est brouillon, la facture se réécrit : lignes, période, taux
 * du pack. Émise, elle prend son numéro et ne bouge plus (R7) : elle
 * s'encaisse jusqu'à être soldée, ou s'annule par un avoir qui la reprend en
 * négatif. Les totaux viennent de la base à chaque enregistrement — l'écran
 * ne multiplie rien, n'additionne rien.
 *
 * Pas d'export PDF : aucun moteur ne le produit encore, donc aucun bouton.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { EmptyState, MalicaNote } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { sommeDecimale } from "@malica/socle/somme-decimale";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  FactureHonorairesDossier,
  LigneHonorairesSaisie,
} from "@malica/socle/ports/repositories";

import { LignesEditables } from "./cabinet.honoraires";

export const Route = createFileRoute("/_authenticated/cabinet/facture/$factureId")({
  head: () => ({
    meta: [
      { title: "Facture d'honoraires — Malica Office" },
      {
        name: "description",
        content:
          "Une facture d'honoraires du cabinet : brouillon modifiable, puis pièce numérotée et figée, encaissée ou annulée par avoir.",
      },
      { property: "og:title", content: "Facture d'honoraires — Malica Office" },
      {
        property: "og:description",
        content:
          "Une facture d'honoraires du cabinet : brouillon modifiable, puis pièce numérotée et figée, encaissée ou annulée par avoir.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CabinetFacture,
});

const OU = "routes/_authenticated/cabinet.facture";
const STATUTS: Record<string, MessageKey> = {
  brouillon: "cab.hono.statut.brouillon",
  emise: "cab.hono.statut.emise",
  payee: "cab.hono.statut.payee",
  annulee: "cab.hono.statut.annulee",
};
const MODES: Record<string, MessageKey> = {
  forfait: "cab.hono.mode.forfait",
  temps: "cab.hono.mode.temps",
  mixte: "cab.hono.mode.mixte",
};
const FREQUENCES: Record<string, MessageKey> = {
  mensuelle: "cab.hono.freq.mensuelle",
  trimestrielle: "cab.hono.freq.trimestrielle",
  annuelle: "cab.hono.freq.annuelle",
};
const MOYENS: Record<string, MessageKey> = {
  virement: "cab.hono.moyen.virement",
  cheque: "cab.hono.moyen.cheque",
  especes: "cab.hono.moyen.especes",
  carte: "cab.hono.moyen.carte",
  autre: "cab.hono.moyen.autre",
};
const CHAMP =
  "border border-border bg-card px-2.5 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const ETIQUETTE =
  "block text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const BOUTON_ENCRE =
  "border border-foreground bg-foreground px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-background hover:bg-marigold hover:border-marigold hover:text-foreground disabled:opacity-40";
const BOUTON_PIERRE =
  "border border-border bg-card px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] hover:bg-accent disabled:opacity-40";

function CabinetFacture() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const { factureId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const facture = useQuery({
    queryKey: ["cab-hono-facture", factureId],
    queryFn: () => office().honoraires.facture(factureId),
  });
  const pack = useQuery({
    queryKey: ["ref-pack", org.jurisdiction],
    queryFn: () => office().referential.activePack(org.jurisdiction),
  });
  const taux = useQuery({
    queryKey: ["ref-taux", pack.data?.id, org.jurisdiction],
    queryFn: () => office().referential.taxRates(pack.data!.id, org.jurisdiction),
    enabled: Boolean(pack.data),
  });
  const tauxEnVigueur = (taux.data ?? []).filter(
    (r) => r.validFrom <= today && (!r.validTo || r.validTo >= today),
  );

  useMalicaPanel(<MalicaNote>{t("cab.hono.facture.panel")}</MalicaNote>, [locale]);

  const f = facture.data ?? null;

  /* ---- le brouillon, tel qu'on le saisit */
  const [lignes, setLignes] = useState<LigneHonorairesSaisie[]>([]);
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");
  const [code, setCode] = useState("");
  const [modifie, setModifie] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmerAvoir, setConfirmerAvoir] = useState(false);
  const [encaisser, setEncaisser] = useState(false);

  useEffect(() => {
    if (!f) return;
    setLignes(
      f.lignes.map((l) => ({
        libelle: l.libelle,
        quantite: l.quantite,
        prixUnitaire: l.prixUnitaire,
      })),
    );
    setDu(f.periodeDu);
    setAu(f.periodeAu);
    setCode(f.tauxTvaCode);
    setModifie(false);
  }, [f]);

  const rafraichir = () => {
    void qc.invalidateQueries({ queryKey: ["cab-hono-facture", factureId] });
    void qc.invalidateQueries({ queryKey: ["cab-hono-factures"] });
    void qc.invalidateQueries({ queryKey: ["cab-hono-synthese"] });
    void qc.invalidateQueries({ queryKey: ["cab-hono-encaissements"] });
  };
  const surErreur = (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error")));

  const enregistrer = useMutation({
    mutationFn: () =>
      office().honoraires.modifierBrouillon({
        id: factureId,
        periodeDu: du,
        periodeAu: au,
        tauxTvaCode: code,
        lignes,
      }),
    onSuccess: () => {
      // Ce qui est à l'écran est désormais ce qui est en base — même si la
      // relecture rend une facture identique et ne repasse pas par l'effet.
      setModifie(false);
      rafraichir();
    },
    onError: surErreur,
  });
  const emettre = useMutation({
    mutationFn: () => office().honoraires.emettre(factureId),
    onSuccess: rafraichir,
    onError: surErreur,
  });
  const supprimer = useMutation({
    mutationFn: () => office().honoraires.supprimerBrouillon(factureId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cab-hono-factures"] });
      void qc.invalidateQueries({ queryKey: ["cab-hono-synthese"] });
      void navigate({ to: "/cabinet/honoraires" });
    },
    onError: surErreur,
  });
  const avoir = useMutation({
    mutationFn: () => office().honoraires.avoir(factureId),
    onSuccess: ({ id }) => {
      rafraichir();
      setConfirmerAvoir(false);
      void navigate({ to: "/cabinet/facture/$factureId", params: { factureId: id } });
    },
    onError: surErreur,
  });

  const dateLongue = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const somme = (valeur: string) => `${montant(valeur, locale)} ${f?.devise ?? org.currency}`;

  if (facture.isPending) {
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!f) {
    return <EmptyState>{t("cab.hono.facture.introuvable")}</EmptyState>;
  }

  const brouillon = f.statut === "brouillon";
  // Un avoir n'attend aucun règlement : il n'est jamais en retard.
  const enRetard =
    f.statut === "emise" && !f.avoirDe && f.echeanceLe !== null && f.echeanceLe < today;
  const reste = sommeDecimale([f.totalTtc, `-${f.encaisse}`]);
  const libelleTaux =
    (taux.data ?? []).find((r) => r.code === f.tauxTvaCode)?.label ?? f.tauxTvaCode;
  const modifierLigne = (i: number, patch: Partial<LigneHonorairesSaisie>) => {
    setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setModifie(true);
  };

  // Ce que Malica vérifie : des faits, jamais une règle inventée.
  const verifications: Array<{ key: string; ok: boolean; label: string }> = [
    {
      key: "cabinet",
      ok: f.cabinet.legalId !== null,
      label: f.cabinet.legalId
        ? t("cab.hono.verif.cabinet.ok")
        : t("cab.hono.verif.cabinet.manque"),
    },
    {
      key: "client",
      ok: f.client.legalId !== null,
      label: f.client.legalId ? t("cab.hono.verif.client.ok") : t("cab.hono.verif.client.manque"),
    },
    {
      key: "lignes",
      ok: f.lignes.length > 0,
      label:
        f.lignes.length > 0 ? t("cab.hono.verif.lignes.ok") : t("cab.hono.verif.lignes.manque"),
    },
    {
      key: "mandat",
      ok: f.mandat !== null,
      label: f.mandat
        ? t("cab.hono.verif.mandat.ok", { count: f.mandat.delaiPaiementJours })
        : t("cab.hono.verif.mandat.manque"),
    },
  ];

  return (
    <div className="space-y-0">
      {/* ---- la barre */}
      <div className="border-b border-foreground bg-background pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/cabinet/honoraires"
            aria-label={t("cab.hono.facture.retour")}
            className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-card hover:bg-accent"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {brouillon
                ? t("cab.hono.facture.kicker.brouillon")
                : enRetard
                  ? t("cab.hono.statut.retard")
                  : t(STATUTS[f.statut] ?? "cab.hono.statut.emise")}
              {f.avoirDe ? ` · ${t("cab.hono.avoir.de")}` : ""}
            </p>
            <h1 className="mt-1 truncate text-[24px] font-semibold tracking-[-0.02em] sm:text-[30px]">
              {f.numero
                ? t("cab.hono.facture.titre", { numero: f.numero })
                : t("cab.hono.facture.titre.brouillon")}
            </h1>
          </div>
          <span className="flex-1" />
          <div className="flex flex-wrap gap-2">
            {brouillon ? (
              <>
                <button
                  type="button"
                  disabled={supprimer.isPending}
                  onClick={() => supprimer.mutate()}
                  className={cn(BOUTON_PIERRE, "text-muted-foreground hover:text-signal-stop")}
                >
                  {t("cab.hono.facture.supprimer")}
                </button>
                <button
                  type="button"
                  disabled={!modifie || enregistrer.isPending}
                  onClick={() => {
                    setErreur(null);
                    enregistrer.mutate();
                  }}
                  className={BOUTON_PIERRE}
                >
                  {t("cab.hono.facture.enregistrer")}
                </button>
                <button
                  type="button"
                  disabled={modifie || emettre.isPending || f.lignes.length === 0}
                  onClick={() => {
                    setErreur(null);
                    emettre.mutate();
                  }}
                  className={BOUTON_ENCRE}
                >
                  {t("cab.hono.facture.emettre")}
                </button>
              </>
            ) : null}
            {f.statut === "emise" && !f.avoirDe ? (
              <button
                type="button"
                onClick={() => setEncaisser((v) => !v)}
                className={BOUTON_ENCRE}
              >
                {t("cab.hono.facture.encaisser")}
              </button>
            ) : null}
            {(f.statut === "emise" || f.statut === "payee") && !f.avoirDe ? (
              <button
                type="button"
                onClick={() => setConfirmerAvoir(true)}
                className={BOUTON_PIERRE}
              >
                {t("cab.hono.facture.avoir")}
              </button>
            ) : null}
          </div>
        </div>
        {erreur ? <p className="mt-2 text-[12px] text-signal-stop">{erreur}</p> : null}
        {brouillon && modifie ? (
          <p className="mt-2 text-[11px] text-marigold">{t("cab.hono.facture.nonEnregistre")}</p>
        ) : null}
      </div>

      {confirmerAvoir ? (
        <div className="border-b border-border border-s-2 border-s-signal-stop bg-signal-soft p-4">
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-signal-stop">
            {t("cab.hono.facture.avoir")}
          </p>
          <p className="mt-2 max-w-[64ch] text-[13px] leading-[1.6] text-text-2">
            {t("cab.hono.facture.avoir.lede", { numero: f.numero ?? "" })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={avoir.isPending}
              onClick={() => avoir.mutate()}
              className="border border-signal-stop bg-signal-stop px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-background disabled:opacity-40"
            >
              {t("cab.hono.facture.avoir.confirmer")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmerAvoir(false)}
              className={BOUTON_PIERRE}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {encaisser && f.statut === "emise" ? (
        <FormulaireEncaissement
          facture={f}
          reste={reste}
          today={today}
          onFait={() => {
            setEncaisser(false);
            rafraichir();
          }}
          onErreur={surErreur}
        />
      ) : null}

      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        {/* ---- la pièce */}
        <section className="min-w-0 border border-border bg-card p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[18px] font-semibold tracking-[-0.015em]">{f.cabinet.name}</p>
              <p className="num mt-1.5 text-[11.5px] leading-[1.65] text-text-2">
                {f.cabinet.legalId
                  ? t("cab.hono.facture.identifiant", { id: f.cabinet.legalId })
                  : t("cab.hono.verif.cabinet.manque")}
              </p>
            </div>
            <div className="text-end">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {f.avoirDe ? t("cab.hono.facture.avoir.entete") : t("cab.hono.facture.entete")}
              </p>
              <p className="num mt-2 text-[20px] font-medium">
                {f.numero ?? t("cab.hono.statut.brouillon")}
              </p>
              <p className="num mt-2 text-[11.5px] leading-[1.65] text-text-2">
                {f.emiseLe ? t("cab.hono.facture.emiseLe", { date: dateLongue(f.emiseLe) }) : ""}
                {f.emiseLe ? <br /> : null}
                {f.echeanceLe
                  ? t("cab.hono.facture.echeance", { date: dateLongue(f.echeanceLe) })
                  : ""}
                {f.echeanceLe ? <br /> : null}
                {t("cab.hono.facture.periode", {
                  du: dateLongue(f.periodeDu),
                  au: dateLongue(f.periodeAu),
                })}
              </p>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-9 border-b border-border border-t border-t-foreground py-4">
            <div>
              <p className={ETIQUETTE}>{t("cab.hono.facture.factureA")}</p>
              <p className="mt-2 text-[15px] font-semibold tracking-[-0.01em]">{f.client.name}</p>
              <p className="num mt-1 text-[11.5px] text-text-2">
                {f.client.legalId
                  ? t("cab.hono.facture.identifiant", { id: f.client.legalId })
                  : t("cab.hono.verif.client.manque")}
              </p>
            </div>
            <div>
              <p className={ETIQUETTE}>{t("cab.hono.facture.mandat")}</p>
              <p className="mt-2 max-w-[36ch] text-[13px] leading-[1.6] text-text-2">
                {f.mandat
                  ? t("cab.hono.facture.mandat.resume", {
                      mode: t(MODES[f.mandat.mode] ?? "cab.hono.mode.forfait"),
                      frequence: t(FREQUENCES[f.mandat.frequence] ?? "cab.hono.freq.mensuelle"),
                      couverture: f.mandat.couverture.join(" · ") || "—",
                    })
                  : t("cab.hono.nouvelle.sansMandat")}
              </p>
            </div>
          </div>

          {/* ---- les lignes */}
          <div className="mt-6">
            {brouillon ? (
              <LignesEditables
                lignes={lignes}
                onChange={modifierLigne}
                onSet={(ls) => {
                  setLignes(ls);
                  setModifie(true);
                }}
                devise={f.devise}
                totaux={modifie ? undefined : f.lignes.map((l) => l.montantHt)}
              />
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">{t("cab.hono.lignes.caption")}</caption>
                <thead>
                  <tr className="border-b border-foreground">
                    {[
                      t("cab.hono.col.prestation"),
                      t("cab.hono.col.quantite"),
                      t("cab.hono.col.pu"),
                      t("cab.hono.col.ht"),
                    ].map((h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cn(
                          "pb-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground",
                          i === 0 ? "text-start" : "ps-3 text-end",
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {f.lignes.map((l) => (
                    <tr key={l.id} className="border-b border-border">
                      <td className="py-2.5">{l.libelle}</td>
                      <td className="num whitespace-nowrap ps-3 py-2.5 text-end">
                        {montant(l.quantite, locale)}
                      </td>
                      <td className="num whitespace-nowrap ps-3 py-2.5 text-end">
                        {montant(l.prixUnitaire, locale)}
                      </td>
                      <td className="num whitespace-nowrap ps-3 py-2.5 text-end">
                        {montant(l.montantHt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---- les totaux, tels que la base les a posés */}
          <div className="mt-5 flex justify-end">
            <table className="min-w-[290px] border-collapse text-[13px]">
              <tbody>
                <tr>
                  <td className="py-1 pe-6 text-text-2">{t("cab.hono.total.ht")}</td>
                  <td className="num py-1 text-end">{somme(f.totalHt)}</td>
                </tr>
                <tr>
                  <td className="py-1 pe-6 text-text-2">{libelleTaux}</td>
                  <td className="num py-1 text-end">{somme(f.totalTva)}</td>
                </tr>
                {f.droitsLibelle ? (
                  <tr>
                    <td className="py-1 pe-6 text-text-2">{f.droitsLibelle}</td>
                    <td className="num py-1 text-end">{somme(f.droitsFixes)}</td>
                  </tr>
                ) : null}
                <tr>
                  <td className="border-t border-foreground pt-2.5 pe-6 font-semibold">
                    {t("cab.hono.total.ttc")}
                  </td>
                  <td className="num border-t border-foreground pt-2.5 text-end text-[18px] font-semibold">
                    {somme(f.totalTtc)}
                  </td>
                </tr>
                {f.statut === "emise" && !f.avoirDe ? (
                  <>
                    <tr>
                      <td className="py-1 pe-6 text-text-2">{t("cab.hono.col.encaisse")}</td>
                      <td className="num py-1 text-end text-signal-ok">{somme(f.encaisse)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 pe-6 font-medium">{t("cab.hono.col.reste")}</td>
                      <td
                        className={cn(
                          "num py-1 text-end font-medium",
                          enRetard ? "text-signal-stop" : "",
                        )}
                      >
                        {somme(reste)}
                      </td>
                    </tr>
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
          {brouillon && modifie ? (
            <p className="mt-2 text-end text-[11px] text-muted-foreground">
              {t("cab.hono.facture.totaux.note")}
            </p>
          ) : null}

          {/* ---- les encaissements */}
          {f.encaissements.length > 0 ? (
            <div className="mt-6 border border-border bg-background px-4 py-3">
              <p className={ETIQUETTE}>{t("cab.hono.facture.encaissements")}</p>
              <ul className="mt-2 divide-y divide-border">
                {f.encaissements.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 py-1.5 text-[12.5px]"
                  >
                    <span>
                      <span className="num">{dateLongue(e.encaisseLe)}</span> ·{" "}
                      {t(MOYENS[e.moyen] ?? "cab.hono.moyen.autre")}
                      {e.reference ? (
                        <span className="num ms-2 text-[11px] text-muted-foreground">
                          {e.reference}
                        </span>
                      ) : null}
                    </span>
                    <span className="num text-signal-ok">{somme(e.montant)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ---- les mentions que le pack exige */}
          {f.mentions.length > 0 ? (
            <div className="mt-6 border-t border-border pt-4">
              <p className={ETIQUETTE}>{t("cab.hono.facture.mentions")}</p>
              <p className="mt-2 text-[11px] leading-[1.7] text-muted-foreground">
                {f.mentions.map((m) => m.label).join(" · ")}
              </p>
            </div>
          ) : null}
        </section>

        {/* ---- la colonne */}
        <aside className="min-w-0 space-y-4">
          {brouillon ? (
            <div className="border border-border bg-card p-4">
              <p className={ETIQUETTE}>{t("cab.hono.facture.parametres")}</p>
              <div className="mt-3 grid gap-3">
                <label className="block">
                  <span className={ETIQUETTE}>{t("cab.hono.tva")}</span>
                  <select
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setModifie(true);
                    }}
                    className={cn(CHAMP, "mt-1.5 w-full")}
                  >
                    {tauxEnVigueur.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                    {tauxEnVigueur.every((r) => r.code !== code) ? (
                      <option value={code}>{code}</option>
                    ) : null}
                  </select>
                </label>
                <label className="block">
                  <span className={ETIQUETTE}>{t("cab.hono.periode.du")}</span>
                  <input
                    type="date"
                    value={du}
                    onChange={(e) => {
                      setDu(e.target.value);
                      setModifie(true);
                    }}
                    className={cn(CHAMP, "num mt-1.5 w-full")}
                  />
                </label>
                <label className="block">
                  <span className={ETIQUETTE}>{t("cab.hono.periode.au")}</span>
                  <input
                    type="date"
                    value={au}
                    onChange={(e) => {
                      setAu(e.target.value);
                      setModifie(true);
                    }}
                    className={cn(CHAMP, "num mt-1.5 w-full")}
                  />
                </label>
              </div>
              {f.mandat?.forfait ? (
                <button
                  type="button"
                  onClick={() => {
                    setLignes([
                      ...lignes,
                      {
                        libelle:
                          f.mandat!.couverture.length > 0
                            ? t("cab.hono.ligne.forfait.couvre", {
                                couverture: f.mandat!.couverture.join(" · "),
                              })
                            : t("cab.hono.ligne.forfait"),
                        quantite: "1",
                        prixUnitaire: f.mandat!.forfait!,
                      },
                    ]);
                    setModifie(true);
                  }}
                  className={cn(BOUTON_PIERRE, "mt-3 w-full text-start")}
                >
                  + {t("cab.hono.facture.ajouterForfait", { montant: somme(f.mandat.forfait) })}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="border border-border border-s-2 border-s-marigold bg-card p-4">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-marigold">
              {t("cab.hono.verif.titre")}
            </p>
            <ul className="mt-3 space-y-2">
              {verifications.map((v) => (
                <li key={v.key} className="flex items-start gap-2 text-[12.5px] leading-[1.5]">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[5px] inline-block h-[7px] w-[7px] shrink-0",
                      v.ok ? "bg-signal-ok" : "bg-marigold",
                    )}
                  />
                  <span>{v.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {f.avoirDe ? (
            <Link
              to="/cabinet/facture/$factureId"
              params={{ factureId: f.avoirDe }}
              className="block border border-border bg-card p-4 text-[12.5px] hover:bg-accent"
            >
              {t("cab.hono.facture.voirAnnulee")}
            </Link>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** Un encaissement : un fait daté, qui s'ajoute et ne se corrige pas. */
function FormulaireEncaissement({
  facture,
  reste,
  today,
  onFait,
  onErreur,
}: {
  facture: FactureHonorairesDossier;
  reste: string;
  today: string;
  onFait: () => void;
  onErreur: (e: unknown) => void;
}) {
  const { t, locale } = useI18n();
  const [montantSaisi, setMontantSaisi] = useState(reste);
  const [date, setDate] = useState(today);
  const [moyen, setMoyen] = useState("virement");
  const [reference, setReference] = useState("");

  const encaisser = useMutation({
    mutationFn: () =>
      office().honoraires.encaisser({
        factureId: facture.id,
        montant: montantSaisi,
        encaisseLe: date,
        moyen,
        reference: reference.trim() || null,
      }),
    onSuccess: onFait,
    onError: onErreur,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        encaisser.mutate();
      }}
      className="border-b border-border bg-card p-4"
    >
      <p className={ETIQUETTE}>
        {t("cab.hono.encaisser.titre", { reste: `${montant(reste, locale)} ${facture.devise}` })}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.col.montant")}</span>
          <input
            type="number"
            min="0.001"
            max={reste}
            step="0.001"
            required
            value={montantSaisi}
            onChange={(e) => setMontantSaisi(e.target.value)}
            className={cn(CHAMP, "num mt-1.5 w-full text-end")}
          />
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.col.date")}</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cn(CHAMP, "num mt-1.5 w-full")}
          />
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.col.moyen")}</span>
          <select
            value={moyen}
            onChange={(e) => setMoyen(e.target.value)}
            className={cn(CHAMP, "mt-1.5 w-full")}
          >
            {Object.entries(MOYENS).map(([code, cle]) => (
              <option key={code} value={code}>
                {t(cle)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.hono.encaisser.reference")}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={cn(CHAMP, "mt-1.5 w-full")}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={encaisser.isPending} className={BOUTON_ENCRE}>
          {t("cab.hono.encaisser.valider")}
        </button>
        <span className="text-[11px] text-muted-foreground">{t("cab.hono.encaisser.note")}</span>
      </div>
    </form>
  );
}
