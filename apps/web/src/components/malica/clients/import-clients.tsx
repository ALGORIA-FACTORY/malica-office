/**
 * Importer ses clients en une fois, en quatre étapes : le fichier, la
 * vérification ligne par ligne, les réglages communs, puis la création.
 *
 * Le fichier se lit dans le navigateur (`lib/import-de-clients`) ; la base
 * vérifie chaque ligne sans rien créer (`identite.verifierDossiers`) ; la
 * création enchaîne les portes qui existent déjà : ouvrir le dossier, inviter
 * le dirigeant, demander le mandat d'une société déjà inscrite, affecter le
 * collaborateur, poser le mandat type, proposer l'abonnement. Rien n'est
 * facturé avant l'arrivée de chaque dirigeant (A2).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { useCabinet } from "@/components/malica/cabinet-context";
import { CHAMP } from "@/components/malica/clients/fiche-client";
import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n, type MessageKey } from "@/i18n";
import { direUnRefus, texteDeLErreur } from "@/lib/erreur-lisible";
import {
  lignesDuTableur,
  lireTexte,
  lireXlsx,
  MODELE_CSV,
  type LigneImport,
} from "@/lib/import-de-clients";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type { LigneVerifiee, OffreAuCatalogue } from "@malica/socle/ports/repositories";

const OU = "components/malica/clients/import-clients";

type Etape = 1 | 2 | 3 | 4;

interface Bilan {
  ouverts: number;
  invites: number;
  mandats: number;
  echecs: Array<{ nom: string; motif: string }>;
}

export function ImportClients({
  fermer,
  offres,
  commerce,
}: {
  fermer: () => void;
  offres: readonly OffreAuCatalogue[];
  /** Les abonnements se proposent sur le web seulement. */
  commerce: boolean;
}) {
  const { t } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const panneau = useRef<HTMLDivElement | null>(null);
  const [etape, setEtape] = useState<Etape>(1);
  const [lignes, setLignes] = useState<LigneImport[]>([]);
  const [verifs, setVerifs] = useState<LigneVerifiee[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [colle, setColle] = useState("");
  const [collaborateur, setCollaborateur] = useState("");
  const [forfait, setForfait] = useState("");
  const [offre, setOffre] = useState("");
  const [progres, setProgres] = useState(0);
  const [bilan, setBilan] = useState<Bilan | null>(null);
  const enCours = etape === 3 && progres > 0 && !bilan;
  useSuperposition(true, () => (enCours ? undefined : fermer()), panneau);

  const membres = useQuery({
    queryKey: ["cab-members", org.id],
    queryFn: () => office().collab.members(org.id),
  });

  const verifier = useMutation({
    mutationFn: (l: LigneImport[]) =>
      office().identity.verifierDossiers(
        org.id,
        l.map((x) => ({
          matricule: x.matricule,
          raison_sociale: x.raison_sociale,
          email: x.email,
        })),
      ),
    onSuccess: (v) => {
      setErreur(null);
      setVerifs(v);
      setEtape(2);
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const charger = (tableau: string[][]) => {
    const { lignes: l } = lignesDuTableur(tableau, offres);
    if (l.length === 0) {
      setErreur(t("cab.cli.import.vide"));
      return;
    }
    setLignes(l);
    verifier.mutate(l);
  };

  const lireFichier = async (f: File) => {
    setErreur(null);
    try {
      if (/\.xlsx$/i.test(f.name)) charger(lireXlsx(new Uint8Array(await f.arrayBuffer())));
      else charger(lireTexte(await f.text()));
    } catch {
      setErreur(t("cab.cli.import.illisible"));
    }
  };

  const nb = (s: LigneVerifiee["statut"]) => verifs.filter((v) => v.statut === s).length;
  const aCorriger = nb("a_corriger");
  // Le motif est une clé de refus, parfois avec ses valeurs : dite comme partout.
  const motif = (m: string | null) => {
    if (!m) return "";
    const v = direUnRefus(m);
    return v === t("common.error") ? t("cab.cli.import.ligne.fausse") : v;
  };

  const modifier = (i: number, champ: keyof LigneImport, valeur: string) =>
    setLignes(lignes.map((l, k) => (k === i ? { ...l, [champ]: valeur } : l)));

  const creer = useMutation({
    mutationFn: async () => {
      const b: Bilan = { ouverts: 0, invites: 0, mandats: 0, echecs: [] };
      const aFaire = verifs.filter((v) => v.statut === "pret" || v.statut === "existant");
      let fait = 0;
      for (const v of aFaire) {
        const l = lignes[v.ligne - 1]!;
        try {
          if (v.statut === "existant") {
            await office().identity.proposerMandat(org.id, l.matricule);
            b.mandats++;
          } else {
            const d = await office().identity.ouvrirDossier({
              cabinetTenantId: org.id,
              name: l.raison_sociale,
              legalId: l.matricule,
              adresse: l.adresse || null,
            });
            b.ouverts++;
            await office().identity.inviterContact(d.id, l.email);
            b.invites++;
            if (collaborateur) {
              await office().collab.assign({
                cabinetTenantId: org.id,
                clientTenantId: d.id,
                collaboratorId: collaborateur,
              });
            }
            const montant = l.honoraires || forfait;
            if (montant) {
              await office().honoraires.definirMandat({
                cabinetTenantId: org.id,
                clientTenantId: d.id,
                mode: "forfait",
                frequence: "mensuelle",
                jourFacturation: 1,
                forfait: montant,
                tauxHoraire: null,
                delaiPaiementJours: 30,
                couverture: [],
              });
            }
            const code = offres.find((o) => o.code === l.offre)?.code ?? offre;
            // Proposer, c'est vendre : sur le web seulement, par son module.
            if (__COMMERCE__ && commerce && code) {
              const { proposerAbonnement } = await import("./proposer");
              await proposerAbonnement(org.id, d.id, code);
            }
          }
        } catch (e) {
          b.echecs.push({
            nom: l.raison_sociale || l.matricule,
            motif: texteDeLErreur(e, OU, t("common.error")),
          });
        }
        fait++;
        setProgres(Math.round((fait / aFaire.length) * 100));
      }
      return b;
    },
    onSuccess: async (b) => {
      setBilan(b);
      setEtape(4);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-clients", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-etat-clients", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-hono-mandats", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-assignments", org.id] }),
      ]);
    },
  });

  const telechargerModele = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + MODELE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "clients-malica.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const ETAPES: MessageKey[] = [
    "cab.cli.import.e1",
    "cab.cli.import.e2",
    "cab.cli.import.e3",
    "cab.cli.import.e4",
  ];
  const aCreer = nb("pret") + nb("existant");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-10">
      <div className="cab-voile fixed inset-0 bg-[rgba(16,24,40,0.32)]" aria-hidden />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-titre"
        className="cab-entre relative flex w-full max-w-[1000px] flex-col rounded-2xl border border-border bg-card shadow-[0_24px_60px_rgba(16,24,40,0.25)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2 id="import-titre" className="text-[18px] font-bold">
            {t("cab.cli.import.titre")}
          </h2>
          <ol className="flex flex-wrap gap-4 text-[12.5px]">
            {ETAPES.map((cle, i) => (
              <li
                key={cle}
                aria-current={etape === i + 1 ? "step" : undefined}
                className={
                  etape >= i + 1 ? "font-semibold text-foreground" : "text-muted-foreground"
                }
              >
                {i + 1} · {t(cle)}
              </li>
            ))}
          </ol>
        </div>

        <div className="min-h-[420px] px-6 py-5">
          {etape === 1 ? (
            <div className="space-y-4">
              <label
                className="cab-depot flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#9fcdb2] bg-[#f6fbf8] p-6 text-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void lireFichier(f);
                }}
              >
                <span className="text-[17px] font-semibold">{t("cab.cli.import.deposer")}</span>
                <span className="text-[13px] text-muted-foreground">
                  {t("cab.cli.import.deposer.aide")}
                </span>
                <input
                  type="file"
                  accept=".xlsx,.csv,.tsv,.txt"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void lireFichier(f);
                  }}
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-semibold text-text-2">
                  {t("cab.cli.import.coller")}
                </span>
                <textarea
                  value={colle}
                  onChange={(e) => setColle(e.target.value)}
                  rows={3}
                  placeholder="1234567A/A/M/000	Épicerie SARL	dirigeant@exemple.tn"
                  className={cn(CHAMP, "num text-[12.5px]")}
                />
              </label>
              <div className="grid gap-3 text-[13px] sm:grid-cols-3">
                <div className="rounded-xl border border-border p-4">
                  <strong className="block">{t("cab.cli.import.obligatoire")}</strong>
                  <span className="text-text-2">{t("cab.cli.import.obligatoire.liste")}</span>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <strong className="block">{t("cab.cli.import.utile")}</strong>
                  <span className="text-text-2">{t("cab.cli.import.utile.liste")}</span>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <strong className="block">{t("cab.cli.import.plusieurs")}</strong>
                  <span className="text-text-2">{t("cab.cli.import.plusieurs.lede")}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={telechargerModele}
                className="text-[13px] font-semibold hover:text-[#168b50]"
              >
                {t("cab.cli.import.modele")}
              </button>
            </div>
          ) : etape === 2 ? (
            <div className="space-y-3 text-[13px]">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-lg bg-[#eef6f1] px-2.5 py-1.5 font-semibold text-[#168b50]">
                  {t("cab.cli.import.pretes", { count: nb("pret") })}
                </span>
                {nb("existant") ? (
                  <span className="rounded-lg bg-[#eef2fb] px-2.5 py-1.5 font-semibold text-[#3d5a99]">
                    {t("cab.cli.import.existantes", { count: nb("existant") })}
                  </span>
                ) : null}
                {nb("deja_client") ? (
                  <span className="rounded-lg bg-[#f2f4f7] px-2.5 py-1.5 font-semibold text-text-2">
                    {t("cab.cli.import.deja", { count: nb("deja_client") })}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "rounded-lg px-2.5 py-1.5 font-semibold",
                    aCorriger ? "bg-[#fef3f2] text-signal-stop" : "bg-[#eef6f1] text-[#168b50]",
                  )}
                >
                  {t("cab.cli.import.corriger", { count: aCorriger })}
                </span>
              </div>
              <div className="max-h-[360px] overflow-auto rounded-xl border border-border">
                <table className="w-full text-start text-[12.5px]">
                  <thead className="sticky top-0 bg-[#fafbfa] text-[11.5px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">#</th>
                      <th className="px-3 py-2 text-start font-medium">{t("cab.cli.champ.mf")}</th>
                      <th className="px-3 py-2 text-start font-medium">{t("cab.cli.champ.nom")}</th>
                      <th className="px-3 py-2 text-start font-medium">
                        {t("cab.cli.champ.email")}
                      </th>
                      <th className="px-3 py-2 text-start font-medium">
                        {t("cab.cli.import.resultat")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {verifs.map((v) => {
                      const l = lignes[v.ligne - 1]!;
                      const faux = v.statut === "a_corriger";
                      const i = v.ligne - 1;
                      return (
                        <tr
                          key={v.ligne}
                          className={cn("border-t border-border", faux && "bg-[#fef3f2]")}
                        >
                          <td className="num px-3 py-1.5 text-muted-foreground">{v.ligne}</td>
                          {(["matricule", "raison_sociale", "email"] as const).map((c) => (
                            <td key={c} className="px-3 py-1.5">
                              {faux ? (
                                <input
                                  aria-label={`${t(c === "matricule" ? "cab.cli.champ.mf" : c === "email" ? "cab.cli.champ.email" : "cab.cli.champ.nom")} ${v.ligne}`}
                                  value={l[c]}
                                  onChange={(e) => modifier(i, c, e.target.value)}
                                  className={cn(
                                    CHAMP,
                                    "mt-0 py-1 text-[12px]",
                                    c === "matricule" && "num",
                                  )}
                                />
                              ) : (
                                <span className={c === "matricule" ? "num" : undefined}>
                                  {l[c] || "—"}
                                </span>
                              )}
                            </td>
                          ))}
                          <td
                            className={cn(
                              "px-3 py-1.5",
                              v.statut === "pret" && "text-[#168b50]",
                              v.statut === "existant" && "text-[#3d5a99]",
                              v.statut === "deja_client" && "text-muted-foreground",
                              faux && "text-signal-stop",
                            )}
                          >
                            {v.statut === "pret"
                              ? t("cab.cli.import.r.pret")
                              : v.statut === "existant"
                                ? t("cab.cli.import.r.existant", { nom: v.organisation ?? "" })
                                : v.statut === "deja_client"
                                  ? t("cab.cli.import.r.deja")
                                  : motif(v.motif)}
                            {/* La lettre de contrôle discordante se dit, sans arrêter la ligne (3.4). */}
                            {v.avertissement && !faux ? (
                              <span className="block text-[11.5px] text-marigold">
                                {t(v.avertissement as MessageKey)}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {aCorriger ? (
                <p className="text-muted-foreground">{t("cab.cli.import.corriger.aide")}</p>
              ) : null}
            </div>
          ) : etape === 3 ? (
            <div className="space-y-4 text-[13px]">
              <p className="text-text-2">{t("cab.cli.import.communs.lede")}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-text-2">
                    {t("cab.cli.import.collaborateur")}
                  </span>
                  <select
                    value={collaborateur}
                    onChange={(e) => setCollaborateur(e.target.value)}
                    className={CHAMP}
                  >
                    <option value="">{t("cab.cli.import.personne")}</option>
                    {(membres.data ?? []).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-text-2">
                    {t("cab.cli.import.forfait")}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.001"
                    value={forfait}
                    onChange={(e) => setForfait(e.target.value)}
                    placeholder={t("cab.cli.import.forfait.aide")}
                    className={cn(CHAMP, "num")}
                  />
                </label>
                {commerce ? (
                  <label className="block">
                    <span className="text-[11px] font-semibold text-text-2">
                      {t("cab.cli.import.offre")}
                    </span>
                    <select
                      value={offre}
                      onChange={(e) => setOffre(e.target.value)}
                      className={CHAMP}
                    >
                      <option value="">{t("cab.cli.import.offre.aucune")}</option>
                      {offres.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.libelle}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-[#c9e2d3] bg-[#f4f8f5] p-4 sm:grid-cols-4">
                {[
                  { n: String(nb("pret")), l: t("cab.cli.import.b.ouverts") },
                  { n: String(nb("existant")), l: t("cab.cli.import.b.mandats") },
                  { n: String(nb("pret")), l: t("cab.cli.import.b.invites") },
                  { n: "0", l: t("cab.cli.import.b.rien") },
                ].map((k) => (
                  <div key={k.l}>
                    <span className="num block text-[26px] text-foreground">{k.n}</span>
                    <span className="text-[12px] text-text-2">{k.l}</span>
                  </div>
                ))}
              </div>
              {creer.isPending ? (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-[#eef0f3]">
                    <div
                      className="h-2 bg-[#168b50] transition-[width]"
                      style={{ width: `${progres}%` }}
                    />
                  </div>
                  <p role="status" className="num text-[12px] text-muted-foreground">
                    {progres} %
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[380px] flex-col items-center justify-center gap-3 text-center">
              <span className="cab-pop flex h-20 w-20 items-center justify-center rounded-full bg-[#168b50] text-white">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  aria-hidden
                >
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </span>
              <p className="text-[22px] font-bold">
                {t("cab.cli.import.fin", { count: (bilan?.ouverts ?? 0) + (bilan?.mandats ?? 0) })}
              </p>
              <p className="max-w-[560px] text-[14px] text-muted-foreground">
                {/* Chaque nombre s'accorde (3.4) : « 1 société », jamais « 1 sociétés ». */}
                {[
                  bilan?.invites ? t("cab.cli.import.fin.invites", { count: bilan.invites }) : null,
                  bilan?.mandats ? t("cab.cli.import.fin.mandats", { count: bilan.mandats }) : null,
                  t("cab.cli.import.fin.suite"),
                ]
                  .filter(Boolean)
                  .join(" ")}
              </p>
              {bilan?.echecs.length ? (
                <ul className="max-w-[640px] space-y-1 text-start text-[12.5px] text-signal-stop">
                  {bilan.echecs.map((e) => (
                    <li key={e.nom}>
                      {e.nom} — {e.motif}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {erreur ? (
            <p role="alert" className="mt-3 text-[12.5px] text-signal-stop">
              {erreur}
            </p>
          ) : null}
        </div>

        <div className="flex justify-between gap-3 border-t border-border px-6 py-3">
          <button
            type="button"
            disabled={creer.isPending}
            onClick={() => (etape === 2 || etape === 3 ? setEtape((etape - 1) as Etape) : fermer())}
            className="cab-button cab-button-secondary"
          >
            {etape === 4
              ? t("cab.cli.fermer")
              : etape === 1
                ? t("common.cancel")
                : t("cab.cli.import.retour")}
          </button>
          {etape === 1 ? (
            <button
              type="button"
              disabled={!colle.trim() || verifier.isPending}
              onClick={() => charger(lireTexte(colle))}
              className="cab-button cab-button-primary"
            >
              {t("cab.cli.import.lire")}
            </button>
          ) : etape === 2 ? (
            aCorriger ? (
              <span className="flex flex-wrap gap-2">
                {aCreer > 0 ? (
                  <button
                    type="button"
                    onClick={() => setEtape(3)}
                    className="cab-button cab-button-secondary"
                  >
                    {t("cab.cli.import.sans", { count: aCreer })}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={verifier.isPending}
                  onClick={() => verifier.mutate(lignes)}
                  className="cab-button cab-button-primary"
                >
                  {t("cab.cli.import.reverifier")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={aCreer === 0}
                onClick={() => setEtape(3)}
                className="cab-button cab-button-primary"
              >
                {t("cab.cli.import.continuer", { count: aCreer })}
              </button>
            )
          ) : etape === 3 ? (
            <button
              type="button"
              disabled={creer.isPending}
              onClick={() => creer.mutate()}
              className="cab-button cab-button-primary"
            >
              {t("cab.cli.import.creer", { count: aCreer })}
            </button>
          ) : (
            <button type="button" onClick={fermer} className="cab-button cab-button-primary">
              {t("cab.cli.import.voir")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
