import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import malicaLoin from "@/assets/malica-loin.webp";
import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { libelleDuRefus } from "@/lib/champ-lisible";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre } from "@/lib/forfait";
import { montant } from "@/lib/lisible";
import { identifiantsDuLot, lireLotDeCapture, type LotDeCapture } from "@/lib/lot-de-capture";
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
  validateSearch: (search: Record<string, unknown>): LotDeCapture => lireLotDeCapture(search),
  component: PmeCapturer,
});

/** Les neuf étapes du câblage. La dixième case réemploie la neuvième : la fin
 *  privée est une fin, pas une étape de plus. Des CLÉS, pas des mots : la
 *  barre se lit dans les trois langues. */
const ETAPES = [
  "pme.capture.etape.capturer",
  "pme.capture.etape.destination",
  "pme.capture.etape.lectures",
  "pme.capture.etape.lecture",
  "pme.capture.etape.lu",
  "pme.capture.etape.questions",
  "pme.capture.etape.dates",
  "pme.capture.etape.reglement",
  "pme.capture.etape.fait",
] as const satisfies readonly MessageKey[];

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

/**
 * Deux destinations, et pas trois.
 *
 * `entite` n'en est pas une : c'est le LIEU où « La société » met la pièce
 * pour qu'elle soit lisible (voir la mutation `lire`). Ce qui se décide
 * ensuite — transmettre ou garder — se décide à l'étape 8, quand le verdict
 * de la lecture existe.
 */
type Destination = "societe" | "prive";

/**
 * ===================================== L'ÉCHAFAUDAGE DU FORFAIT EST PARTI
 *
 * Trente lignes vivaient ici : l'interface `MonForfait`, un
 * `DepotFacturation` local, un `creerDepotHttp("facturation")` à côté du point
 * de composition, et `nombre()`. Les réglages et l'accueil en avaient chacun
 * leur copie — trois interfaces pour une donnée, deux clés de cache, deux
 * règles de dégradation qui ne jugeaient pas le même fait.
 *
 * Le port existe maintenant (`FacturationRepository`), il est monté dans
 * `composition.ts` — donc couvert par le test qui confronte les ports au
 * contrat — et le layout le lit UNE fois. Cet écran le reçoit par le
 * contexte, comme la règle du câblage le demande depuis le début.
 */

function PmeCapturer() {
  const { t, locale } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const lotDemande = Route.useSearch();

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
   * LE FORFAIT — lu par le layout, reçu par le contexte.
   *
   * La règle du câblage est tenue : « un écran lit `facturation.monForfait`
   * une fois, au niveau du layout `pme.tsx`, et le passe par contexte. Aucun
   * écran n'appelle deux fois. »
   *
   * Et aucune branche de cet écran ne lit `illisible` pour bloquer quoi que
   * ce soit : un compteur muet laisse capturer, un compteur qui barre la
   * route ne laisse rien faire.
   */
  const restantes = nombre(pme.forfait.ligne?.lectures_restantes);
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
  /*
   * ================================= CELLES DE CE PASSAGE, SINON CELLES QUI TRAÎNENT
   *
   * L'obturateur passe les identifiants qu'il vient d'obtenir : on répond
   * alors pour la photo qu'on vient de prendre, et pour elle seule. Sans
   * eux — on ouvre l'écran pour reprendre ce qui traîne — le lot est tout ce
   * que le dossier n'a pas lu.
   *
   * Sans ce filtre, une seule photo prise sur le dossier d'atelier demandait
   * la destination de trente et une pièces d'un coup.
   */
  const duPassage = useMemo(() => identifiantsDuLot(lotDemande.pieces), [lotDemande.pieces]);
  const candidats = useMemo(() => {
    const nonLues = (pieces.data ?? []).filter((p) => p.status === "capturee");
    // Les pièces demandées peuvent n'être pas encore visibles de la liste (la
    // requête est antérieure au dépôt) : on ne retombe alors pas sur tout le
    // dossier, on attend. Un écran qui élargit tout seul la question est pire
    // qu'un écran qui patiente.
    return duPassage.length === 0 ? nonLues : nonLues.filter((p) => duPassage.includes(p.id));
  }, [pieces.data, duPassage]);

  /*
   * ================================== LE LOT SE FIGE QUAND ON RÉPOND POUR LUI
   *
   * Il se déduisait de `status === "capturee"` à chaque rendu. Or la lecture
   * fait passer la pièce à `lue` : à l'étape 3, le lot se vidait au fur et à
   * mesure que les lectures aboutissaient, et les étapes 4 à 8 — ce que j'ai
   * lu, les dates, le règlement, la transmission — n'avaient plus une seule
   * ligne à montrer. Le défaut ne s'était jamais vu parce qu'aucune pièce
   * n'était jamais lue.
   *
   * Dès qu'on quitte l'étape 0, le lot est donc une LISTE D'IDENTIFIANTS, et
   * elle ne bouge plus jusqu'à « la suivante ».
   */
  const [fige, setFige] = useState<readonly string[] | null>(null);
  const lot = useMemo(() => {
    if (fige === null) return candidats;
    const parId = new Map((pieces.data ?? []).map((p) => [p.id, p]));
    return fige.flatMap((id) => {
      const p = parId.get(id);
      return p ? [p] : [];
    });
  }, [fige, candidats, pieces.data]);

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

  /**
   * La lecture, sur clic explicite. Jamais au dépôt, jamais à la minuterie :
   * le quota ne se dépense pas tout seul.
   *
   * ============================= ET LA PIÈCE ENTRE DANS LA SOCIÉTÉ D'ABORD
   *
   * Une pièce naît `personnel` — c'est la décision du 7 octobre, et elle est
   * juste : rien ne part avant d'être connu. Mais `public.lecture_autorisee`
   * refuse toute pièce `personnel` (B6) : demander la lecture sans avoir
   * déplacé la pièce, c'était demander un refus. Mesuré le 18 octobre :
   * trente pièces, zéro lue, trente refus au journal.
   *
   * La destination répondue à l'étape 1 s'INSCRIT donc ici, avant la
   * lecture : `entite`, la bibliothèque de la société — lue, rangée, PAS
   * transmise. La transmission reste une décision de l'étape 8, quand le
   * verdict de la lecture existe.
   *
   * Les décochées, elles, ne bougent pas : elles restent `personnel`, non
   * lues, et ne coûtent rien. `garderPiece` inscrit la décision sans toucher
   * à la visibilité.
   */
  const lire = useMutation({
    mutationFn: async () => {
      // Les décochées sont gardées d'abord : elles ne doivent pas rester en
      // suspens pendant que les autres se lisent.
      for (const id of exclues) await office().collab.garderPiece(id);
      for (const id of ids) {
        await office().collab.setPieceVis(id, "entite");
        await office().malica.demanderLaLecture(id);
      }
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
    setFige(null);
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
        <button type="button" className="x" onClick={reculer} aria-label={t("pme.capture.revenir")}>
          <Icone d={etape === 0 ? G.x : G.back} />
        </button>
        <span className="tr" aria-hidden>
          {ETAPES.map((cle, i) => (
            <i key={cle} className={i < etape ? "on" : ""} />
          ))}
        </span>
        <span className="n">
          {finPrivee && etape === 8
            ? t("pme.capture.etape.faitPrive")
            : t(ETAPES[etape] ?? "pme.capture.etape.capturer")}
        </span>
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
                    ? t("pme.capture.lot.nonLues", { count: lot.length })
                    : t("pme.capture.poser")}
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
                      aria-label={p.emetteur ?? t("pme.capture.pieceNonLue")}
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
                      {exclues.includes(choisie)
                        ? t("pme.capture.menu.societe")
                        : t("pme.capture.menu.vous")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: choisie } })
                      }
                    >
                      {t("pme.capture.menu.ouvrir")}
                    </button>
                    <button
                      type="button"
                      className="sup"
                      disabled={supprimer.isPending}
                      onClick={() => supprimer.mutate(choisie)}
                    >
                      {t("pme.capture.menu.supprimer")}
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
                {t("pme.capture.galerie")}
              </button>
              <button
                type="button"
                className="big"
                aria-label={t("pme.capture.photo")}
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
                  titre={t("pme.capture.fatoora")}
                  sous={t("pme.capture.fatoora.sous")}
                  vl={t("pme.capture.aVenir")}
                  off
                />
              </div>
            ) : null}

            {enFile.length > 0 ? (
              <div className="flag">
                <i />
                <span>{t("pme.capture.file.attente", { count: enFile.length })}</span>
              </div>
            ) : null}

            <p className="foot">
              {lot.length > 0 ? t("pme.capture.foot.lot") : t("pme.capture.foot.horsReseau")}
            </p>

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={lot.length === 0}
                onClick={() => {
                  setFige(lot.map((p) => p.id));
                  setEtape(1);
                }}
              >
                {lot.length > 0
                  ? t("pme.capture.repondre", { count: lot.length })
                  : t("pme.capture.rienARepondre")}
              </button>
              <button
                type="button"
                className="sc"
                onClick={() => void navigate({ to: "/pme/list" })}
              >
                {t("pme.capture.plusTard")}
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
            <Dit q={t("pme.capture.dest.q", { count: lot.length })} s={t("pme.capture.dest.s")} />

            {/* Le sélecteur de société n'apparaît que s'il y a plusieurs
                dossiers — et il vient du layout, qui les a déjà. */}
            {pme.dossiers.length > 1 && dest !== "prive" ? (
              <div className="ch">
                <span className="t">{t("pme.capture.dest.societeLabel")}</span>
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
                titre={t("pme.capture.dest.societe")}
                sous={
                  pme.aUnCabinet
                    ? t("pme.capture.dest.societe.cabinet")
                    : t("pme.capture.dest.societe.sansCabinet")
                }
                on={dest === "societe"}
                onClick={() => setDest("societe")}
              />
              {/*
               * ============================ L'OPTION « À VENIR » A DISPARU, ET C'EST UNE FIN
               *
               * Une troisième option vivait ici, désactivée, étiquetée
               * « À VENIR » : « La société, sans transmettre ». Elle attendait
               * que `Visibility` accepte `entite`.
               *
               * `entite` est accepté depuis aujourd'hui — et c'est désormais ce
               * que « La société » FAIT : la pièce entre dans la bibliothèque
               * de la société, lue et rangée, et elle n'est transmise que si on
               * le dit à l'étape 8, en deux boutons de même poids. L'option
               * décrivait donc exactement « La société » suivie de « Garder ».
               *
               * Un placeholder qui promet ce que l'écran d'à côté fait déjà est
               * un doublon qui s'annonce comme un manque. R9 l'interdit, et il
               * ne se remplace par rien.
               */}
              <Opt
                ic={G.prive}
                titre={t("pme.capture.dest.prive")}
                sous={t("pme.capture.dest.prive.sous")}
                on={dest === "prive"}
                onClick={() => setDest("prive")}
              />
            </div>

            {dest === "prive" ? (
              <div className="flag">
                <i />
                <span>{t("pme.capture.dest.prive.flag")}</span>
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
                {dest === "prive" ? t("pme.capture.dest.ranger") : t("pme.capture.continuer")}
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════════ 2 · CE QU'ON LIT, ET LE COMPTE
            Tout est coché : décocher est plus court que cocher, et ce qu'on
            décoche reste chez soi, non lu, sans rien coûter. */}
        {etape === 2 ? (
          <>
            <Dit q={t("pme.capture.choix.q")} s={t("pme.capture.choix.s")} />

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
                      {p.emetteur ?? t("pme.capture.pieceNonLue")}
                      {p.total !== null ? ` · ${montant(p.total, locale)}` : ""}
                    </b>
                    <span className={gardee ? "az" : undefined}>
                      {gardee
                        ? t("pme.capture.choix.gardee")
                        : (jour(p.dateDocument ?? p.createdAt) ?? t("pme.capture.choix.sansDate"))}
                    </span>
                  </span>
                </button>
              );
            })}

            <p className="foot">{t("pme.capture.choix.foot")}</p>

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
                  {t("pme.capture.choix.plafond", {
                    count: restantes,
                    cochees: retenues.length,
                  })}
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
                {t("pme.capture.choix.lire", { count: retenues.length, reste: resteDit })}
              </button>
              <button type="button" className="sc" onClick={() => setEtape(0)}>
                {t("pme.capture.pasMaintenant")}
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
              q={t("pme.capture.lire.q", { count: retenues.length })}
              s={t("pme.capture.lire.s")}
            />
            <div className="lect">
              {retenues.map((p) => {
                const etat = (lectures.data ?? []).find((e) => e.id === p.id);
                const faite = !pasEncore(p) || (etat && !etat.enCours);
                return (
                  <div key={p.id} className={faite ? "ok" : ""}>
                    <i />
                    <span>{p.emetteur ?? t("pme.capture.pieceNonLue")}</span>
                  </div>
                );
              })}
            </div>
            <p className="foot">{t("pme.capture.lire.foot")}</p>
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(4)}>
                {t("pme.capture.lire.voir")}
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════════════════ 4 · CE QUE MALICA A LU
            Quatre lignes, et chacune se corrige. Ce qui manque est ambre : une
            valeur absente n'est pas une valeur nulle. */}
        {etape === 4 ? (
          <>
            <Dit q={t("pme.capture.lu.q")} s={t("pme.capture.lu.s")} />
            {retenues.map((p) => {
              /* « Corriger » mène au dossier de la pièce, et pas ailleurs :
                 c'est là que `capture.preciser` vit, et une précision s'ajoute
                 — elle n'écrase jamais (R7). */
              const corriger = () =>
                void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } });
              return (
                <div className="lu" key={p.id}>
                  <LigneLue k={t("pme.extract.issuer")} v={p.emetteur} onCorriger={corriger} />
                  <LigneLue
                    k={t("pme.extract.date")}
                    v={jour(p.dateDocument)}
                    onCorriger={corriger}
                  />
                  <LigneLue
                    k={t("pme.capture.lu.type")}
                    v={p.kind === null ? null : t(CLE_DU_TYPE[p.kind])}
                    onCorriger={corriger}
                  />
                  <LigneLue
                    k={t("pme.capture.lu.total")}
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
                  {/*
                   * ============================ LE MOTIF PASSE PAR SON TRADUCTEUR
                   *
                   * `lectureRefusee.motif` est un CODE de la base —
                   * « plafond_atteint », « licence_suspendue ». Il s'affichait
                   * ici tel quel, alors que `libelleDuRefus` existe, est testé
                   * et sert déjà aux écrans de la bibliothèque et du coffre.
                   * C'est le défaut « ISSUER » sous un autre nom, et R4
                   * l'interdit.
                   */}
                  {p.lectureRefusee ? (
                    <div className="flag">
                      <i />
                      <span>
                        {t("pme.capture.lu.refus", {
                          motif: libelleDuRefus(p.lectureRefusee.motif, t),
                        })}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(5)}>
                {t("pme.capture.continuer")}
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
                  q={t("pme.capture.q.q", {
                    famille: libelleFamille(courante.familleCode),
                    montant: montant(courante.observed, locale),
                    devise: pme.currency,
                  })}
                  s={t("pme.capture.q.s", {
                    base: montant(courante.baseline, locale),
                    devise: pme.currency,
                  })}
                />
                <div className="opt">
                  <Opt
                    ic={G.ok}
                    titre={t("pme.capture.q.exceptionnel")}
                    sous={t("pme.capture.q.exceptionnel.sous")}
                    onClick={() => repondre.mutate("exceptionnel")}
                    off={repondre.isPending}
                  />
                  <Opt
                    ic={G.horl}
                    titre={t("pme.capture.q.aVerifier")}
                    sous={t("pme.capture.q.aVerifier.sous")}
                    onClick={() => repondre.mutate("a_verifier")}
                    off={repondre.isPending}
                  />
                </div>
                <p className="foot">
                  {t("pme.capture.q.position", { n: question + 1, total: aRepondre.length })}
                </p>
                <div className="go">
                  <button
                    type="button"
                    className="pr"
                    onClick={() =>
                      question + 1 < aRepondre.length ? setQuestion(question + 1) : setEtape(6)
                    }
                  >
                    {t("pme.capture.continuer")}
                  </button>
                  <button type="button" className="sc" onClick={() => setEtape(6)}>
                    {t("pme.capture.plusTardCourt")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <Dit
                  q={t("pme.capture.q.aucune")}
                  s={
                    questions.isPending
                      ? t("pme.capture.q.jeRegarde")
                      : t("pme.capture.q.rienDAnormal")
                  }
                />
                <div className="go">
                  <button type="button" className="pr" onClick={() => setEtape(6)}>
                    {t("pme.capture.continuer")}
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
                  ? t("pme.capture.dates.q", { count: sansDate.data!.pieces })
                  : t("pme.capture.dates.q.toutes")
              }
              s={
                (sansDate.data?.pieces ?? 0) > 0
                  ? t("pme.capture.dates.s")
                  : t("pme.capture.dates.s.ok")
              }
            />
            {(sansDate.data?.totalHt ?? null) !== null ? (
              <div className="flag">
                <i />
                <span>
                  {t("pme.capture.dates.flag", {
                    montant: montant(sansDate.data!.totalHt, locale),
                    devise: pme.currency,
                  })}
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
                      <span className="k">{t("pme.capture.dates.sansDate")}</span>
                      <span className="v am">{p.emetteur ?? t("pme.capture.pieceNonLue")}</span>
                      <span className="ed">{t("pme.capture.dates.dater")}</span>
                    </button>
                  ))}
              </div>
            ) : null}
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(7)}>
                {t("pme.capture.continuer")}
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
              q={t("pme.capture.pay.q", { count: retenues.length })}
              s={t("pme.capture.pay.s")}
            />
            <div className="opt">
              {(moyens.data ?? []).map((m) => (
                <Opt
                  key={m.code}
                  ic={m.exigeJustificatif ? G.pay : G.ok}
                  titre={m.libelle}
                  sous={
                    m.exigeJustificatif
                      ? t("pme.capture.pay.talon")
                      : t("pme.capture.pay.sansPreuve")
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
                <span className="t">{t("pme.capture.pay.referenceLabel")}</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  aria-label={t("pme.capture.pay.reference.aria")}
                />
              </div>
            ) : null}

            {exigeTalon ? (
              <div className="flag">
                <i />
                <span>{t("pme.capture.pay.talon.flag")}</span>
              </div>
            ) : null}

            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={moyen === null || payer.isPending}
                onClick={() => payer.mutate()}
              >
                {t("pme.capture.pay.inscrire")}
              </button>
              <button type="button" className="sc" onClick={() => setEtape(8)}>
                {t("pme.capture.pay.plusTard")}
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
              q={transmis === null ? t("pme.capture.fin.q") : t("pme.capture.fin.q.range")}
              s={
                transmis === null
                  ? t("pme.capture.fin.s")
                  : restantes === null
                    ? undefined
                    : t("pme.capture.fin.reste", { count: restantes })
              }
            />
            {/*
             * ===================================== LE GRAS PORTE LA PHRASE, PAS UN SUFFIXE
             *
             * Ces lignes se composaient par concaténation : « pièce » + « s »,
             * un `<b>` autour d'un fragment de mot, un morceau ajouté après la
             * phrase. Aucune des trois ne survit à une autre langue — l'arabe
             * n'accorde pas par un « s », et un fragment inséré au milieu
             * d'une phrase atterrit ailleurs quand l'ordre des mots change ou
             * quand on écrit de droite à gauche.
             *
             * Chaque ligne est donc UNE phrase, accordée par `count`, et le
             * gras porte la phrase entière quand il y en a.
             */}
            <div className="fin">
              <Fin>
                <b>{t("pme.capture.fin.lues", { count: retenues.length })}</b>
                {exclues.length > 0
                  ? ` · ${t("pme.capture.fin.gardees", { count: exclues.length })}`
                  : ""}
              </Fin>
              {paye && moyenChoisi ? (
                <Fin>
                  {exigeTalon
                    ? t("pme.capture.fin.reglePar.talon", { moyen: moyenChoisi.libelle })
                    : t("pme.capture.fin.reglePar", { moyen: moyenChoisi.libelle })}
                </Fin>
              ) : (
                <Fin am>{t("pme.capture.fin.moyenADire")}</Fin>
              )}
              {aRepondre.length > 0 ? (
                <Fin am>{t("pme.capture.fin.questions", { count: aRepondre.length })}</Fin>
              ) : (
                <Fin>{t("pme.capture.fin.questions.aucune")}</Fin>
              )}
              {transmis === true ? (
                <Fin>{t("pme.capture.fin.transmises", { count: retenues.length })}</Fin>
              ) : transmis === false ? (
                <Fin>{t("pme.capture.fin.conservees", { count: retenues.length })}</Fin>
              ) : null}
            </div>

            <p className="foot">{t("pme.capture.fin.foot")}</p>

            <div className="go">
              {transmis === null ? (
                <>
                  <button
                    type="button"
                    className="pr"
                    disabled={!pme.aUnCabinet || terminer.isPending}
                    onClick={() => terminer.mutate(true)}
                  >
                    {pme.aUnCabinet
                      ? t("pme.capture.fin.transmettre")
                      : t("pme.capture.fin.sansCabinet")}
                  </button>
                  <button
                    type="button"
                    className="sc"
                    disabled={terminer.isPending}
                    onClick={() => terminer.mutate(false)}
                  >
                    {t("pme.capture.fin.garder")}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="pr" onClick={recommencer}>
                    {t("pme.capture.fin.suivante")}
                  </button>
                  <button
                    type="button"
                    className="sc"
                    onClick={() => void navigate({ to: "/pme/list" })}
                  >
                    {t("pme.capture.fin.voirPieces")}
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
            <Dit q={t("pme.capture.prive.q")} s={t("pme.capture.prive.s")} />
            <div className="fin">
              <Fin>{t("pme.capture.prive.espace")}</Fin>
              <Fin>
                <b>
                  {restantes === null
                    ? t("pme.capture.prive.intactes", { count: lot.length })
                    : t("pme.capture.prive.intactes.reste", {
                        count: lot.length,
                        reste: restantes,
                      })}
                </b>
              </Fin>
              <Fin>{t("pme.capture.prive.invisible")}</Fin>
            </div>
            <div className="opt">
              <Opt
                ic={G.cab}
                titre={t("pme.capture.prive.verser")}
                sous={t("pme.capture.prive.verser.sous")}
                onClick={() => void navigate({ to: "/pme/coffre" })}
              />
            </div>
            <p className="foot">{t("pme.capture.prive.foot")}</p>
            <div className="go">
              <button type="button" className="pr" onClick={recommencer}>
                {t("pme.capture.fin.suivante")}
              </button>
              <button
                type="button"
                className="sc"
                onClick={() => void navigate({ to: "/pme/coffre" })}
              >
                {t("pme.capture.prive.voirPapiers")}
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
  const { t } = useI18n();
  const premiere = lot[0] ?? null;
  return (
    <div className="vig">
      <span className="pg">
        <b />
        {lignes(6, 30, 11)}
      </span>
      <span className="bd">
        <b>{premiere?.emetteur ?? t("pme.capture.pieceNonLue")}</b>
        <span>{t("pme.capture.lot.nonLues", { count: lot.length })}</span>
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
  const { t } = useI18n();
  return (
    <button type="button" onClick={onCorriger}>
      <span className="k">{k}</span>
      <span className={["v", mono ? "mono" : "", v === null ? "am" : ""].filter(Boolean).join(" ")}>
        {v ?? t("pme.capture.lu.nonLu")}
      </span>
      <span className="ed">{t("pme.capture.lu.corriger")}</span>
    </button>
  );
}

/** Les deux seuls types que la lecture rend aujourd'hui. Le référentiel en
 *  porte douze, et `referentiel.typesDeDocument` les nomme ; `PieceLue.kind`,
 *  lui, n'en porte que deux. On n'affiche donc que ce qu'on reçoit — et par
 *  une clé, jamais par le code de la base. */
const CLE_DU_TYPE: Record<"facture_achat" | "facture_vente", MessageKey> = {
  facture_achat: "pme.capture.type.achat",
  facture_vente: "pme.capture.type.vente",
};
