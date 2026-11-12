/**
 * La fiche d'un client, dans la page Clients de la comptabilité.
 *
 * Un tiroir à droite de la liste, cinq onglets, tout modifiable à tout
 * moment : la société et sa fiche fiscale, le propriétaire et ses places, le
 * mandat et les honoraires, l'abonnement, les factures. Un point orange
 * signale ce qui manque. Pour un client nouveau, un seul onglet suffit : trois
 * champs, puis la fiche s'ouvre sur le reste.
 *
 * Rien ne se décide ici : chaque geste passe par une porte de la base, qui
 * refuse ce que la règle refuse (A2, montée et descente, places).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { useCabinet } from "@/components/malica/cabinet-context";
import { MandatDuClient } from "@/components/malica/honoraires-de-la-comptabilite";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { ficheComplete } from "@/lib/etat-des-clients";
import { montant } from "@/lib/lisible";
import { useNotesDHonoraires } from "@/lib/notes-d-honoraires";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  ClientSummary,
  EtatDuClient,
  FicheCourante,
  MandatHonoraires,
  OffreAuCatalogue,
} from "@malica/socle/ports/repositories";

const OU = "components/malica/clients/fiche-client";

/**
 * L'abonnement se vend sur le web seulement (`COMMERCE`) : son onglet est un
 * module à part, absent du paquet de l'application installée.
 */
const OngletAbonnement = __COMMERCE__
  ? lazy(() => import("./abonnement-du-client").then((m) => ({ default: m.OngletAbonnement })))
  : null;

/**
 * Le lien d'invitation n'est rendu qu'une fois, à l'envoi. Gardé ici le temps
 * de la session, pour que la fiche le montre juste après l'ajout du client.
 */
const liensRecents = new Map<string, string>();
const lienDe = (r: { lien: string | null; jeton: string }) =>
  r.lien ?? `${window.location.origin}/invitation#${r.jeton}`;

export type OngletFiche = "societe" | "acces" | "mandat" | "abo" | "factures";

export const CHAMP =
  "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ETIQUETTE = "block text-[11px] font-semibold text-text-2";
const AIDE = "mt-1 block text-[11.5px] leading-[1.45] text-muted-foreground";

/* ------------------------------------------------------------------ tiroir */

function Tiroir({
  titre,
  sousTitre,
  fermer,
  children,
  pied,
}: {
  titre: ReactNode;
  sousTitre?: ReactNode;
  fermer: () => void;
  children: ReactNode;
  pied?: ReactNode;
}) {
  const { t } = useI18n();
  const panneau = useRef<HTMLDivElement | null>(null);
  useSuperposition(true, fermer, panneau);
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={t("cab.cli.fermer")}
        onClick={fermer}
        className="cab-voile absolute inset-0 cursor-default bg-[rgba(16,24,40,0.28)]"
      />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiche-client-titre"
        className="cab-tiroir absolute inset-y-0 end-0 flex w-full max-w-[680px] flex-col border-s border-border bg-card shadow-[-12px_0_40px_rgba(16,24,40,0.12)]"
      >
        <div className="flex items-start justify-between gap-3 px-6 pb-1 pt-5">
          <div className="min-w-0">
            <h2
              id="fiche-client-titre"
              className="truncate text-[21px] font-bold tracking-[-0.01em]"
            >
              {titre}
            </h2>
            {sousTitre ? <div className="mt-1">{sousTitre}</div> : null}
          </div>
          <button
            type="button"
            onClick={fermer}
            aria-label={t("cab.cli.fermer")}
            className="h-9 w-9 shrink-0 rounded-lg border border-border text-[18px] leading-none hover:bg-accent"
          >
            ×
          </button>
        </div>
        {children}
        {pied ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3">
            {pied}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Onglets({
  onglets,
  courant,
  aller,
}: {
  onglets: ReadonlyArray<{ id: OngletFiche; titre: string; alerte?: boolean }>;
  courant: OngletFiche;
  aller: (o: OngletFiche) => void;
}) {
  return (
    <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-border px-6 pt-3">
      {onglets.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={courant === o.id}
          onClick={() => aller(o.id)}
          className={cn(
            "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 text-[13px]",
            courant === o.id
              ? "border-foreground font-semibold text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {o.titre}
          {o.alerte ? (
            <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-[#e0a43a]" />
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Retour({ ok, texte }: { ok: boolean; texte: string | null }) {
  if (!texte) return null;
  return (
    <p
      role={ok ? "status" : "alert"}
      className={cn("text-[12.5px]", ok ? "text-signal-ok" : "text-signal-stop")}
    >
      {texte}
    </p>
  );
}

/* ------------------------------------------------------------ nouveau client */

export function NouveauClient({
  fermer,
  ouvrir,
  annoncer,
}: {
  fermer: () => void;
  /** Le dossier est ouvert : sa fiche prend le relais, sur l'onglet donné. */
  ouvrir: (tenantId: string, onglet: OngletFiche) => void;
  annoncer: (texte: string) => void;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [mf, setMf] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [adresse, setAdresse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [existant, setExistant] = useState(false);

  const rafraichir = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
      qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] }),
    ]);
  };

  const creer = useMutation({
    mutationFn: async () => {
      const d = await office().identity.ouvrirDossier({
        cabinetTenantId: org.id,
        name: nom.trim(),
        legalId: mf.trim(),
        adresse: adresse.trim() || null,
      });
      let courriel: string | null = null;
      if (email.trim()) {
        const inv = await office().identity.inviterContact(d.id, email.trim());
        courriel = inv.courriel;
        liensRecents.set(d.id, lienDe(inv));
      }
      return { id: d.id, courriel };
    },
    onSuccess: async (r) => {
      await rafraichir();
      annoncer(
        r.courriel === null
          ? t("cab.cli.nouveau.ok.sans")
          : r.courriel === "envoye"
            ? t("cab.cli.nouveau.ok")
            : t("cab.cli.nouveau.ok.lien"),
      );
      // Sans courriel parti, le lien est à transmettre : la fiche l'ouvre.
      ouvrir(r.id, r.courriel === null || r.courriel === "envoye" ? "mandat" : "acces");
    },
    onError: (e: unknown) => {
      const texte = texteDeLErreur(e, OU, t("common.error"));
      setExistant(
        String((e as { message?: string })?.message ?? "").includes("matricule_existant"),
      );
      setErreur(texte);
    },
  });

  const demander = useMutation({
    mutationFn: () => office().identity.proposerMandat(org.id, mf.trim()),
    onSuccess: async (r) => {
      await rafraichir();
      annoncer(t("cab.cli.nouveau.mandat.ok", { client: r.pmeName }));
      fermer();
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const pret = mf.trim() !== "" && nom.trim() !== "";

  return (
    <Tiroir
      titre={t("cab.cli.nouveau.titre")}
      sousTitre={<p className="text-[12.5px] text-muted-foreground">{t("cab.cli.nouveau.lede")}</p>}
      fermer={fermer}
      pied={
        <>
          <span className="text-[12px] text-muted-foreground">{t("cab.cli.nouveau.requis")}</span>
          <span className="flex gap-2">
            <button type="button" onClick={fermer} className="cab-button cab-button-secondary">
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              form="nouveau-client"
              disabled={!pret || creer.isPending}
              className="cab-button cab-button-primary"
            >
              {email.trim() ? t("cab.cli.nouveau.creer") : t("cab.cli.nouveau.creer.sans")}
            </button>
          </span>
        </>
      }
    >
      <form
        id="nouveau-client"
        className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        onSubmit={(e) => {
          e.preventDefault();
          setErreur(null);
          setExistant(false);
          if (pret && !creer.isPending) creer.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.cli.champ.mf")} *</span>
            <input
              required
              value={mf}
              onChange={(e) => setMf(e.target.value)}
              placeholder="1234567A/A/M/000"
              className={cn(CHAMP, "num")}
              autoFocus
            />
            <span className={AIDE}>{t("cab.cli.champ.mf.aide")}</span>
          </label>
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.cli.champ.nom")} *</span>
            <input
              required
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className={CHAMP}
            />
          </label>
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.cli.champ.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={CHAMP}
            />
            <span className={AIDE}>{t("cab.cli.champ.email.aide")}</span>
          </label>
          <label className="block">
            <span className={ETIQUETTE}>{t("cab.cli.champ.adresse")}</span>
            <input value={adresse} onChange={(e) => setAdresse(e.target.value)} className={CHAMP} />
          </label>
        </div>
        <p className="rounded-lg bg-[#f4f8f5] p-3 text-[12.5px] leading-[1.5] text-text-2">
          {t("cab.cli.nouveau.note")}
        </p>
        <Retour ok={false} texte={erreur} />
        {existant ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-[12.5px]">{t("cab.cli.nouveau.existant")}</p>
            <button
              type="button"
              disabled={demander.isPending}
              onClick={() => demander.mutate()}
              className="cab-button cab-button-secondary mt-2"
            >
              {t("cab.cli.nouveau.demander")}
            </button>
          </div>
        ) : null}
      </form>
    </Tiroir>
  );
}

/* -------------------------------------------------------------- client connu */

export function FicheClient({
  client,
  etat,
  mandat,
  offres,
  expert,
  ongletInitial,
  fermer,
  annoncer,
  societesDeLaLicence,
  parLaLicence = null,
}: {
  /** L'offre payée sur la licence partagée, quand la société n'a pas d'abonnement à elle. */
  parLaLicence?: string | null;
  client: ClientSummary;
  etat: EtatDuClient | undefined;
  mandat: MandatHonoraires | undefined;
  offres: readonly OffreAuCatalogue[];
  expert: boolean;
  ongletInitial: OngletFiche;
  fermer: () => void;
  annoncer: (texte: string) => void;
  societesDeLaLicence: readonly string[];
}) {
  const { t } = useI18n();
  const [ongletChoisi, setOnglet] = useState<OngletFiche>(ongletInitial);
  // L'onglet « Factures » est celui des notes d'honoraires : éteintes à la
  // tour, il disparaît, et une adresse qui le demandait ouvre la société.
  const notes = useNotesDHonoraires();
  const onglet: OngletFiche =
    ongletChoisi === "factures" && !notes.ouvertes ? "societe" : ongletChoisi;

  const fiche = useQuery({
    queryKey: ["fiche", client.tenantId],
    queryFn: () => office().identity.ficheCourante(client.tenantId),
  });

  const bandeau = !etat?.dirigeantPresent
    ? t("cab.cli.bandeau.attente")
    : client.engagementStatus === "propose"
      ? t("cab.cli.bandeau.mandat")
      : `${client.legalId ?? ""} · ${t("cab.cli.bandeau.actif")}`;

  return (
    <Tiroir
      titre={client.name}
      sousTitre={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span
            className={cn(
              "text-[12.5px]",
              etat?.dirigeantPresent ? "num text-muted-foreground" : "text-marigold",
            )}
          >
            {bandeau}
          </span>
          <Link
            to="/cabinet/dossier/$clientId"
            params={{ clientId: client.tenantId }}
            className="text-[12.5px] font-semibold hover:text-[#168b50]"
          >
            {t("cab.cli.ouvrir.dossier")} →
          </Link>
        </div>
      }
      fermer={fermer}
      pied={<span className="text-[12px] text-muted-foreground">{t("cab.cli.pied")}</span>}
    >
      <Onglets
        courant={onglet}
        aller={setOnglet}
        onglets={[
          {
            id: "societe",
            titre: t("cab.cli.onglet.societe"),
            alerte: fiche.isSuccess && !ficheComplete(fiche.data),
          },
          { id: "acces", titre: t("cab.cli.onglet.acces"), alerte: !etat?.dirigeantPresent },
          { id: "mandat", titre: t("cab.cli.onglet.mandat"), alerte: !mandat },
          {
            id: "abo",
            titre: t("cab.cli.onglet.abo"),
            alerte: !etat?.accesStatut && !parLaLicence,
          },
          ...(notes.ouvertes
            ? [{ id: "factures" as const, titre: t("cab.cli.onglet.factures") }]
            : []),
        ]}
      />
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {onglet === "societe" ? (
          <OngletSociete
            client={client}
            etat={etat}
            fiche={fiche.data ?? null}
            ficheChargee={fiche.isSuccess}
            expert={expert}
            annoncer={annoncer}
          />
        ) : onglet === "acces" ? (
          <OngletAcces
            client={client}
            etat={etat}
            expert={expert}
            annoncer={annoncer}
            societes={societesDeLaLicence}
          />
        ) : onglet === "mandat" ? (
          expert ? (
            <MandatDuClient clientTenantId={client.tenantId} clientName={client.name} />
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("cab.cli.reserve.expert")}</p>
          )
        ) : onglet === "abo" ? (
          OngletAbonnement ? (
            <Suspense fallback={<p className="text-muted-foreground">{t("common.loading")}</p>}>
              <OngletAbonnement
                client={client}
                etat={etat}
                catalogue={offres}
                parLaLicence={parLaLicence}
                expert={expert}
                annoncer={annoncer}
              />
            </Suspense>
          ) : (
            <p className="text-[13px] text-muted-foreground">{t("cab.cli.abo.web")}</p>
          )
        ) : (
          <OngletFactures client={client} />
        )}
      </div>
    </Tiroir>
  );
}

/* --------------------------------------------------- 1. société et fiche */

const AXES_FICHE = ["imposition", "tva"] as const;

function OngletSociete({
  client,
  etat,
  fiche,
  ficheChargee,
  expert,
  annoncer,
}: {
  client: ClientSummary;
  etat: EtatDuClient | undefined;
  fiche: FicheCourante | null;
  ficheChargee: boolean;
  expert: boolean;
  annoncer: (texte: string) => void;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [nom, setNom] = useState(client.name);
  const [mf, setMf] = useState(client.legalId ?? "");
  const [adresse, setAdresse] = useState(etat?.adresse ?? "");
  const [regimes, setRegimes] = useState({ imposition: "", tva: "" });
  const [cloture, setCloture] = useState("");
  const [forme, setForme] = useState("");
  const [mode, setMode] = useState("");
  const [secteur, setSecteur] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [seme, setSeme] = useState(false);

  useEffect(() => {
    if (!ficheChargee || seme) return;
    setRegimes({ imposition: fiche?.regimeImposition ?? "", tva: fiche?.regimeTva ?? "" });
    setCloture(fiche?.clotureExercice ?? "");
    setForme(fiche?.formeJuridique ?? "");
    setMode(fiche?.modeDepot ?? "");
    setSecteur(fiche?.secteur ?? "");
    setSeme(true);
  }, [ficheChargee, fiche, seme]);

  const listeRegimes = useQuery({
    queryKey: ["regimes", org.jurisdiction],
    queryFn: () => office().identity.regimesDisponibles(org.jurisdiction),
  });
  const listeFormes = useQuery({
    queryKey: ["formes", org.jurisdiction],
    queryFn: () => office().identity.formesDisponibles(org.jurisdiction),
  });

  const enregistrer = useMutation({
    mutationFn: async () => {
      const societeChange =
        nom.trim() !== client.name ||
        mf.trim().toUpperCase() !== (client.legalId ?? "").toUpperCase() ||
        (adresse.trim() || null) !== (etat?.adresse ?? null);
      if (societeChange) {
        await office().identity.modifierDossier({
          cabinetId: org.id,
          pmeId: client.tenantId,
          nom: nom.trim(),
          legalId: mf.trim(),
          adresse: adresse.trim() || null,
        });
      }
      const ficheChange =
        (regimes.imposition || null) !== (fiche?.regimeImposition ?? null) ||
        (regimes.tva || null) !== (fiche?.regimeTva ?? null) ||
        (cloture || null) !== (fiche?.clotureExercice ?? null) ||
        (forme || null) !== (fiche?.formeJuridique ?? null) ||
        (mode || null) !== (fiche?.modeDepot ?? null) ||
        (secteur.trim() || null) !== (fiche?.secteur ?? null);
      if (ficheChange) {
        await office().identity.etablirFiche({
          tenantId: client.tenantId,
          regimeImposition: regimes.imposition || null,
          regimeTva: regimes.tva || null,
          prorataTva: fiche?.prorataTva ? Number(fiche.prorataTva) : null,
          secteur: secteur.trim() || null,
          debutActivite: fiche?.debutActivite ?? null,
          clotureExercice: cloture || null,
          formeJuridique: forme || null,
          modeDepot: mode || null,
          source: "saisie",
          validFrom: new Date().toISOString().slice(0, 10),
        });
      }
      return societeChange || ficheChange;
    },
    onSuccess: async (change) => {
      setErreur(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["fiche", client.tenantId] }),
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] }),
      ]);
      annoncer(change ? t("cab.cli.enregistre") : t("cab.cli.rien.change"));
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const libelleForme = (axe: "forme" | "mode", code: string) => {
    const cle = `fiche.${axe}.${code}` as MessageKey;
    const v = t(cle);
    return v === cle ? code : v;
  };
  const champ = (complet: boolean) => cn(CHAMP, !complet && "border-[#e9d3a6] bg-card");

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (expert && !enregistrer.isPending) enregistrer.mutate();
      }}
    >
      <fieldset disabled={!expert} className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.cli.champ.nom")}</span>
          <input required value={nom} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("cab.cli.champ.mf")}</span>
          <input
            required
            value={mf}
            onChange={(e) => setMf(e.target.value)}
            className={cn(CHAMP, "num")}
          />
          <span className={AIDE}>{t("cab.cli.champ.mf.fige")}</span>
        </label>
        <label className="block sm:col-span-2">
          <span className={ETIQUETTE}>{t("cab.cli.champ.adresse")}</span>
          <input
            value={adresse}
            onChange={(e) => setAdresse(e.target.value)}
            placeholder={t("cab.cli.a.completer")}
            className={champ(adresse.trim() !== "")}
          />
        </label>
        {AXES_FICHE.map((axe) => (
          <label key={axe} className="block">
            <span className={ETIQUETTE}>
              {t(axe === "imposition" ? "fiche.champ.imposition" : "fiche.champ.tva")}
            </span>
            <select
              value={regimes[axe]}
              onChange={(e) => setRegimes({ ...regimes, [axe]: e.target.value })}
              className={champ(regimes[axe] !== "")}
            >
              <option value="">{t("cab.cli.a.completer")}</option>
              {(listeRegimes.data ?? [])
                .filter((r) => r.axe === axe)
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.libelle}
                  </option>
                ))}
            </select>
          </label>
        ))}
        <label className="block">
          <span className={ETIQUETTE}>{t("fiche.champ.forme")}</span>
          <select
            value={forme}
            onChange={(e) => setForme(e.target.value)}
            className={champ(forme !== "")}
          >
            <option value="">{t("cab.cli.a.completer")}</option>
            {(listeFormes.data ?? [])
              .filter((f) => f.axe === "forme")
              .map((f) => (
                <option key={f.code} value={f.code}>
                  {libelleForme("forme", f.code)}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("fiche.champ.cloture")}</span>
          <input
            value={cloture}
            onChange={(e) => setCloture(e.target.value)}
            placeholder="12-31"
            pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
            className={cn(champ(cloture !== ""), "num")}
          />
          <span className={AIDE}>{t("fiche.aide.cloture")}</span>
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("fiche.champ.mode")}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={CHAMP}>
            <option value="">—</option>
            {(listeFormes.data ?? [])
              .filter((f) => f.axe === "mode")
              .map((f) => (
                <option key={f.code} value={f.code}>
                  {libelleForme("mode", f.code)}
                </option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className={ETIQUETTE}>{t("fiche.champ.secteur")}</span>
          <input value={secteur} onChange={(e) => setSecteur(e.target.value)} className={CHAMP} />
        </label>
      </fieldset>
      <p className="text-[12px] leading-[1.5] text-muted-foreground">{t("cab.cli.societe.note")}</p>
      <Retour ok={false} texte={erreur} />
      {expert ? (
        <button
          type="submit"
          disabled={enregistrer.isPending}
          className="cab-button cab-button-primary"
        >
          {t("cab.cli.enregistrer")}
        </button>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{t("cab.cli.reserve.expert")}</p>
      )}
    </form>
  );
}

/* ------------------------------------------------ 2. propriétaire et places */

function OngletAcces({
  client,
  etat,
  expert,
  annoncer,
  societes,
}: {
  client: ClientSummary;
  etat: EtatDuClient | undefined;
  expert: boolean;
  annoncer: (texte: string) => void;
  societes: readonly string[];
}) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [email, setEmail] = useState(etat?.invitationEmail ?? "");
  const [place, setPlace] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [lien, setLien] = useState<string | null>(liensRecents.get(client.tenantId) ?? null);
  const paye = etat?.accesStatut === "actif";

  const rafraichir = () => qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] });

  const inviter = useMutation({
    mutationFn: () => office().identity.inviterContact(client.tenantId, email.trim()),
    onSuccess: async (r) => {
      setErreur(null);
      const l = lienDe(r);
      liensRecents.set(client.tenantId, l);
      setLien(l);
      await rafraichir();
      annoncer(
        r.courriel === "envoye"
          ? t("cab.cli.relance.ok", { email: r.email })
          : t("cab.cli.relance.lien"),
      );
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });
  const donner = useMutation({
    mutationFn: () => office().identity.placePourLeClient(org.id, client.tenantId, place.trim()),
    onSuccess: async (r) => {
      setErreur(null);
      setPlace("");
      await rafraichir();
      annoncer(r.mode === "donnee" ? t("cab.cli.place.donnee") : t("cab.cli.place.suggeree"));
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(iso))
      : "";
  const jauge =
    etat?.siegesInclus && etat.siegesOccupes !== null
      ? Math.min(100, Math.round((etat.siegesOccupes / Math.max(etat.siegesInclus, 1)) * 100))
      : 0;

  return (
    <div className="space-y-3 text-[13px]">
      {/* le propriétaire principal */}
      <section className="rounded-xl border border-border p-4">
        <h3 className="font-semibold">{t("cab.cli.acces.proprietaire")}</h3>
        {etat?.dirigeantPresent ? (
          <p className="mt-1 text-muted-foreground">
            {t("cab.cli.acces.rejoint", { nom: etat.titulaireNom ?? "—" })}
          </p>
        ) : (
          <>
            <p className="mt-1 text-marigold">
              {etat?.invitationEmail
                ? etat.invitationExpiree
                  ? t("cab.cli.acces.expiree", { email: etat.invitationEmail })
                  : t("cab.cli.acces.invite", {
                      email: etat.invitationEmail,
                      date: date(etat.invitationEnvoyee),
                    })
                : t("cab.cli.acces.personne")}
            </p>
            {expert ? (
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim() && !inviter.isPending) inviter.mutate();
                }}
              >
                <label className="sr-only" htmlFor="acces-email">
                  {t("cab.cli.champ.email")}
                </label>
                <input
                  id="acces-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("cab.cli.champ.email")}
                  className={cn(CHAMP, "mt-0 min-w-[220px] flex-1")}
                />
                <button
                  type="submit"
                  disabled={inviter.isPending}
                  className="cab-button cab-button-secondary"
                >
                  {etat?.invitationEmail ? t("cab.cli.relancer") : t("cab.cli.inviter")}
                </button>
              </form>
            ) : null}
            {lien ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  readOnly
                  value={lien}
                  aria-label={t("cab.cli.lien")}
                  className={cn(CHAMP, "mt-0 num text-[11.5px]")}
                />
                <button
                  type="button"
                  className="cab-button cab-button-secondary"
                  onClick={() => void navigator.clipboard?.writeText(lien)}
                >
                  {t("cab.cli.copier")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* les sociétés sous sa licence */}
      <section className="rounded-xl border border-border p-4">
        <h3 className="font-semibold">
          {t("cab.cli.acces.societes")}
          {etat?.organisationsIncluses ? (
            <span className="num ms-2 font-normal text-muted-foreground">
              {etat.organisations ?? 1} / {etat.organisationsIncluses}
            </span>
          ) : null}
        </h3>
        <p className="mt-1">{(societes.length ? societes : [client.name]).join(" · ")}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">{t("cab.cli.acces.regroupement")}</p>
      </section>

      {/* les places */}
      <section className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">
            {t("cab.cli.acces.places")}
            {etat?.siegesInclus !== null && etat?.siegesInclus !== undefined ? (
              <span className="num ms-2 font-normal text-muted-foreground">
                {etat.siegesOccupes ?? 0} / {etat.siegesInclus}
              </span>
            ) : null}
          </h3>
          <span className="text-[12px] text-muted-foreground">
            {etat?.placesEnAttente
              ? `${t("cab.cli.acces.places.attente.n", { count: etat.placesEnAttente })} · `
              : ""}
            {paye ? t("cab.cli.acces.places.paye") : t("cab.cli.acces.places.propose")}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f3]">
          <div className="cab-jauge h-1.5 bg-[#168b50]" style={{ width: `${jauge}%` }} />
        </div>
        {etat?.dirigeantPresent ? (
          expert ? (
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (place.trim() && !donner.isPending) donner.mutate();
              }}
            >
              <label className="sr-only" htmlFor="place-email">
                {t("cab.cli.acces.place.email")}
              </label>
              <input
                id="place-email"
                type="email"
                required
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder={t("cab.cli.acces.place.email")}
                className={cn(CHAMP, "mt-0 min-w-[220px] flex-1")}
              />
              <button
                type="submit"
                disabled={donner.isPending}
                className="cab-button cab-button-primary"
              >
                {paye ? t("cab.cli.acces.donner") : t("cab.cli.acces.suggerer")}
              </button>
            </form>
          ) : null
        ) : (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            {t("cab.cli.acces.places.attente")}
          </p>
        )}
      </section>
      <Retour ok={false} texte={erreur} />
    </div>
  );
}

/* -------------------------------------------------------------- 5. factures */

function OngletFactures({ client }: { client: ClientSummary }) {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const factures = useQuery({
    queryKey: ["cab-hono-factures-client", org.id, client.tenantId],
    queryFn: () => office().honoraires.factures(org.id, { clientTenantId: client.tenantId }),
  });
  const date = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`))
      : "";
  if (factures.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (factures.isError)
    return (
      <p role="alert" className="text-signal-stop">
        {texteDeLErreur(factures.error, OU, t("common.error"))}
      </p>
    );
  const liste = factures.data ?? [];
  return (
    <div className="space-y-1 text-[13px]">
      {liste.length === 0 ? (
        <p className="text-muted-foreground">{t("cab.cli.factures.vide")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {liste.map((f) => (
            <li key={f.id}>
              <Link
                to="/cabinet/facture/$factureId"
                params={{ factureId: f.id }}
                className="flex items-baseline justify-between gap-3 py-3 hover:bg-accent/40"
              >
                <span>
                  <span className="num font-medium">
                    {f.numero ?? t("cab.hono.statut.brouillon")}
                  </span>
                  <span className="ms-2 text-muted-foreground">
                    {t(`cab.hono.statut.${f.statut}` as MessageKey)}
                  </span>
                </span>
                <span className="num text-muted-foreground">
                  {montant(f.totalTtc, locale)} {f.devise} · {date(f.emiseLe ?? f.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="pt-3 text-muted-foreground">{t("cab.cli.factures.note")}</p>
    </div>
  );
}
