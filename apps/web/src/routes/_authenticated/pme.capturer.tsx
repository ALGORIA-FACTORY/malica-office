import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import malicaLoin from "@/assets/malica-loin.webp";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant } from "@/lib/lisible";
import { creerDepotHttp } from "@/verticals/malica-office/adapters/http/rpc";
import { office } from "@/verticals/malica-office/composition";
import type { PieceLue } from "@malica/socle/ports/repositories";

/**
 * Capturer — de la photo à la pièce, une question par écran.
 *
 * ============================================================= CE QUE CE N'EST PAS
 *
 * Ce n'est pas un second chemin de capture. Le geste — obturateur, cadrage,
 * question du type, clé d'idempotence une par pièce, file hors ligne — vit
 * dans le layout `pme.tsx` et nulle part ailleurs. Cet écran l'APPELLE par le
 * contexte (`ouvrirScanner`, `capture`, `capturing`, `captureError`) et
 * n'ouvre jamais `capabilities/files` lui-même. Le réimplémenter aurait
 * recréé, à côté, les trois corrections que le layout porte déjà : la clé par
 * pièce (sans quoi neuf factures sur dix disparaissent en doublons), le type
 * demandé AVANT la lecture, et le fichier jamais reperdu si l'on ferme la
 * question.
 *
 * ================================================================== L'ORDRE
 *
 * Il ne se réarrange pas, et une seule raison le gouverne : **une pièce
 * personnelle n'est jamais lue** (B6). La destination se demande donc en 1,
 * avant la lecture. Poser la question après, c'était débiter le quota de la
 * société pour un papier qui ne la regarde pas.
 *
 *   0 · capturer            le contexte (`ouvrirScanner`, `capture`)
 *   1 · la destination      `collab.garderPiece` si c'est pour vous
 *   2 · les lectures        ce qu'on lit, et ce que ça coûte
 *   3 · la lecture          `malica.demanderLaLecture` sur clic explicite
 *   4 · ce que j'ai lu      `capture.listAvecLecture`
 *   5 · les questions       `charges.questions` / `charges.answer`
 *   6 · les dates           `charges.enAttenteDeDate`
 *   7 · le règlement        `referentiel.moyensDePaiement` / `capture.enregistrerPaiement`
 *   8 · la fin              `collab.setPieceVis(id,'partage')`
 *   8bis · la fin, chez vous   rien : non lue, quota intact, invisible
 *
 * ============================================= LE COMPTEUR DE LECTURES
 *
 * « Lire les 6 — 6 lectures sur 23 » : le 23 est `lectures_restantes`, et il
 * vient de `facturation.monForfait`, entré au contrat (vingt-deux dépôts).
 * C'est lui qui donne son sens au geste — sans lui, on déclenche une lecture
 * sans savoir ce qu'elle coûte.
 *
 * Mais il s'écrit en ce moment, et un compteur qui plante empêcherait de
 * capturer : bien pire que de ne pas savoir. D'où `retry: false`, et UNE
 * règle — **valeur absente → « — », jamais « 0 »**. Un tiret dit « je ne sais
 * pas encore » ; un zéro aurait dit « il ne vous en reste plus », ce qui est
 * un fait, et un fait faux.
 *
 * Le plafond, lui, mord dans la base. L'écran le dit quand il le voit venir,
 * et ne barre jamais le bouton : la capture ne s'arrête jamais, même plafond
 * atteint — les pièces s'empilent, non lues.
 *
 * ===================================== LA RANGÉE DES FORFAITS NE SE PORTE PAS
 *
 * `basic · solo · team · premium` est une affordance de maquette : elle sert à
 * montrer les quatre dégradations dans un seul fichier. L'abonnement se voit
 * au compteur de lectures et aux cartes verrouillées, visibles et jamais
 * masquées. Rien ici ne bascule de forfait.
 */
export const Route = createFileRoute("/_authenticated/pme/capturer")({
  head: () => ({
    meta: [
      { title: "Capturer — Malica Office" },
      {
        name: "description",
        content:
          "Photographiez vos pièces, dites à qui elles sont, et faites-les lire quand vous le demandez.",
      },
      { property: "og:title", content: "Capturer — Malica Office" },
      {
        property: "og:description",
        content: "Une question par écran. Rien n'est lu tant que vous ne le demandez pas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PmeCapturer,
});

/** Les neuf étapes du câblage. La dixième case réemploie la neuvième : la fin
 *  privée est une fin, pas une étape de plus. */
const ETAPES = [
  "CAPTURER",
  "DESTINATION",
  "LECTURES",
  "LECTURE",
  "CE QUE J'AI LU",
  "QUESTIONS",
  "DATES",
  "RÈGLEMENT",
  "FAIT",
] as const;

/* Les tracés viennent du dessin, à l'identique : l'écran n'a pas de
 * bibliothèque d'icônes à lui, et `.g` porte déjà le trait. */
const G = {
  back: "M14.5 5.5L8 12l6.5 6.5",
  x: "M6 6l12 12M18 6L6 18",
  gal: "M3.5 5.5h17v13h-17zM8.5 10a1.4 1.4 0 1 0 0-.1M4 16.5l4.5-4 4 3.5 3-2.5 4.5 4",
  cab: "M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6M16.5 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M3.5 19.5a5.5 5.5 0 0 1 11 0M14.5 19.5a4.5 4.5 0 0 1 6.5-3.4",
  bib: "M5 4.5h5v15H5zM12 4.5h3.2l3.8 15H16z",
  prive: "M5 10.5h14v10H5zM8 10.5V7.5a4 4 0 0 1 8 0v3",
  ok: "M4.5 12.5l4.5 4.5 10-10",
  horl: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 7v5.2l3.2 2",
  pay: "M2.5 6.5h19v11h-19zM12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2",
  fat: "M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21zM9.5 9.5l2 2 3.5-3.5M9 15h6",
} as const;

/** Les fausses lignes d'un papier : c'est le dessin, et c'est tout ce que
 *  c'est — aucune vignette réelle n'est rendue ici, les octets ne descendent
 *  pas sur cet écran. */
function lignes(n: number, haut: number, pas: number) {
  return Array.from({ length: n }, (_, i) => (
    <i
      key={i}
      style={{
        top: `${haut + i * pas}%`,
        width: i % 3 === 2 ? "40%" : i % 3 === 1 ? "72%" : "62%",
      }}
    />
  ));
}

function Icone({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="g" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Malica demande. Le portrait est l'image de loin, cadrée par la feuille à
 *  `50% 34%` : `MalicaAvatar` recadre autrement et la coupe au menton. */
/*
 * `s?: string | undefined`, et le `| undefined` n'est pas une redondance.
 *
 * Le dépôt active `exactOptionalPropertyTypes`, qui distingue « la propriété
 * est absente » de « la propriété vaut `undefined` ». Une seconde ligne
 * calculée par un ternaire rend l'un ou l'autre selon l'étape ; sans cette
 * union, TypeScript refuse l'appel et l'on serait tenté de contourner par un
 * `??  ""` — c'est-à-dire d'afficher une ligne vide là où il ne doit y en
 * avoir aucune.
 */
function Dit({ q, s }: { q: string; s?: string | undefined }) {
  return (
    <>
      <div className="sig">
        <span className="ph">
          <img src={malicaLoin} alt="Malica" width={620} height={620} />
        </span>
        <b>Malica</b>
      </div>
      <div className="dit">
        {q}
        {s ? <em>{s}</em> : null}
      </div>
    </>
  );
}

function Opt({
  ic,
  titre,
  sous,
  on,
  vl,
  off,
  onClick,
}: {
  ic: string;
  titre: string;
  sous: string;
  on?: boolean;
  vl?: string;
  off?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={[on ? "on" : "", off ? "off" : ""].filter(Boolean).join(" ")}
      disabled={off}
      onClick={onClick}
    >
      <i>
        <Icone d={ic} />
      </i>
      <span className="bd">
        <b>{titre}</b>
        <span>{sous}</span>
      </span>
      {vl ? <span className="vl">{vl}</span> : null}
    </button>
  );
}

function Fin({ am, children }: { am?: boolean; children: ReactNode }) {
  return (
    <div className={am ? "l am" : "l"}>
      <Icone d={am ? G.horl : G.ok} />
      <span>{children}</span>
    </div>
  );
}

type Destination = "societe" | "entite" | "prive";

/**
 * Le forfait, tel que `mon_forfait_v` le rend.
 *
 * ============================================ POURQUOI IL EST DÉCLARÉ ICI
 *
 * `facturation` est au contrat RPC et son dépôt d'API existe. Ce qui n'existe
 * pas encore, c'est le côté client : ni `FacturationRepository` dans
 * `packages/socle/src/ports/repositories.ts`, ni l'entrée `facturation` dans
 * `OfficeRuntime`. `office().facturation` ne compile donc pas.
 *
 * Cette déclaration est un ÉCHAFAUDAGE, et elle se retire en trois lignes le
 * jour où le port arrive : on supprime `MonForfait`, `DepotFacturation` et
 * `facturation()`, on importe le type du port, et on lit
 * `office().facturation`. Rien d'autre dans ce fichier ne change.
 *
 * Les noms sont COPIÉS du contrat et de `mon_forfait_v` — snake_case, parce
 * que le dépôt relaie la vue telle quelle (R3) et ne renomme rien. Les
 * `numeric` de Postgres arrivent en chaînes : d'où `number | string | null`
 * partout, et `nombre()` pour les lire sans se tromper.
 */
interface MonForfait {
  offre: string;
  statut: string;
  lectures_droit: number | string | null;
  lectures_consommees: number | string | null;
  lectures_restantes: number | string | null;
  organisations: number | string | null;
  sieges_occupes: number | string | null;
  sieges_inclus: number | string | null;
  sieges_max: number | string | null;
  prix_mensuel_ht: string | null;
}

/** `null` quand l'appelant ne détient aucune licence — un collaborateur n'en
 *  détient pas, et la base ne lui en montre aucune. Ce n'est pas une panne. */
interface DepotFacturation {
  monForfait(): Promise<MonForfait | null>;
}

const facturation = () => creerDepotHttp<DepotFacturation>("facturation");

/** Un entier, ou `null`. Jamais `0` par défaut : zéro est un fait, l'absence
 *  n'en est pas un, et les confondre sur un compteur de quota ferait croire à
 *  un plafond atteint. */
function nombre(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function PmeCapturer() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [etape, setEtape] = useState(0);
  const [dest, setDest] = useState<Destination | null>(null);
  /** Les pièces décochées à l'étape 2 : gardées pour soi, non lues. */
  const [exclues, setExclues] = useState<readonly string[]>([]);
  /** La vignette ouverte dans la bande, et son petit menu. */
  const [choisie, setChoisie] = useState<string | null>(null);
  const [question, setQuestion] = useState(0);
  const [moyen, setMoyen] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [paye, setPaye] = useState(false);
  const [transmis, setTransmis] = useState<boolean | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const echoue = (e: unknown) =>
    setErreur(texteDeLErreur(e, "routes/_authenticated/pme.capturer", t("common.error")));

  /*
   * UNE FENÊTRE DE DONNÉES POUR TOUT L'ÉCRAN.
   *
   * `listAvecLecture` rend, pour chaque pièce, ce que la lecture a produit :
   * émetteur, date, type, total. C'est exactement ce que l'étape 4 montre, et
   * ça évite `capture.dossier`, qui descend AUSSI les octets du PDF — six
   * pièces, six fichiers, sur un téléphone d'entrée de gamme, pour quatre
   * lignes de texte.
   */
  const pieces = useQuery({
    queryKey: ["pieces-lues", pme.tenantId],
    queryFn: () => office().capture.listAvecLecture(pme.tenantId),
  });

  /*
   * LE FORFAIT — lu une fois, et il devrait l'être au layout.
   *
   * La règle du câblage est claire : « un écran lit `facturation.monForfait`
   * une fois, au niveau du layout `pme.tsx`, et le passe par contexte. Aucun
   * écran n'appelle deux fois. » Le contexte ne le porte pas encore ; cette
   * requête est donc le second endroit où il faudra le retirer quand il y
   * sera. La clé est volontairement sans dossier : le forfait est celui de la
   * LICENCE, pas d'une société — il ne change pas quand on change de dossier.
   *
   * `retry: false` : une méthode qui n'est pas encore servie ne doit pas
   * occuper le réseau trois fois avant de rendre son silence. Et aucune des
   * branches ci-dessous ne lit `forfait.isError` pour bloquer quoi que ce
   * soit : un compteur muet laisse capturer, un compteur qui barre la route
   * ne laisse rien faire.
   */
  const forfait = useQuery({
    queryKey: ["mon-forfait"],
    queryFn: () => facturation().monForfait(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const restantes = nombre(forfait.data?.lectures_restantes);
  /** Ce qu'on écrit à l'écran : le nombre, ou l'aveu. Jamais zéro par défaut. */
  const resteDit = restantes === null ? "—" : String(restantes);

  /*
   * Le lot : ce qui est capturé et pas encore lu. C'est le seul endroit d'où
   * cet écran peut le tenir — le layout ne dit pas quelles pièces viennent
   * d'entrer (voir la note en bas de fichier).
   *
   * Les pièces déjà gardées pour soi n'en sont pas : la question leur a été
   * posée, et un écran qui redemande ce qu'on vient de lui dire apprend à ne
   * plus répondre.
   */
  const lot = useMemo(
    () => (pieces.data ?? []).filter((p) => p.status === "capturee"),
    [pieces.data],
  );
  const retenues = useMemo(() => lot.filter((p) => !exclues.includes(p.id)), [lot, exclues]);
  const ids = useMemo(() => retenues.map((p) => p.id), [retenues]);

  /** Ce qui attend encore de partir, sur l'appareil. La capture ne s'arrête
   *  jamais, même sans réseau : ces pièces existent avant toute API. */
  const enFile = pme.file.elements;

  /*
   * L'état de la lecture, pour les pièces qu'on a demandées. Une seule
   * requête pour tout le lot, redemandée tant qu'au moins une tourne : le
   * résultat arrive par la liste, pas par la requête qui l'a lancée.
   */
  const lectures = useQuery({
    queryKey: ["lectures-en-cours", pme.tenantId, ids.join(",")],
    enabled: etape === 3 && ids.length > 0,
    queryFn: async () => {
      const etats = await Promise.all(
        ids.map(async (id) => ({ id, ...(await office().malica.etatDeLecture(id)) })),
      );
      return etats;
    },
    refetchInterval: (q) => (q.state.data?.some((e) => e.enCours) ? 3_000 : false),
  });

  const questions = useQuery({
    queryKey: ["charge-questions", pme.tenantId],
    enabled: etape >= 5,
    queryFn: () => office().charges.questions(pme.tenantId),
  });

  const familles = useQuery({
    queryKey: ["charges-familles", pme.packId, locale],
    enabled: etape >= 5 && !!pme.packId,
    queryFn: () => office().charges.familles(pme.packId!, locale),
  });

  const sansDate = useQuery({
    queryKey: ["charges-sans-date", pme.tenantId],
    enabled: etape >= 6,
    queryFn: () => office().charges.enAttenteDeDate(pme.tenantId),
  });

  /*
   * Les moyens de paiement du pack, AU JOUR. Le référentiel est versionné :
   * un moyen retiré hier ne doit pas être proposé aujourd'hui, et un moyen
   * ajouté demain ne doit pas l'être non plus.
   *
   * `exigeJustificatif` est ce qui décide de l'étape « preuve » : les espèces
   * et « pas encore payé » ne laissent rien à rapprocher, donc ne demandent
   * rien. C'est le référentiel qui le dit, pas une liste écrite ici.
   */
  const moyens = useQuery({
    queryKey: ["moyens-de-paiement", pme.packId, locale],
    enabled: etape >= 7 && !!pme.packId,
    queryFn: () =>
      office().referential.moyensDePaiement(
        pme.packId!,
        locale,
        new Date().toISOString().slice(0, 10),
      ),
  });

  const aRepondre = (questions.data ?? []).filter((q) => q.answer === null);
  const courante = aRepondre[question] ?? null;
  const libelleFamille = (code: string) =>
    (familles.data ?? []).find((f) => f.code === code)?.label ?? code;

  const moyenChoisi = (moyens.data ?? []).find((m) => m.code === moyen) ?? null;
  const exigeTalon = moyenChoisi?.exigeJustificatif === true;

  /* ── les gestes ──────────────────────────────────────────────────────── */

  /**
   * « C'est pour vous. »
   *
   * `garderPiece` inscrit la DÉCISION, et c'est pour cela qu'on l'appelle
   * plutôt que de ne rien faire : sans elle, rien ne distinguerait « j'ai
   * décidé de la garder » de « je n'ai pas encore répondu », et la question
   * reviendrait à chaque visite.
   */
  const garder = useMutation({
    mutationFn: async (cibles: readonly string[]) => {
      for (const id of cibles) await office().collab.garderPiece(id);
    },
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    },
    onError: echoue,
  });

  /** La lecture, sur clic explicite. Jamais au dépôt, jamais à la minuterie :
   *  le quota ne se dépense pas tout seul. */
  const lire = useMutation({
    mutationFn: async () => {
      // Les décochées sont gardées d'abord : elles ne doivent pas rester en
      // suspens pendant que les autres se lisent.
      for (const id of exclues) await office().collab.garderPiece(id);
      for (const id of ids) await office().malica.demanderLaLecture(id);
    },
    onSuccess: async () => {
      setErreur(null);
      setEtape(3);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
    },
    onError: echoue,
  });

  const repondre = useMutation({
    mutationFn: async (reponse: "exceptionnel" | "a_verifier") => {
      if (!courante || !pme.packId) throw new Error(t("common.error"));
      return office().charges.answer({
        tenantId: pme.tenantId,
        period: courante.period,
        familleCode: courante.familleCode,
        observed: courante.observed,
        baseline: courante.baseline,
        deviationRatio: courante.deviationRatio,
        thresholdCode: courante.thresholdCode,
        packVersionId: pme.packId,
        answer: reponse,
      });
    },
    onSuccess: async () => {
      setErreur(null);
      await qc.invalidateQueries({ queryKey: ["charge-questions", pme.tenantId] });
    },
    onError: echoue,
  });

  /**
   * Le règlement groupé : une réponse pour tout le lot.
   *
   * C'est le seul gain que la lecture en masse rend possible — un mois
   * d'achats au comptoir est presque toujours d'un seul moyen. Le montant
   * n'est pas passé : le Socle prend celui de la pièce, et un montant retapé
   * est un montant qui se trompe.
   */
  const payer = useMutation({
    mutationFn: async () => {
      if (!pme.packId || !moyen) throw new Error(t("common.error"));
      for (const p of retenues) {
        await office().capture.enregistrerPaiement({
          pieceId: p.id,
          packId: pme.packId,
          moyenCode: moyen,
          devise: p.devise ?? pme.currency,
          reference: reference.trim() === "" ? null : reference.trim(),
        });
      }
    },
    onSuccess: async () => {
      setErreur(null);
      setPaye(true);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
      setEtape(8);
    },
    onError: echoue,
  });

  /** Transmettre, ou garder. Deux boutons de même poids, et la décision se
   *  prend ici — à la fin de la lecture, quand le verdict existe. */
  const terminer = useMutation({
    mutationFn: async (partager: boolean) => {
      for (const p of retenues) {
        if (partager) await office().collab.setPieceVis(p.id, "partage");
        else await office().collab.garderPiece(p.id);
      }
      return partager;
    },
    onSuccess: async (partager) => {
      setErreur(null);
      setTransmis(partager);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
    },
    onError: echoue,
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => office().capture.supprimer(id),
    onSuccess: async () => {
      setErreur(null);
      setChoisie(null);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
    },
    onError: echoue,
  });

  /* ── la navigation ───────────────────────────────────────────────────── */

  /** 8bis : l'espace privé a sa propre fin, et il n'y a rien à lire. */
  const finPrivee = dest === "prive";

  function reculer() {
    if (etape === 0) {
      void navigate({ to: "/pme" });
      return;
    }
    // La fin privée vient de la destination, pas du règlement.
    setEtape(finPrivee && etape === 8 ? 1 : Math.max(0, etape - 1));
  }

  function recommencer() {
    setEtape(0);
    setDest(null);
    setExclues([]);
    setChoisie(null);
    setQuestion(0);
    setMoyen(null);
    setReference("");
    setPaye(false);
    setTransmis(null);
  }

  const pasEncore = (p: PieceLue) => p.emetteur === null;
  const jour = (iso: string | null) =>
    iso === null
      ? null
      : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", timeZone: "UTC" }).format(
          new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
        );

  /* ── l'écran ─────────────────────────────────────────────────────────── */

  return (
    <div data-ecran="capture" className="rg-rise">
      {/*
       * La barre : des traits, pas des chiffres. Un pas sur neuf ne se compte
       * pas, il se voit.
       */}
      <div className="prog">
        <button type="button" className="x" onClick={reculer} aria-label="Revenir">
          <Icone d={etape === 0 ? G.x : G.back} />
        </button>
        <span className="tr" aria-hidden>
          {ETAPES.map((_, i) => (
            <i key={i} className={i < etape ? "on" : ""} />
          ))}
        </span>
        <span className="n">{finPrivee && etape === 8 ? "FAIT · CHEZ VOUS" : ETAPES[etape]}</span>
      </div>

      <div className="pad">
        {(erreur ?? pme.captureError) ? (
          <div className="flag">
            <i />
            <span>{erreur ?? pme.captureError}</span>
          </div>
        ) : null}

        {/* ══════════════════════════════════ 0 · l'appareil : on photographie,
            on ne lit pas. Le geste appartient au layout ; cet écran l'appelle. */}
        {etape === 0 ? (
          <>
            <div className="cam">
              <div className="pap">{lignes(7, 16, 10)}</div>
              <div className="fr">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="hint">
                {pme.capturing
                  ? t("pme.capture.preparation")
                  : lot.length > 0
                    ? `${lot.length} pièce${lot.length > 1 ? "s" : ""} · aucune n'est encore lue`
                    : "Posez la pièce à plat — je redresse et je recadre"}
              </div>
            </div>

            {/* La bande : ce qui est entré, et le petit menu de la vignette
                ouverte. Pas d'image : les octets ne descendent pas ici. */}
            {lot.length > 0 ? (
              <>
                <div className="bande">
                  {lot.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={[
                        "vg",
                        exclues.includes(p.id) ? "pv" : "",
                        choisie === p.id ? "sel" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={p.emetteur ?? "Pièce non lue"}
                      onClick={() => setChoisie(choisie === p.id ? null : p.id)}
                    >
                      <span className="pp">{lignes(4, 22, 16)}</span>
                      {exclues.includes(p.id) ? (
                        <span className="bg">
                          <Icone d={G.prive} />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {choisie ? (
                  <div className="menu">
                    <button
                      type="button"
                      onClick={() =>
                        setExclues((e) =>
                          e.includes(choisie) ? e.filter((x) => x !== choisie) : [...e, choisie],
                        )
                      }
                    >
                      {exclues.includes(choisie) ? "Pour la société" : "Pour vous"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: choisie } })
                      }
                    >
                      Ouvrir
                    </button>
                    <button
                      type="button"
                      className="sup"
                      disabled={supprimer.isPending}
                      onClick={() => supprimer.mutate(choisie)}
                    >
                      Supprimer
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {/* L'obturateur. « Galerie » prend des images, le troisième bouton
                prend des PDF — c'est le rattrapage d'un mois. Le flash du
                dessin n'a pas de geste : la capacité ne l'expose pas. */}
            <div className="shut">
              <button type="button" disabled={pme.capturing} onClick={() => pme.capture("photo")}>
                <Icone d={G.gal} />
                Galerie
              </button>
              <button
                type="button"
                className="big"
                aria-label="Photographier"
                disabled={pme.capturing}
                onClick={pme.ouvrirScanner}
              />
              <button type="button" disabled={pme.capturing} onClick={() => pme.capture("pdf")}>
                <Icone d={G.fat} />
                PDF
              </button>
            </div>

            {lot.length === 0 ? (
              <div className="opt">
                <Opt
                  ic={G.fat}
                  titre="Import El Fatoora"
                  sous="Les factures électroniques entrent lues, sans consommer de lecture"
                  vl="À VENIR"
                  off
                />
              </div>
            ) : null}

            {enFile.length > 0 ? (
              <div className="flag">
                <i />
                <span>
                  {enFile.length} pièce{enFile.length > 1 ? "s" : ""} attend
                  {enFile.length > 1 ? "ent" : ""} le réseau. Elles partiront seules : la photo
                  n'est jamais à refaire.
                </span>
              </div>
            ) : null}

            <p className="foot">
              {lot.length > 0
                ? "Rien n'est lu tant que vous ne le demandez pas : votre quota ne bouge pas d'ici là."
                : "Hors réseau, la photo part dès que le réseau revient — et la panne laisse une trace au journal."}
            </p>

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={lot.length === 0}
                onClick={() => setEtape(1)}
              >
                {lot.length > 0 ? `Répondre (${lot.length})` : "Rien à répondre"}
              </button>
              <button
                type="button"
                className="sc"
                onClick={() => void navigate({ to: "/pme/list" })}
              >
                Plus tard — les garder telles quelles
              </button>
            </div>
          </>
        ) : null}

        {/* ═════════════════════════════════ 1 · LA DESTINATION, AVANT LA LECTURE
            B6 : une pièce personnelle est déposée dans l'espace personnel,
            jamais transmise NI LUE. La poser après, c'était débiter le quota de
            la société pour un papier qui ne la regarde pas. */}
        {etape === 1 ? (
          <>
            <Vignette lot={lot} />
            <Dit
              q={
                lot.length > 1
                  ? `Ces ${lot.length} pièces sont pour la société, ou pour vous ?`
                  : "Elle est pour la société, ou pour vous ?"
              }
              s="Je pose la question maintenant, pas après : une pièce personnelle, je ne la lis pas, et elle ne touche jamais votre quota."
            />

            {/* Le sélecteur de société n'apparaît que s'il y a plusieurs
                dossiers — et il vient du layout, qui les a déjà. */}
            {pme.dossiers.length > 1 && dest !== "prive" ? (
              <div className="ch">
                <span className="t">Société</span>
                {pme.dossiers.map((d) => (
                  <button
                    type="button"
                    key={d.id}
                    className={d.id === pme.tenantId ? "on" : ""}
                    onClick={() => pme.choisirDossier(d.id)}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="opt">
              <Opt
                ic={G.cab}
                titre="La société"
                sous={
                  pme.aUnCabinet
                    ? "Lue, rangée, et transmise au cabinet après vérification"
                    : "Lue et rangée. Aucun cabinet n'est mandaté : rien ne part."
                }
                on={dest === "societe"}
                onClick={() => setDest("societe")}
              />
              {/*
               * « La société, sans transmettre » demande une troisième
               * visibilité, `entite`. `Visibility` n'en porte que deux —
               * `personnel` et `partage`. L'option reste VISIBLE et dit ce
               * qu'elle ferait : un produit qui cache ce qu'il vend ne le vend
               * pas. Elle s'ouvre quand `setPieceVis` acceptera `'entite'`.
               */}
              <Opt
                ic={G.bib}
                titre="La société, sans transmettre"
                sous="Lue et rangée dans la bibliothèque. Elle ne part pas."
                vl="ENTITE"
                off
              />
              <Opt
                ic={G.prive}
                titre="Vous"
                sous="Votre espace privé. Je ne la lis pas, personne d'autre ne la voit."
                on={dest === "prive"}
                onClick={() => setDest("prive")}
              />
            </div>

            {dest === "prive" ? (
              <div className="flag">
                <i />
                <span>
                  Elle est attachée à votre compte, pas à la société — elle vous suivra si vous la
                  quittez.
                </span>
              </div>
            ) : null}

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={dest === null || garder.isPending}
                onClick={() => {
                  if (dest === "prive") {
                    garder.mutate(
                      lot.map((p) => p.id),
                      { onSuccess: () => setEtape(8) },
                    );
                    return;
                  }
                  setEtape(2);
                }}
              >
                {dest === "prive" ? "Les ranger chez vous" : "Continuer"}
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════════ 2 · CE QU'ON LIT, ET LE COMPTE
            Tout est coché : décocher est plus court que cocher, et ce qu'on
            décoche reste chez soi, non lu, sans rien coûter. */}
        {etape === 2 ? (
          <>
            <Dit
              q="Je lis lesquelles ?"
              s="Tout est coché. Décochez ce qui n'est pas à la société — c'est plus court que de cocher une par une, et je ne lirai que ce qui reste."
            />

            {lot.map((p) => {
              const gardee = exclues.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  className={gardee ? "pick pv" : "pick on"}
                  onClick={() =>
                    setExclues((e) => (gardee ? e.filter((x) => x !== p.id) : [...e, p.id]))
                  }
                >
                  <span className="box">
                    <Icone d={G.ok} />
                  </span>
                  <span className="bd">
                    <b>
                      {p.emetteur ?? "Pièce non lue"}
                      {p.total !== null ? ` · ${montant(p.total, locale)}` : ""}
                    </b>
                    <span className={gardee ? "az" : undefined}>
                      {gardee
                        ? "Gardée pour vous — non lue"
                        : (jour(p.dateDocument ?? p.createdAt) ?? "Sans date lue")}
                    </span>
                  </span>
                </button>
              );
            })}

            <p className="foot">
              Les décochées restent dans votre espace privé. Elles ne coûtent rien et ne partiront
              jamais.
            </p>

            {/*
             * CE QUE LE GESTE COÛTE, avant de le faire.
             *
             * `lectures_restantes` quand on l'a, « — » quand on ne l'a pas. Et
             * le bouton n'est jamais barré par le plafond : c'est la base qui
             * refuse la lecture de trop, et une pièce refusée reste là,
             * intacte, non lue. Barrer ici aurait empêché de ranger des pièces
             * qu'on peut parfaitement ranger.
             */}
            {restantes !== null && restantes < retenues.length ? (
              <div className="flag">
                <i />
                <span>
                  Il reste {restantes} lecture{restantes > 1 ? "s" : ""} à votre forfait, pour{" "}
                  {retenues.length} pièces cochées. Les premières seront lues, les autres resteront
                  là — non lues, et rien n'est perdu.
                </span>
              </div>
            ) : null}

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={retenues.length === 0 || lire.isPending}
                onClick={() => lire.mutate()}
              >
                {`Lire les ${retenues.length} — ${retenues.length} lecture${
                  retenues.length > 1 ? "s" : ""
                } sur ${resteDit}`}
              </button>
              <button type="button" className="sc" onClick={() => setEtape(0)}>
                Pas maintenant
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════════════════════ 3 · LA LECTURE
            Demandée, pas automatique. Ce qui s'affiche est l'état réel de
            chaque pièce, redemandé tant qu'une tourne. */}
        {etape === 3 ? (
          <>
            <Dit
              q={`Je lis ${retenues.length === 1 ? "la pièce" : `les ${retenues.length} pièces`}.`}
              s="Je cite la zone d'où je sors chaque chiffre. Ce que je n'ai pas trouvé, je le dis — je ne le devine pas."
            />
            <div className="lect">
              {retenues.map((p) => {
                const etat = (lectures.data ?? []).find((e) => e.id === p.id);
                const faite = !pasEncore(p) || (etat && !etat.enCours);
                return (
                  <div key={p.id} className={faite ? "ok" : ""}>
                    <i />
                    <span>{p.emetteur ?? "Pièce non lue"}</span>
                  </div>
                );
              })}
            </div>
            <p className="foot">
              Une lecture qui échoue laisse une trace au journal et la pièce reste là, intacte.
            </p>
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(4)}>
                Voir ce que j'ai lu
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════════════════ 4 · CE QUE MALICA A LU
            Quatre lignes, et chacune se corrige. Ce qui manque est ambre : une
            valeur absente n'est pas une valeur nulle. */}
        {etape === 4 ? (
          <>
            <Dit
              q="Voici ce que j'ai lu."
              s="Chaque ligne se corrige, et la correction m'apprend le fournisseur. Rien n'est écrasé : une précision s'ajoute, elle ne remplace pas."
            />
            {retenues.map((p) => {
              /* « Corriger » mène au dossier de la pièce, et pas ailleurs :
                 c'est là que `capture.preciser` vit, et une précision s'ajoute
                 — elle n'écrase jamais (R7). */
              const corriger = () =>
                void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } });
              return (
                <div className="lu" key={p.id}>
                  <LigneLue k="Émetteur" v={p.emetteur} onCorriger={corriger} />
                  <LigneLue k="Date" v={jour(p.dateDocument)} onCorriger={corriger} />
                  <LigneLue
                    k="Type"
                    v={p.kind === null ? null : libelleType(p.kind)}
                    onCorriger={corriger}
                  />
                  <LigneLue
                    k="Total"
                    v={
                      p.total === null
                        ? null
                        : `${montant(p.total, locale)} ${p.devise ?? pme.currency}`
                    }
                    mono
                    onCorriger={() =>
                      void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } })
                    }
                  />
                  {p.lectureRefusee ? (
                    <div className="flag">
                      <i />
                      <span>Lecture refusée · {p.lectureRefusee.motif}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(5)}>
                Continuer
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════ 5 · LES QUESTIONS, UNE PAR ÉCRAN
            Le seuil est une politique de l'entreprise, pas une règle lisible :
            la question se pose, elle ne se tranche pas toute seule. */}
        {etape === 5 ? (
          <>
            {courante ? (
              <>
                <Dit
                  q={`${libelleFamille(courante.familleCode)} — ${montant(courante.observed, locale)} ${pme.currency} ce mois-ci.`}
                  s={`La base de comparaison est ${montant(courante.baseline, locale)} ${pme.currency}. C'est exceptionnel, ou il y a quelque chose à vérifier ? Le seuil est une politique de votre entreprise, pas une règle que je peux lire.`}
                />
                <div className="opt">
                  <Opt
                    ic={G.ok}
                    titre="Exceptionnel"
                    sous="C'est normal pour ce mois-là, et je ne le redemanderai pas"
                    onClick={() => repondre.mutate("exceptionnel")}
                    off={repondre.isPending}
                  />
                  <Opt
                    ic={G.horl}
                    titre="À vérifier"
                    sous="Je le garde ouvert, et le cabinet le voit aussi"
                    onClick={() => repondre.mutate("a_verifier")}
                    off={repondre.isPending}
                  />
                </div>
                <p className="foot">
                  Question {question + 1} sur {aRepondre.length}.
                </p>
                <div className="go">
                  <button
                    type="button"
                    className="pr"
                    onClick={() =>
                      question + 1 < aRepondre.length ? setQuestion(question + 1) : setEtape(6)
                    }
                  >
                    Continuer
                  </button>
                  <button type="button" className="sc" onClick={() => setEtape(6)}>
                    Plus tard
                  </button>
                </div>
              </>
            ) : (
              <>
                <Dit
                  q="Aucune question."
                  s={
                    questions.isPending
                      ? "Je regarde."
                      : "Rien ne sort de l'ordinaire sur ce que je viens de lire."
                  }
                />
                <div className="go">
                  <button type="button" className="pr" onClick={() => setEtape(6)}>
                    Continuer
                  </button>
                </div>
              </>
            )}
          </>
        ) : null}

        {/* ══════════════════════════════════════════ 6 · CE QUI ATTEND SA DATE
            Une pièce sans date lue n'entre dans aucun mois — ni celui du scan.
            C'est sa date qui décide de la TVA, et elle ne se choisit pas à la
            place de quelqu'un : le geste est sur le dossier de la pièce. */}
        {etape === 6 ? (
          <>
            <Dit
              q={
                (sansDate.data?.pieces ?? 0) > 0
                  ? `${sansDate.data!.pieces} pièce${sansDate.data!.pieces > 1 ? "s" : ""} attend${
                      sansDate.data!.pieces > 1 ? "ent" : ""
                    } sa date.`
                  : "Tout est daté."
              }
              s={
                (sansDate.data?.pieces ?? 0) > 0
                  ? "Tant qu'elle n'a pas de date, elle n'entre dans aucun mois — pas même celui de la photo. C'est la date de la pièce qui décide de votre TVA, je ne la choisis pas à votre place."
                  : "Chaque pièce que je viens de lire porte sa date, donc son mois, donc sa TVA."
              }
            />
            {(sansDate.data?.totalHt ?? null) !== null ? (
              <div className="flag">
                <i />
                <span>
                  {montant(sansDate.data!.totalHt, locale)} {pme.currency} HT n'entrent dans aucun
                  total du mois tant que ces dates manquent.
                </span>
              </div>
            ) : null}
            {retenues.filter((p) => p.dateDocument === null).length > 0 ? (
              <div className="lu">
                {retenues
                  .filter((p) => p.dateDocument === null)
                  .map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() =>
                        void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } })
                      }
                    >
                      <span className="k">Sans date</span>
                      <span className="v am">{p.emetteur ?? "Pièce non lue"}</span>
                      <span className="ed">Dater</span>
                    </button>
                  ))}
              </div>
            ) : null}
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(7)}>
                Continuer
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════════════════ 7 · LE RÈGLEMENT GROUPÉ
            Une question pour tout le lot : un mois d'achats au comptoir est
            presque toujours d'un seul moyen. C'est le seul gain que la lecture
            en masse rend possible. */}
        {etape === 7 ? (
          <>
            <Dit
              q={
                retenues.length > 1
                  ? `Ces ${retenues.length} pièces ont été payées comment ?`
                  : "Elle a été payée comment ?"
              }
              s="Je pose la question une fois plutôt que six. Si deux ont été payées autrement, chaque pièce se reprend ensuite dans son dossier."
            />
            <div className="opt">
              {(moyens.data ?? []).map((m) => (
                <Opt
                  key={m.code}
                  ic={m.exigeJustificatif ? G.pay : G.ok}
                  titre={m.libelle}
                  sous={
                    m.exigeJustificatif
                      ? "Un talon est attendu — le paiement reste inscrit sans lui"
                      : "Aucune preuve à joindre : rien à rapprocher"
                  }
                  on={moyen === m.code}
                  onClick={() => {
                    setMoyen(m.code);
                    setReference("");
                  }}
                />
              ))}
            </div>

            {/* La référence n'est demandée que si le référentiel l'exige : un
                numéro de chèque se note, une espèce n'en a pas. */}
            {moyenChoisi?.exigeReference === true ? (
              <div className="ch">
                <span className="t">Référence</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  aria-label="Référence du règlement"
                />
              </div>
            ) : null}

            {exigeTalon ? (
              <div className="flag">
                <i />
                <span>
                  Le talon se photographie depuis le dossier de la pièce. Le règlement s'inscrit
                  sans lui : une preuve qui manque ne doit pas empêcher d'enregistrer un fait.
                </span>
              </div>
            ) : null}

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={moyen === null || payer.isPending}
                onClick={() => payer.mutate()}
              >
                Inscrire le règlement
              </button>
              <button type="button" className="sc" onClick={() => setEtape(8)}>
                Pas encore payé — plus tard
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════════════════════════ 8 · LA FIN
            Deux boutons de même poids. La transmission est une DÉCISION, prise
            ici, quand le verdict de la lecture existe — et pas à la photo. */}
        {etape === 8 && !finPrivee ? (
          <>
            <Dit
              q={transmis === null ? "Tout est lu. Vous en faites quoi ?" : "C'est rangé."}
              s={
                transmis === null
                  ? "Transmettre range la pièce dans la TVA du mois où elle part, pas du mois où elle est datée. Garder ne ferme rien : vous transmettrez quand vous voudrez."
                  : restantes === null
                    ? undefined
                    : `Il vous reste ${restantes} lecture${restantes > 1 ? "s" : ""} ce mois.`
              }
            />
            <div className="fin">
              <Fin>
                {retenues.length} pièce{retenues.length > 1 ? "s" : ""} <b>lue</b>
                {retenues.length > 1 ? "s" : ""}
                {exclues.length > 0
                  ? ` · ${exclues.length} gardée${exclues.length > 1 ? "s" : ""} pour vous`
                  : ""}
              </Fin>
              {paye && moyenChoisi ? (
                <Fin>
                  Payée{retenues.length > 1 ? "s" : ""} par{" "}
                  <b>{moyenChoisi.libelle.toLowerCase()}</b>
                  {exigeTalon ? " — talon attendu" : ""}
                </Fin>
              ) : (
                <Fin am>
                  Moyen de paiement <b>à dire</b> — chaque pièce le garde ouvert
                </Fin>
              )}
              {aRepondre.length > 0 ? (
                <Fin am>
                  {aRepondre.length} question{aRepondre.length > 1 ? "s" : ""} encore ouverte
                  {aRepondre.length > 1 ? "s" : ""}
                </Fin>
              ) : (
                <Fin>Aucune question en suspens</Fin>
              )}
              {transmis === true ? (
                <Fin>
                  Transmise{retenues.length > 1 ? "s" : ""} au cabinet — la date de transmission
                  range la TVA
                </Fin>
              ) : transmis === false ? (
                <Fin>Gardée{retenues.length > 1 ? "s" : ""} — rien n'est parti</Fin>
              ) : null}
            </div>

            <p className="foot">
              Tant que vous ne transmettez pas, vous ne me demandez rien : vous corrigez, vous
              supprimez, vous recommencez. Après, c'est le cabinet qui garde — alors la suppression
              devient une demande, et sa réponse s'inscrit.
            </p>

            <div className="go">
              {transmis === null ? (
                <>
                  <button
                    type="button"
                    className="pr"
                    disabled={!pme.aUnCabinet || terminer.isPending}
                    onClick={() => terminer.mutate(true)}
                  >
                    {pme.aUnCabinet ? "Transmettre au cabinet" : "Aucun cabinet mandaté"}
                  </button>
                  <button
                    type="button"
                    className="sc"
                    disabled={terminer.isPending}
                    onClick={() => terminer.mutate(false)}
                  >
                    Garder — ne pas transmettre
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="pr" onClick={recommencer}>
                    Capturer la suivante
                  </button>
                  <button
                    type="button"
                    className="sc"
                    onClick={() => void navigate({ to: "/pme/list" })}
                  >
                    Voir mes pièces
                  </button>
                </>
              )}
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════════════ 8bis · LA FIN, CHEZ VOUS
            Rien n'a été appelé, et c'est le propos : non lue, quota intact,
            invisible. Il n'y a pas de « fin » à écrire, il y a une promesse à
            tenir. */}
        {etape === 8 && finPrivee ? (
          <>
            <Dit
              q="C'est rangé chez vous."
              s="Je ne les ai pas lues, elles n'ont rien coûté à votre quota, et rien ne les fera sortir d'ici sans votre geste."
            />
            <div className="fin">
              <Fin>
                Dans votre <b>espace privé</b> · attaché à votre compte
              </Fin>
              <Fin>
                <b>Non lue{lot.length > 1 ? "s" : ""}</b> —{" "}
                {restantes === null
                  ? "vos lectures du mois sont intactes"
                  : `vos ${restantes} lectures du mois sont intactes`}
              </Fin>
              <Fin>Invisible pour votre cabinet, vos sièges et la vue consolidée</Fin>
            </div>
            <div className="opt">
              <Opt
                ic={G.cab}
                titre="La verser à la société"
                sous="Elle sera lue et comptera dans le quota — depuis votre espace privé, quand vous voudrez"
                onClick={() => void navigate({ to: "/pme/coffre" })}
              />
            </div>
            <p className="foot">
              Ici, personne ne l'a reçue : vous n'avez d'accord à demander à personne. La
              suppression se fait depuis votre espace privé.
            </p>
            <div className="go">
              <button type="button" className="pr" onClick={recommencer}>
                Capturer la suivante
              </button>
              <button
                type="button"
                className="sc"
                onClick={() => void navigate({ to: "/pme/coffre" })}
              >
                Voir mes papiers
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** L'en-tête de la pièce, ou du lot : qui, et combien de pages. */
function Vignette({ lot }: { lot: readonly PieceLue[] }) {
  const premiere = lot[0] ?? null;
  return (
    <div className="vig">
      <span className="pg">
        <b />
        {lignes(6, 30, 11)}
      </span>
      <span className="bd">
        <b>{premiere?.emetteur ?? "Pièce non lue"}</b>
        <span>
          {lot.length} pièce{lot.length > 1 ? "s" : ""} · aucune n'est encore lue
        </span>
      </span>
    </div>
  );
}

/**
 * Une ligne de ce que Malica a lu.
 *
 * Trois états, et non deux : la valeur, le vide, et l'absence. `null` est
 * ambre et se dit « je n'ai pas lu » — pas « 0 ». Confondre les deux sur une
 * pièce comptable est la pire chose que cet écran puisse faire.
 */
function LigneLue({
  k,
  v,
  mono,
  onCorriger,
}: {
  k: string;
  v: string | null;
  mono?: boolean;
  onCorriger?: () => void;
}) {
  return (
    <button type="button" onClick={onCorriger}>
      <span className="k">{k}</span>
      <span className={["v", mono ? "mono" : "", v === null ? "am" : ""].filter(Boolean).join(" ")}>
        {v ?? "je n'ai pas lu"}
      </span>
      <span className="ed">Corriger</span>
    </button>
  );
}

/** Les deux seuls types que la lecture rend aujourd'hui. Le référentiel en
 *  porte douze, et `referentiel.typesDeDocument` les nomme ; `PieceLue.kind`,
 *  lui, n'en porte que deux. On n'affiche donc que ce qu'on reçoit. */
function libelleType(kind: "facture_achat" | "facture_vente") {
  return kind === "facture_achat" ? "Facture d'achat" : "Facture de vente";
}
