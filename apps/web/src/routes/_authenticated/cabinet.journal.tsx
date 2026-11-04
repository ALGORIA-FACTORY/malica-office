/**
 * Le journal du jour — ce que le cabinet a inscrit ce jour-là, et son export.
 *
 * ============================================================== POURQUOI
 *
 * Spec « Malica sans blocage », section 4, maquette « Journal du jour » : le
 * comptable finit sa journée sur un journal. Les écritures qu'il a validées,
 * celles qu'il a forcées (son nom, son heure), les contre-passations ; par
 * journal du référentiel ; le contrôle débit = crédit ; l'export Excel ou CSV,
 * numéroté, qui dit ce qui a changé depuis le précédent.
 *
 * L'écran ne calcule rien : les totaux, l'équilibre, l'origine et l'écart
 * depuis le dernier export viennent de l'API. Il ne modifie rien non plus :
 * corriger une écriture se fait sur sa pièce (contre-passation et écriture
 * nouvelle, R7), et la correction paraît ici le jour où elle est faite.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { enregistrerUnFichier } from "@/capabilities/enregistrer-un-fichier";
import { Aide } from "@/components/malica/aide";
import { useCabinet } from "@/components/malica/cabinet-context";
import { ecrireDossierCourant, useDossierCourant } from "@/components/malica/dossier-courant";
import { EmptyState, EnTeteCabinet } from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import {
  jourLisible,
  jourVoisin,
  nombreDeChangements,
  partiesDeLEcart,
} from "@/lib/journal-du-jour";
import { montant } from "@/lib/lisible";
import { idsDesMandatsActifs } from "@/lib/portefeuille-actif";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";
import type {
  EcartDepuisLExport,
  EcritureAuJournal,
  FormatDuJournal,
  JournalExporte,
  OrigineAuJournal,
  SoldeDuJournal,
} from "@malica/socle/ports/repositories";
import { estNul } from "@malica/socle/somme-decimale";

/** « tous » : la vue de tous les mandats du cabinet. Sinon l'identifiant d'un dossier. */
const TOUS = "tous";

export const Route = createFileRoute("/_authenticated/cabinet/journal")({
  head: () => ({
    meta: [
      { title: "Journal du jour — Malica Office" },
      {
        name: "description",
        content:
          "Les écritures validées, forcées et contre-passées du jour, par journal, et leur export numéroté.",
      },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { client?: string; jour?: string } => {
    const jour = jourLisible(s["jour"]);
    return {
      ...(typeof s["client"] === "string" ? { client: s["client"] } : {}),
      ...(jour ? { jour } : {}),
    };
  },
  component: CabinetJournal,
});

const ORIGINE: Record<OrigineAuJournal, { cle: MessageKey; ton: string }> = {
  validee: { cle: "cab.jdj.origine.validee", ton: "text-signal-ok" },
  forcee: { cle: "cab.jdj.origine.forcee", ton: "text-signal-warn" },
  contre_passation: { cle: "cab.jdj.origine.contre_passation", ton: "text-muted-foreground" },
};

function CabinetJournal() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const recherche = Route.useSearch();
  const navigate = Route.useNavigate();
  const dossierCourant = useDossierCourant();
  const [fait, setFait] = useState<JournalExporte | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Sans jour dans l'adresse, l'API rend celui du cabinet, dans SON fuseau
  // (un réglage du cabinet, pas l'horloge de ce poste).
  const jourDemande = recherche.jour ?? null;

  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  const actifs = idsDesMandatsActifs(clients.data ?? []);
  const mandats = (clients.data ?? []).filter((c) => actifs.has(c.tenantId));
  // Sans choix dans l'adresse, le dossier courant du cabinet ; à défaut, tous.
  const demande = recherche.client ?? dossierCourant?.id ?? TOUS;
  const client = mandats.find((c) => c.tenantId === demande) ?? null;
  const clientId = client?.tenantId ?? null;

  const journal = useQuery({
    queryKey: ["cab-journal-du-jour", org.id, clientId, jourDemande, locale],
    queryFn: () => office().journalDuJour.lire(org.id, clientId, jourDemande, locale),
    enabled: clients.isSuccess,
  });
  const donnees = journal.data;
  const jour = donnees?.jour ?? jourDemande;

  const exporter = useMutation({
    mutationFn: ({ format, du }: { format: FormatDuJournal; du: string }) =>
      office().journalDuJour.exporter(org.id, clientId, du, locale, format),
    onMutate: () => {
      setErreur(null);
      setFait(null);
    },
    onSuccess: async (r) => {
      // Le numéro est pris et le fichier gardé : il se télécharge depuis le
      // stockage — si la remise échoue, il reste dans la liste ci-dessous.
      setFait(r);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["cab-journal-du-jour", org.id] }),
        qc.invalidateQueries({ queryKey: ["cab-exports", org.id] }),
      ]);
      remettre.mutate({ id: r.id, nomDeFichier: r.nomDeFichier });
    },
    onError: (e) =>
      setErreur(texteDeLErreur(e, "journal du jour : export", t("cab.export.erreur"))),
  });

  /** Un export gardé, remis au poste : juste produit, ou d'un numéro passé. */
  const remettre = useMutation({
    mutationFn: async ({ id, nomDeFichier }: { id: string; nomDeFichier: string }) =>
      enregistrerUnFichier(await office().journalDuJour.fichier(id), nomDeFichier),
    onMutate: () => setErreur(null),
    onError: (e) =>
      setErreur(texteDeLErreur(e, "journal du jour : téléchargement", t("cab.jdj.remise.erreur"))),
  });

  const aller = (suite: { client?: string; jour?: string }) => {
    setFait(null);
    void navigate({
      search: { client: client?.tenantId ?? TOUS, ...(jour ? { jour } : {}), ...suite },
    });
  };

  const dateLongue = jour
    ? new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(new Date(`${jour}T00:00:00Z`))
    : "…";
  const dateCourte = (j: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
      new Date(`${j}T00:00:00Z`),
    );
  // L'heure d'un export, dans le fuseau du cabinet : celui de son journal.
  const heure = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      ...(donnees ? { timeZone: donnees.fuseau } : {}),
    }).format(new Date(iso));

  const veille = jour ? jourVoisin(jour, -1) : null;
  const lendemain = jour ? jourVoisin(jour, 1) : null;
  const vide = !donnees || donnees.totaux.ecritures === 0;
  const dernier = donnees?.dernierExport ?? null;
  const changements = dernier ? nombreDeChangements(dernier.ecart) : 0;
  const detailDeLEcart = (ecart: EcartDepuisLExport, numero: number) =>
    ecart.fuseauChange
      ? t("cab.jdj.fuseauChange", { numero })
      : partiesDeLEcart(ecart)
          .map((p) => t(p.cle, { n: p.n }))
          .join(" · ");

  const navigation =
    "inline-flex min-h-[48px] items-center gap-1 border border-border bg-card px-4 text-[13px] font-semibold hover:bg-accent disabled:opacity-40";

  return (
    <div className="cab-lisible space-y-6">
      <EnTeteCabinet
        surtitre={
          <>
            {client?.name ?? t("cab.jdj.tous")}
            <Aide
              titre={t("cab.nav.journal")}
              paragraphes={[
                { texte: t("cab.jdj.aide.contenu") },
                { texte: t("cab.jdj.aide.modifier") },
                { texte: t("cab.jdj.aide.export") },
              ]}
            />
          </>
        }
        titre={<>{t("cab.jdj.titre", { date: dateLongue })}</>}
        actions={
          <>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("cab.jdj.dossier")}
              <select
                value={client?.tenantId ?? TOUS}
                onChange={(e) => {
                  const choisi = mandats.find((c) => c.tenantId === e.target.value);
                  if (choisi) ecrireDossierCourant({ id: choisi.tenantId, name: choisi.name });
                  aller({ client: e.target.value });
                }}
                className="min-h-[48px] border border-border bg-card px-3 text-[13px] font-normal normal-case tracking-normal text-foreground"
              >
                <option value={TOUS}>{t("cab.jdj.tous")}</option>
                {mandats.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {veille && lendemain && donnees ? (
              <>
                <button
                  type="button"
                  className={navigation}
                  aria-label={t("cab.jdj.precedent")}
                  onClick={() => aller({ jour: veille })}
                >
                  <ChevronLeft size={15} aria-hidden className="rtl:-scale-x-100" />
                  {dateCourte(veille)}
                </button>
                <button
                  type="button"
                  className={navigation}
                  aria-label={t("cab.jdj.suivant")}
                  disabled={lendemain > donnees.aujourdhui}
                  onClick={() => aller({ jour: lendemain })}
                >
                  {dateCourte(lendemain)}
                  <ChevronRight size={15} aria-hidden className="rtl:-scale-x-100" />
                </button>
              </>
            ) : null}
          </>
        }
      />

      {journal.isError ? (
        <p role="alert" className="text-[13px] text-signal-stop">
          {texteDeLErreur(journal.error, "journal du jour : lecture", t("common.error"))}
        </p>
      ) : null}

      {/* ---- l'état du journal en une ligne : ce qui y est, s'il tient, ce qui a bougé */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Compteur libelle={t("cab.jdj.ecritures")}>
          {donnees ? String(donnees.totaux.ecritures) : "—"}
        </Compteur>
        <Compteur
          libelle={t("cab.jdj.valideesForcees")}
          detail={
            donnees && donnees.totaux.contrePassations > 0
              ? t("cab.jdj.contrePassations", {
                  count: donnees.totaux.contrePassations,
                  n: donnees.totaux.contrePassations,
                })
              : null
          }
        >
          {donnees ? `${donnees.totaux.validees} · ${donnees.totaux.forcees}` : "—"}
        </Compteur>
        <Equilibre soldes={donnees?.totaux.soldes ?? []} />
        <Compteur
          libelle={
            dernier
              ? t("cab.jdj.export", { numero: dernier.numero, heure: heure(dernier.createdAt) })
              : t("cab.jdj.export.aucun")
          }
          detail={
            dernier && (changements > 0 || dernier.ecart.fuseauChange)
              ? detailDeLEcart(dernier.ecart, dernier.numero)
              : null
          }
          ton={
            dernier
              ? changements > 0 || dernier.ecart.fuseauChange
                ? "text-signal-warn"
                : "text-signal-ok"
              : undefined
          }
        >
          {dernier
            ? changements > 0
              ? t("cab.jdj.changements", { count: changements, n: changements })
              : dernier.ecart.fuseauChange
                ? t("cab.jdj.fuseauChange.court")
                : t("cab.jdj.aJour")
            : "—"}
        </Compteur>
      </div>

      {/* ---- l'export : principal plein à gauche, secondaire en contour */}
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <button
          type="button"
          disabled={vide || exporter.isPending}
          onClick={() => donnees && exporter.mutate({ format: "xlsx", du: donnees.jour })}
          className="min-h-[48px] border border-foreground bg-foreground px-4 text-[13.5px] font-semibold text-background transition-colors hover:bg-background hover:text-foreground disabled:opacity-40"
        >
          {exporter.isPending && exporter.variables?.format === "xlsx"
            ? t("cab.jdj.exporter.enCours")
            : t("cab.jdj.exporter.xlsx")}
        </button>
        <button
          type="button"
          disabled={vide || exporter.isPending}
          onClick={() => donnees && exporter.mutate({ format: "csv", du: donnees.jour })}
          className="min-h-[48px] border border-foreground bg-card px-4 text-[13.5px] font-semibold hover:bg-accent disabled:opacity-40"
        >
          {exporter.isPending && exporter.variables?.format === "csv"
            ? t("cab.jdj.exporter.enCours")
            : t("cab.jdj.exporter.csv")}
        </button>
      </div>
      {erreur ? (
        <p role="alert" className="text-[12.5px] text-signal-stop">
          {erreur}
        </p>
      ) : null}
      {fait ? (
        <p role="status" className="num text-[12.5px] text-signal-ok">
          {t("cab.jdj.fait", { numero: fait.numero, fichier: fait.nomDeFichier })}
          {fait.precedent !== null
            ? ` · ${
                fait.ecart.fuseauChange
                  ? t("cab.jdj.fuseauChange", { numero: fait.precedent })
                  : t("cab.jdj.depuis", {
                      count: nombreDeChangements(fait.ecart),
                      n: nombreDeChangements(fait.ecart),
                      precedent: fait.precedent,
                    })
              }`
            : null}
        </p>
      ) : null}

      {/* ---- les exports de ce jour, gardés : chacun se télécharge à nouveau */}
      {donnees && donnees.exports.length > 0 ? (
        <section aria-label={t("cab.jdj.exports")} className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("cab.jdj.exports")}
          </h2>
          <ul className="divide-y divide-border border border-border bg-card">
            {[...donnees.exports].reverse().map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
              >
                <span className="num text-[12.5px]">
                  {t("cab.jdj.export", { numero: x.numero, heure: heure(x.createdAt) })} ·{" "}
                  {x.format.toUpperCase()}
                  {x.auteur ? ` · ${x.auteur}` : ""}
                </span>
                <button
                  type="button"
                  disabled={remettre.isPending}
                  onClick={() => remettre.mutate({ id: x.id, nomDeFichier: x.nomDeFichier })}
                  className="min-h-[48px] border border-foreground bg-card px-4 text-[12.5px] font-semibold hover:bg-accent disabled:opacity-40"
                  aria-label={t("cab.jdj.telecharger.numero", { numero: x.numero })}
                >
                  {t("cab.jdj.telecharger")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---- les journaux */}
      {journal.isPending ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : vide ? (
        <EmptyState>{t("cab.jdj.vide")}</EmptyState>
      ) : (
        donnees.journaux.map((j) => (
          <section key={j.code} aria-label={j.libelle} className="space-y-2">
            <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-t border-foreground pt-3 text-[15px] font-semibold">
              <span>{j.libelle}</span>
              <span className="num text-[12px] font-medium text-muted-foreground">
                {j.soldes.map((s) => `${montant(s.debit, locale)} ${s.devise}`).join(" · ")}
              </span>
            </h2>
            {/* Au téléphone (`cab-jdj-lignes`), une ligne d'écriture tient sur la
                largeur : compte, libellé, montant — l'en-tête de l'écriture au-dessus. */}
            <div className="cab-jdj-lignes overflow-x-auto border border-border bg-card">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead className="bg-muted text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start">
                      {t("cab.jdj.col.heure")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start">
                      {t("cab.jdj.col.piece")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start">
                      {t("cab.jdj.col.compte")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start">
                      {t("cab.jdj.col.libelle")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-end">
                      {t("cab.jdj.col.debit")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-end">
                      {t("cab.jdj.col.credit")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-start">
                      {t("cab.jdj.col.origine")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {j.ecritures.map((e) => (
                    <LignesDeLEcriture key={e.id} e={e} tous={!client} />
                  ))}
                </tbody>
                <tfoot>
                  {j.soldes.map((s) => (
                    <tr key={s.devise} className="border-t border-foreground font-semibold">
                      <td data-col="total" colSpan={4} className="px-3 py-2">
                        {t("cab.jdj.total")} · {s.devise}
                      </td>
                      <td
                        data-col="debit"
                        data-label={t("cab.jdj.col.debit")}
                        className="num px-3 py-2 text-end"
                      >
                        {montant(s.debit, locale)}
                      </td>
                      <td
                        data-col="credit"
                        data-label={t("cab.jdj.col.credit")}
                        className="num px-3 py-2 text-end"
                      >
                        {montant(s.credit, locale)}
                      </td>
                      <td
                        data-col="origine"
                        className={cn(
                          "px-3 py-2",
                          s.equilibre ? "text-signal-ok" : "text-signal-stop",
                        )}
                      >
                        {s.equilibre ? t("cab.jdj.equilibre") : t("cab.jdj.desequilibre")}
                      </td>
                    </tr>
                  ))}
                </tfoot>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Compteur({
  libelle,
  detail,
  ton,
  children,
}: {
  libelle: string;
  detail?: string | null;
  ton?: string | undefined;
  children: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 border border-border bg-card px-4 py-3">
      <span className="text-[12px] text-muted-foreground">{libelle}</span>
      <b className={cn("num text-[20px] font-semibold", ton)}>{children}</b>
      {detail ? <span className="text-[11.5px] text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

/** Débit = crédit, devise par devise : le total en vert s'il tient, en rouge sinon. */
function Equilibre({ soldes }: { soldes: readonly SoldeDuJournal[] }) {
  const { t, locale } = useI18n();
  const tient = soldes.every((s) => s.equilibre);
  return (
    <Compteur
      libelle={tient ? t("cab.jdj.equilibre") : t("cab.jdj.desequilibre")}
      ton={soldes.length === 0 ? undefined : tient ? "text-signal-ok" : "text-signal-stop"}
    >
      {soldes.length === 0
        ? "—"
        : soldes
            .map((s) =>
              s.equilibre
                ? `${montant(s.debit, locale)} ${s.devise}`
                : `${montant(s.debit, locale)} ≠ ${montant(s.credit, locale)} ${s.devise}`,
            )
            .join(" · ")}
    </Compteur>
  );
}

/** Les lignes d'une écriture ; l'heure, la pièce et l'origine sur la première seulement. */
function LignesDeLEcriture({ e, tous }: { e: EcritureAuJournal; tous: boolean }) {
  const { t, locale } = useI18n();
  const origine = ORIGINE[e.origine];
  return (
    <>
      {e.lignes.map((l, i) => (
        <tr
          key={l.ordinal}
          data-premiere={i === 0 || undefined}
          className={cn(i === 0 ? "border-t border-border" : "")}
        >
          <td data-col="heure" className="num px-3 py-1.5 text-muted-foreground">
            {i === 0 ? e.heure : ""}
          </td>
          <td data-col="piece" className="px-3 py-1.5 font-medium">
            {i === 0 ? (
              <>
                {tous ? (
                  <span className="block text-[11px] text-muted-foreground">{e.clientNom}</span>
                ) : null}
                {e.pieceId ? (
                  <Link
                    to="/cabinet/piece/$pieceId"
                    params={{ pieceId: e.pieceId }}
                    className="underline-offset-4 hover:underline"
                  >
                    {e.libelle}
                  </Link>
                ) : (
                  e.libelle
                )}
              </>
            ) : null}
          </td>
          <td data-col="compte" className="num px-3 py-1.5">
            {l.compte}
          </td>
          <td data-col="libelle" className="px-3 py-1.5">
            {l.compteLibelle}
            {/* Une ligne convertie d'une pièce en devise : son montant d'origine, au cours. */}
            {l.origine ? (
              <span className="num block text-[11px] text-muted-foreground" dir="ltr">
                {montant(l.origine.montant, locale)} {l.origine.devise} ×{" "}
                {montant(l.origine.taux, locale)} · {l.origine.source}
              </span>
            ) : null}
            {/* D'où vient le cours — l'officiel importé, une saisie, une dérogation — et pourquoi. */}
            {l.origine ? (
              <span className="block text-[11px] text-muted-foreground" dir="auto">
                {l.origine.libelleOrigineDuCours}
                {l.origine.motifDuCours ? ` · ${l.origine.motifDuCours}` : ""}
              </span>
            ) : null}
          </td>
          {/* Une ligne n'est que d'un côté : l'autre reste vide, pas « 0 » — et au
              téléphone, le côté vide disparaît, le montant porte son sens. */}
          <td
            data-col="debit"
            data-label={t("cab.jdj.col.debit")}
            data-vide={estNul(l.debit) || undefined}
            className="num px-3 py-1.5 text-end"
          >
            {estNul(l.debit) ? "" : montant(l.debit, locale)}
          </td>
          <td
            data-col="credit"
            data-label={t("cab.jdj.col.credit")}
            data-vide={estNul(l.credit) || undefined}
            className="num px-3 py-1.5 text-end"
          >
            {estNul(l.credit) ? "" : montant(l.credit, locale)}
          </td>
          <td
            data-col="origine"
            className={cn("px-3 py-1.5 text-[12px] font-semibold", origine.ton)}
          >
            {i === 0 ? (
              <>
                {t(origine.cle)}
                {e.origine === "forcee" && e.par ? (
                  <span className="block font-normal text-muted-foreground">{e.par}</span>
                ) : null}
                {e.contrePasseeLe ? (
                  <span className="block font-normal text-muted-foreground">
                    {t("cab.jdj.contrePassee")}
                  </span>
                ) : null}
              </>
            ) : null}
          </td>
        </tr>
      ))}
    </>
  );
}
