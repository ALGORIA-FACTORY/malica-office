/**
 * La bibliothèque du cabinet — les pièces d'un client, rangées par mois puis par type.
 *
 * Écran du cabinet : le comptable choisit l'un de ses clients actifs, ouvre un mois,
 * puis un type de document, et retrouve les pièces avec leur miniature. Il peut en
 * télécharger ou en imprimer une, une sélection, ou tout le dossier comptable. Les clients et les pièces viennent
 * de la supervision du cabinet (`supervision.listClients`) ; les pièces sont lues
 * côté serveur, un mois à la fois quand le dossier est trop gros pour tenir d'un coup.
 *
 * Chaque niveau (client, mois, type) a sa propre adresse : le retour du navigateur,
 * le geste retour du téléphone et un lien partagé ramènent au même endroit.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, Library, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { useCabinet } from "@/components/malica/cabinet-context";
import { EmptyState, SignalLight, type Tone } from "@/components/malica/office-ui";
import { ImprimerLesPieces } from "@/components/malica/imprimer-les-pieces";
import { TelechargerDossierComptable } from "@/components/malica/telecharger-dossier-comptable";
import { useI18n, type MessageKey } from "@/i18n";
import {
  AUTRES,
  compter,
  etatDu,
  moisDe,
  rangerLesMois,
  rangerParMois,
  totalDu,
  typeRange,
  type EtatDuGroupe,
} from "@/lib/bibliotheque-par-mois";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { feuDuStatut } from "@/lib/file-cabinet";
import { MOT_CABINET } from "@/lib/statut";
import { dateEnChiffres, montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";
import { A_TRAITER } from "@malica/socle/statut-d-envoi";
import type { ClientSummary, DocumentComptable } from "@malica/socle/ports/repositories";

export const Route = createFileRoute("/_authenticated/cabinet/bibliotheque")({
  /*
   * Chaque niveau a son adresse — client, mois, type — pour que le retour du
   * navigateur, le geste retour du téléphone et un lien partagé ramènent au
   * même endroit (maquette du 4 novembre 2026).
   */
  validateSearch: (s: Record<string, unknown>): Niveau => ({
    ...(typeof s["client"] === "string" ? { client: s["client"] } : {}),
    ...(typeof s["mois"] === "string" && /^\d{4}-\d{2}$/.test(s["mois"])
      ? { mois: s["mois"] }
      : {}),
    ...(typeof s["mois"] === "string" && typeof s["type"] === "string" ? { type: s["type"] } : {}),
  }),
  component: Bibliotheque,
});

function Bibliotheque() {
  const { org } = useCabinet();
  const { t } = useI18n();
  const recherche = Route.useSearch();
  const navigate = Route.useNavigate();
  const clients = useQuery({
    queryKey: ["cab-clients", org.id],
    queryFn: () => office().supervision.listClients(org.id),
  });
  // Les mandats en vigueur, et les archives : un mandat terminé garde ce que
  // la comptabilité a pris en charge, en lecture seule (1.6).
  const actifs = (clients.data ?? []).filter((c) => c.engagementStatus === "actif" || c.archive);
  const client = recherche.client ? actifs.find((c) => c.tenantId === recherche.client) : actifs[0];
  const dansUnMois = Boolean(client && recherche.mois);
  const choisir = (id: string) => {
    void navigate({ search: { client: id } });
  };
  if (clients.isPending) return <p role="status">{t("common.loading")}</p>;
  if (clients.isError)
    return (
      <p role="alert" className="text-signal-stop">
        {texteDeLErreur(clients.error, "bibliothèque", t("common.error"))}
      </p>
    );
  return (
    <div className="cab-doclib space-y-6">
      {dansUnMois ? null : (
        <>
          <header>
            <p className="cab-doclib-kicker">
              <Library className="h-4 w-4" aria-hidden />
              {org.name}
            </p>
            <h1>{t("cab.biblio.title")}</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">{t("cab.biblio.subtitle")}</p>
          </header>
          <div className="cab-doclib-clients">
            {actifs.slice(0, RACCOURCIS_CLIENTS).map((c) => (
              <button
                type="button"
                key={c.tenantId}
                className="cab-doclib-client"
                aria-pressed={c.tenantId === client?.tenantId}
                onClick={() => choisir(c.tenantId)}
              >
                <strong>{c.name}</strong>
                <span>{c.archive ? t("cab.archive.badge") : (c.legalId ?? c.jurisdiction)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="min-w-0 flex-1 text-[12px] text-muted-foreground">
              {t("cab.biblio.client")}
              <select
                className="mt-1 block w-full border border-border bg-card p-2 text-foreground"
                value={client?.tenantId ?? ""}
                onChange={(e) => choisir(e.target.value)}
              >
                <option value="" disabled>
                  {t("cab.biblio.noClient")}
                </option>
                {actifs.map((c) => (
                  <option key={c.tenantId} value={c.tenantId}>
                    {c.archive ? `${c.name} — ${t("cab.archive.badge")}` : c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {client?.archive ? (
        <p role="status" className="border border-s-[3px] border-border bg-card p-3 text-[13px]">
          {t("cab.archive.biblio")}
        </p>
      ) : null}
      {client ? (
        <BibliothequeDuClient
          key={client.tenantId}
          client={client}
          cabinetId={org.id}
          mois={recherche.mois ?? null}
          type={recherche.type ?? null}
        />
      ) : (
        <EmptyState>{t("cab.biblio.noClient")}</EmptyState>
      )}
    </div>
  );
}

/**
 * Les clients offerts en raccourci : une rangée de `.cab-doclib-clients`, qui
 * compte trois colonnes. Les autres restent dans la liste juste dessous — un
 * raccourci n'est pas un filtre, et aucun client n'en devient inaccessible.
 */
const RACCOURCIS_CLIENTS = 3;

/** L'adresse d'un niveau : le client, puis le mois « AAAA-MM », puis le type. */
interface Niveau {
  client?: string;
  mois?: string;
  type?: string;
}

/** « 2026-06 » → « Juin 2026 », dans la langue de la personne. */
function nomDuMois(mois: string, locale: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  const nom = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return nom.charAt(0).toLocaleUpperCase(locale) + nom.slice(1);
}

const FEU_DE_L_ETAT: Record<EtatDuGroupe, { feu: Tone; mot: MessageKey } | null> = {
  a_valider: { feu: feuDuStatut("recue"), mot: "cab.biblio.etat.aValider" },
  chez_le_client: { feu: feuDuStatut("retournee"), mot: "cab.biblio.etat.chezLeClient" },
  pret: { feu: feuDuStatut("validee"), mot: "cab.biblio.etat.pret" },
  neutre: null,
};

function PastilleDuGroupe({ pieces }: { pieces: DocumentComptable[] }) {
  const { t } = useI18n();
  const etat = FEU_DE_L_ETAT[etatDu(pieces)];
  return etat ? <SignalLight tone={etat.feu} label={t(etat.mot)} /> : null;
}

function TotalDuGroupe({ pieces }: { pieces: DocumentComptable[] }) {
  const { t, locale } = useI18n();
  const total = totalDu(pieces);
  if (total.genre === "a_saisir")
    return <span className="cab-doclib-a-saisir">{t("cab.biblio.ttcASaisir")}</span>;
  if (total.genre === "devises")
    return <span className="text-[12px] text-muted-foreground">{total.devises.join(" · ")}</span>;
  return (
    <span className="cab-doclib-total">
      <span className="num">{montant(total.montant, locale)}</span>
      <span>{t("cab.biblio.ttc", { devise: total.devise })}</span>
    </span>
  );
}

/**
 * Une carte qui s'ouvre, et dont le téléchargement ne l'ouvre pas : le lien
 * couvre la carte (`::after`), le bouton passe au-dessus. Un bouton DANS un
 * lien serait du HTML invalide, et son dialogue ouvrirait la carte.
 */
function Carte({
  vers,
  titre,
  pieces,
  ligne,
  telecharger,
}: {
  vers: Niveau;
  titre: string;
  pieces: DocumentComptable[];
  ligne: string;
  telecharger: ReactNode;
}) {
  return (
    <li className="cab-doclib-carte">
      <ApercuDePiece pieceId={pieces[0]!.id} className="vignette" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link to="/cabinet/bibliotheque" search={vers} className="cab-doclib-carte-lien">
            {titre}
          </Link>
          <PastilleDuGroupe pieces={pieces} />
        </div>
        <TotalDuGroupe pieces={pieces} />
        <div className="mt-auto flex items-center justify-between gap-2">
          <span className="text-[12px] text-muted-foreground">{ligne}</span>
          <span className="cab-doclib-au-dessus">{telecharger}</span>
        </div>
      </div>
    </li>
  );
}

function BibliothequeDuClient({
  client,
  cabinetId,
  mois,
  type,
}: {
  client: ClientSummary;
  cabinetId: string;
  mois: string | null;
  type: string | null;
}) {
  const { t, locale } = useI18n();
  const navigate = Route.useNavigate();
  const [recherche, setRecherche] = useState("");
  /*
   * Le sommaire d'abord : il dit les mois et les types, et si le dossier se
   * restitue d'un coup. Au-delà du plafond de l'API, on ne charge que le mois
   * ouvert (revue de #219 : un grand dossier ne s'ouvrait plus du tout).
   */
  const sommaire = useQuery({
    queryKey: ["cab-bibliotheque-sommaire", cabinetId, client.tenantId],
    queryFn: () => office().supervision.moisDuDossier(cabinetId, client.tenantId),
  });
  const complet = sommaire.data
    ? sommaire.data.mois.reduce((n, m) => n + m.n, 0) <= sommaire.data.plafond
    : false;
  const periode = mois ?? null;
  const documents = useQuery({
    queryKey: ["cab-bibliotheque", cabinetId, client.tenantId, complet ? null : periode],
    queryFn: () =>
      office().supervision.documents(cabinetId, client.tenantId, complet ? null : periode),
    enabled: sommaire.isSuccess && (complet || periode !== null),
  });
  const types = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
  });
  const codes = useMemo(() => new Set((types.data ?? []).map((ty) => ty.code)), [types.data]);
  const nomType = (code: string) =>
    code === AUTRES
      ? t("cab.biblio.autres")
      : (types.data?.find((d) => d.code === code)?.libelle ?? t("cab.biblio.document"));
  const tous = documents.data ?? [];
  const duMois = mois ? tous.filter((d) => moisDe(d) === mois) : tous;
  const duNiveau = type ? duMois.filter((d) => typeRange(d.type, codes) === type) : duMois;
  const parent: Niveau | null = type
    ? { client: client.tenantId, mois: mois! }
    : mois
      ? { client: client.tenantId }
      : null;

  // Échap remonte d'un niveau — sauf dans un champ, ou quand un dialogue est ouvert.
  useEffect(() => {
    if (!parent) return;
    const surEchap = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      void navigate({ search: parent });
    };
    window.addEventListener("keydown", surEchap);
    return () => window.removeEventListener("keydown", surEchap);
  }, [navigate, parent?.client, parent?.mois]); // eslint-disable-line react-hooks/exhaustive-deps

  const enAttente = sommaire.isPending || (documents.isPending && documents.fetchStatus !== "idle");
  const echec = sommaire.error ?? documents.error;
  if (echec)
    return (
      <p role="alert" className="text-signal-stop">
        {texteDeLErreur(echec, "bibliothèque", t("common.error"))}
      </p>
    );
  if (enAttente) return <p role="status">{t("common.loading")}</p>;
  const typesDuDossier = new Set((sommaire.data?.mois ?? []).map((m) => typeRange(m.type, codes)));
  const vide = (sommaire.data?.mois.length ?? 0) === 0;

  const cherche = recherche.trim().toLocaleLowerCase(locale);
  const trouves = cherche
    ? duNiveau.filter((d) =>
        [d.tiers, d.reference, d.type, nomType(typeRange(d.type, codes))].some((s) =>
          s?.toLocaleLowerCase(locale).includes(cherche),
        ),
      )
    : duNiveau;
  const nomDuDossier = [
    client.name,
    mois ? nomDuMois(mois, locale) : null,
    type ? nomType(type) : null,
  ]
    .filter(Boolean)
    .join(" ");
  const libelleDuNiveau = mois
    ? t("cab.biblio.telechargerMois", { mois: nomDuMois(mois, locale) })
    : t("cab.biblio.download");

  return (
    <section className="space-y-5">
      <div className="cab-doclib-barre">
        {parent ? (
          <div className="flex min-w-0 items-center gap-4">
            <Link
              to="/cabinet/bibliotheque"
              search={parent}
              className="cab-doclib-retour"
              aria-label={t("cab.biblio.retour")}
              title={t("cab.biblio.retour")}
            >
              <ChevronLeft aria-hidden strokeWidth={2.6} />
            </Link>
            <h1 className="cab-doclib-ou">
              <strong>{type ? nomType(type) : nomDuMois(mois!, locale)}</strong>
              {" · "}
              {type ? `${nomDuMois(mois!, locale)} · ` : ""}
              {client.name}
              {client.legalId ? (
                <>
                  {" · "}
                  <span className="num">{client.legalId}</span>
                </>
              ) : null}
            </h1>
          </div>
        ) : (
          <h2 className="text-[18px] font-medium">{client.name}</h2>
        )}
        <div className="cab-doclib-actions">
          <label className="cab-doclib-search">
            <Search className="h-4 w-4" aria-hidden />
            <input
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder={t("cab.biblio.search")}
              aria-label={t("cab.biblio.search")}
            />
          </label>
          {type ? null : (
            <TelechargerDossierComptable
              cabinetId={cabinetId}
              clientId={client.tenantId}
              nomClient={nomDuDossier}
              pieces={duNiveau.map((d) => d.id)}
              libelle={libelleDuNiveau}
              principal
            />
          )}
          {type ? null : (
            <ImprimerLesPieces
              cabinetId={cabinetId}
              pieces={duNiveau.map((d) => d.id)}
              portee="dossier"
              nom={nomDuDossier}
              titre={nomDuDossier}
              libelle={
                mois
                  ? t("cab.biblio.imprimer.mois", { mois: nomDuMois(mois, locale) })
                  : t("cab.biblio.imprimer.dossier")
              }
            />
          )}
        </div>
      </div>
      {vide ? (
        <EmptyState>{t("cab.biblio.empty")}</EmptyState>
      ) : type || cherche ? (
        <ListeDesPieces
          key={`${mois}:${type}`}
          pieces={trouves}
          cabinetId={cabinetId}
          client={client}
          nomDuDossier={nomDuDossier}
          nomType={(d) => nomType(typeRange(d.type, codes))}
        />
      ) : mois ? (
        <LeMois
          pieces={duMois}
          cabinetId={cabinetId}
          client={client}
          mois={mois}
          codes={codes}
          types={types.data ?? []}
          typesDuDossier={typesDuDossier}
          nomType={nomType}
        />
      ) : complet ? (
        <LesMois pieces={tous} cabinetId={cabinetId} client={client} />
      ) : (
        <LeSommaire mois={sommaire.data!.mois} client={client} />
      )}
    </section>
  );
}

/** Niveau 1 : la ligne de contrôle, puis un mois par carte, les mois vides regroupés. */
function LesMois({
  pieces,
  cabinetId,
  client,
}: {
  pieces: DocumentComptable[];
  cabinetId: string;
  client: ClientSummary;
}) {
  const { t, locale } = useI18n();
  const rangees = rangerParMois(pieces);
  const compte = compter(rangees);
  const cartes: ReactNode[] = [];
  let lot: ReactNode[] = [];
  const fermerLeLot = () => {
    if (lot.length)
      cartes.push(
        <ul key={`lot-${cartes.length}`} className="cab-doclib-cartes">
          {lot}
        </ul>,
      );
    lot = [];
  };
  for (const r of rangees) {
    if (r.genre === "trou") {
      fermerLeLot();
      cartes.push(
        <p key={`trou-${r.du}`} className="cab-doclib-trou">
          <strong>
            {r.n === 1
              ? nomDuMois(r.du, locale)
              : t("cab.biblio.trou", { du: nomDuMois(r.au, locale), au: nomDuMois(r.du, locale) })}
          </strong>
          <span> · {t("cab.biblio.aucunePiece")}</span>
        </p>,
      );
      continue;
    }
    const nom = nomDuMois(r.mois, locale);
    lot.push(
      <Carte
        key={r.mois}
        vers={{ client: client.tenantId, mois: r.mois }}
        titre={nom}
        pieces={r.pieces}
        ligne={t("cab.biblio.pieces", { count: r.pieces.length })}
        telecharger={
          <span className="inline-flex gap-2">
            <TelechargerDossierComptable
              cabinetId={cabinetId}
              clientId={client.tenantId}
              nomClient={`${client.name} ${nom}`}
              pieces={r.pieces.map((d) => d.id)}
              libelle={t("cab.biblio.telechargerMois", { mois: nom })}
              compact
            />
            <ImprimerLesPieces
              cabinetId={cabinetId}
              pieces={r.pieces.map((d) => d.id)}
              portee="dossier"
              nom={`${client.name} ${nom}`}
              titre={`${client.name} · ${nom}`}
              libelle={t("cab.biblio.imprimer.mois", { mois: nom })}
              compact
            />
          </span>
        }
      />,
    );
  }
  fermerLeLot();
  return (
    <>
      <div className="cab-doclib-controle" role="group" aria-label={t("cab.biblio.regles")}>
        <div className="flex flex-wrap">
          <Compteur n={compte.aValider} mot={t("cab.biblio.compteur.aValider")} ton="warn" />
          <Compteur
            n={compte.moisSansPiece}
            mot={t("cab.biblio.compteur.moisSansPiece")}
            ton="warn"
          />
          <Compteur
            n={compte.moisPrets}
            mot={t("cab.biblio.compteur.moisPrets", { count: compte.moisPrets })}
            ton="ok"
          />
        </div>
        <span className="cab-doclib-regles" title={t("cab.biblio.reglesDetail")}>
          {t("cab.biblio.regles")}
        </span>
      </div>
      {cartes}
    </>
  );
}

function Compteur({ n, mot, ton }: { n: number; mot: string; ton: "warn" | "ok" }) {
  return (
    <p className="cab-doclib-compteur" data-ton={n === 0 ? "neutre" : ton}>
      <span className="num">{n}</span>
      {mot}
    </p>
  );
}

/** Niveau 2 : ce qui attend dans le mois, puis un type de document par carte. */
function LeMois({
  pieces,
  cabinetId,
  client,
  mois,
  codes,
  types,
  typesDuDossier,
  nomType,
}: {
  pieces: DocumentComptable[];
  cabinetId: string;
  client: ClientSummary;
  mois: string;
  codes: ReadonlySet<string>;
  types: Array<{ code: string; libelle: string; transmissible: boolean }>;
  /** Les types que ce client a déjà transmis, dans n'importe quel mois. */
  typesDuDossier: ReadonlySet<string>;
  nomType: (code: string) => string;
}) {
  const { t, locale } = useI18n();
  const nomMois = nomDuMois(mois, locale);
  // Dans l'ordre du référentiel (`ref.document_types`) ; aucune liste de codes ici.
  const parType = new Map<string, DocumentComptable[]>();
  for (const d of pieces) {
    const k = typeRange(d.type, codes);
    parType.set(k, [...(parType.get(k) ?? []), d]);
  }
  const ordre = [
    ...types.map((ty) => ty.code).filter((c) => parType.has(c)),
    ...(parType.has(AUTRES) ? [AUTRES] : []),
  ];
  // Absent : un type que CE client transmet d'habitude (vu dans un autre mois),
  // pas tout le référentiel — vingt étiquettes ne disent rien (recette du 4 novembre).
  const absents = types.filter((ty) => typesDuDossier.has(ty.code) && !parType.has(ty.code));
  const enAttente = pieces.filter((d) => d.statut && A_TRAITER.has(d.statut));
  if (pieces.length === 0) return <EmptyState>{t("cab.biblio.empty")}</EmptyState>;
  return (
    <>
      {enAttente.length > 0 ? (
        <div className="cab-doclib-attente" role="status">
          <p>
            <strong>
              {t("cab.biblio.attente", {
                count: enAttente.length,
                qui: enAttente
                  .slice(0, 3)
                  .map((d) => d.tiers ?? d.reference ?? nomType(typeRange(d.type, codes)))
                  .join(", "),
              })}
            </strong>
            {enAttente.some((d) => d.montant === null) ? ` · ${t("cab.biblio.ttcNonLu")}` : null}
          </p>
          <Link
            to="/cabinet/piece/$pieceId"
            params={{ pieceId: enAttente[0]!.id }}
            className="cab-doclib-button"
          >
            {t("cab.biblio.ouvrir", {
              qui:
                enAttente[0]!.tiers ??
                enAttente[0]!.reference ??
                nomType(typeRange(enAttente[0]!.type, codes)),
            })}
          </Link>
        </div>
      ) : null}
      <ul className="cab-doclib-cartes">
        {ordre.map((code) => {
          const du = parType.get(code)!;
          const qui = [...new Set(du.map((d) => d.tiers).filter(Boolean))];
          return (
            <Carte
              key={code}
              vers={{ client: client.tenantId, mois, type: code }}
              titre={nomType(code)}
              pieces={du}
              ligne={[t("cab.biblio.pieces", { count: du.length }), ...qui.slice(0, 2)].join(" · ")}
              telecharger={
                <span className="inline-flex gap-2">
                  <TelechargerDossierComptable
                    cabinetId={cabinetId}
                    clientId={client.tenantId}
                    nomClient={`${client.name} ${nomMois} ${nomType(code)}`}
                    pieces={du.map((d) => d.id)}
                    libelle={t("cab.biblio.telechargerTypeDuMois", {
                      type: nomType(code),
                      mois: nomMois,
                    })}
                    compact
                  />
                  <ImprimerLesPieces
                    cabinetId={cabinetId}
                    pieces={du.map((d) => d.id)}
                    portee="dossier"
                    nom={`${client.name} ${nomMois} ${nomType(code)}`}
                    titre={`${client.name} · ${nomType(code)} · ${nomMois}`}
                    libelle={t("cab.biblio.imprimer.typeDuMois", {
                      type: nomType(code),
                      mois: nomMois,
                    })}
                    compact
                  />
                </span>
              }
            />
          );
        })}
      </ul>
      {absents.length > 0 ? (
        <p className="cab-doclib-absents">
          <span>{t("cab.biblio.absents")}</span>
          {absents.map((ty) => (
            <span key={ty.code} className="cab-doclib-etiquette">
              {ty.libelle}
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

/** Niveau 3 (ou une recherche) : les pièces, la case à cocher, la miniature, un téléchargement chacune. */
function ListeDesPieces({
  pieces,
  cabinetId,
  client,
  nomDuDossier,
  nomType,
}: {
  pieces: DocumentComptable[];
  cabinetId: string;
  client: ClientSummary;
  nomDuDossier: string;
  nomType: (d: DocumentComptable) => string;
}) {
  const { t, locale } = useI18n();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const coches = pieces.filter((d) => selection.has(d.id)).map((d) => d.id);
  const toutCoche = pieces.length > 0 && coches.length === pieces.length;
  if (pieces.length === 0) return <EmptyState>{t("cab.biblio.empty")}</EmptyState>;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={toutCoche}
            onChange={(e) =>
              setSelection(e.target.checked ? new Set(pieces.map((d) => d.id)) : new Set())
            }
          />
          {t("cab.biblio.toutCocher")}
        </label>
        <div className="flex flex-wrap gap-2">
          <TelechargerDossierComptable
            cabinetId={cabinetId}
            clientId={client.tenantId}
            nomClient={nomDuDossier}
            pieces={coches.length ? coches : pieces.map((d) => d.id)}
            libelle={
              coches.length
                ? t("cab.biblio.selection", { n: coches.length })
                : t("cab.biblio.toutTelecharger", { n: pieces.length })
            }
            principal
          />
          <ImprimerLesPieces
            cabinetId={cabinetId}
            pieces={coches.length ? coches : pieces.map((d) => d.id)}
            portee={coches.length ? "selection" : "dossier"}
            nom={nomDuDossier}
            titre={nomDuDossier}
            libelle={
              coches.length
                ? t("cab.biblio.imprimer.selection", { n: coches.length })
                : t("cab.biblio.imprimer.tout", { n: pieces.length })
            }
          />
        </div>
      </div>
      <ul className="cab-doclib-documents">
        {pieces.map((d) => (
          <li key={d.id}>
            <input
              type="checkbox"
              checked={selection.has(d.id)}
              aria-label={t("cab.biblio.select", { reference: d.reference ?? d.id })}
              onChange={(e) =>
                setSelection((s) => {
                  const next = new Set(s);
                  if (e.target.checked) next.add(d.id);
                  else next.delete(d.id);
                  return next;
                })
              }
            />
            <ApercuDePiece pieceId={d.id} className="vignette" />
            <Link to="/cabinet/piece/$pieceId" params={{ pieceId: d.id }} className="min-w-0">
              <strong>{d.tiers ?? d.reference ?? nomType(d)}</strong>
              <span>
                {d.reference ? `${d.reference} · ` : ""}
                {nomType(d)} · {dateEnChiffres(d.dateDeClassement, locale)}
              </span>
            </Link>
            <span className="num text-end text-[12px]">
              {d.montant !== null ? (
                `${montant(d.montant, locale)} ${d.devise}`
              ) : (
                <span className="cab-doclib-a-saisir">{t("cab.biblio.aSaisir")}</span>
              )}
            </span>
            <span className="cab-doclib-doc-status">
              {d.statut ? (
                <SignalLight tone={feuDuStatut(d.statut)} label={t(MOT_CABINET[d.statut])} />
              ) : null}
            </span>
            <span className="cab-doclib-arrow inline-flex flex-col gap-2">
              <TelechargerDossierComptable
                cabinetId={cabinetId}
                clientId={client.tenantId}
                nomClient={`${client.name} ${d.tiers ?? d.reference ?? ""}`.trim()}
                pieces={[d.id]}
                libelle={t("cab.biblio.telechargerPiece")}
                compact
              />
              <ImprimerLesPieces
                cabinetId={cabinetId}
                pieces={[d.id]}
                portee="piece"
                nom={`${client.name} ${d.tiers ?? d.reference ?? ""}`.trim()}
                titre={`${client.name} · ${d.tiers ?? d.reference ?? nomType(d)}`}
                libelle={t("cab.biblio.imprimer.piece")}
                compact
              />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{t("cab.biblio.count", { n: pieces.length })}</span>
        <span>{t("cab.biblio.linked")}</span>
      </div>
    </>
  );
}

/**
 * Niveau 1 d'un dossier trop grand pour se restituer d'un coup : les mois et
 * leurs types, comptés en base ; chaque mois s'ouvre et se charge seul.
 */
function LeSommaire({
  mois,
  client,
}: {
  mois: Array<{ mois: string; type: string | null; n: number }>;
  client: ClientSummary;
}) {
  const { t, locale } = useI18n();
  const parMois = new Map<string, number>();
  for (const m of mois) parMois.set(m.mois, (parMois.get(m.mois) ?? 0) + m.n);
  const cartes: ReactNode[] = [];
  let lot: ReactNode[] = [];
  const fermerLeLot = () => {
    if (lot.length)
      cartes.push(
        <ul key={`lot-${cartes.length}`} className="cab-doclib-cartes">
          {lot}
        </ul>,
      );
    lot = [];
  };
  for (const r of rangerLesMois([...parMois.keys()])) {
    if (r.genre === "trou") {
      fermerLeLot();
      cartes.push(
        <p key={`trou-${r.du}`} className="cab-doclib-trou">
          <strong>
            {r.n === 1
              ? nomDuMois(r.du, locale)
              : t("cab.biblio.trou", { du: nomDuMois(r.au, locale), au: nomDuMois(r.du, locale) })}
          </strong>
          <span> · {t("cab.biblio.aucunePiece")}</span>
        </p>,
      );
      continue;
    }
    lot.push(
      <li key={r.mois} className="cab-doclib-carte">
        <div className="min-w-0 flex-1">
          <Link
            to="/cabinet/bibliotheque"
            search={{ client: client.tenantId, mois: r.mois }}
            className="cab-doclib-carte-lien"
          >
            {nomDuMois(r.mois, locale)}
          </Link>
          <span className="text-[12px] text-muted-foreground">
            {t("cab.biblio.pieces", { count: parMois.get(r.mois)! })}
          </span>
        </div>
      </li>,
    );
  }
  fermerLeLot();
  return (
    <>
      <p className="text-[13px] text-muted-foreground">{t("cab.biblio.volumineux")}</p>
      {cartes}
    </>
  );
}
