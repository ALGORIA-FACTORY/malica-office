import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import portraitMalica from "@/assets/malica.webp";
import { Aide } from "@/components/malica/aide";
import { ApercuDePiece } from "@/components/malica/apercu-de-piece";
import { usePme } from "@/components/malica/pme-context";
import { useI18n, type MessageKey } from "@/i18n";
import { libelleDuRefus } from "@/lib/champ-lisible";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { nombre } from "@/lib/forfait";
import { montant } from "@/lib/lisible";
import { identifiantsDuLot, lireLotDeCapture, type LotDeCapture } from "@/lib/lot-de-capture";
import { office } from "@/verticals/malica-office/composition";
import type { EtatDUnTravail, PieceLue } from "@malica/socle/ports/repositories";

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

/**
 * Le mot de chaque état de la file durable de lecture.
 *
 * Il est écrit à côté de la pastille, et pas porté par elle : aucune
 * information ne se dit par la seule couleur. Et chaque mot dit la vérité sur
 * le fait qu'il surmonte — « pas lue » n'est pas « en attente ».
 */
const MOT_DU_TRAVAIL: Record<EtatDUnTravail, MessageKey> = {
  a_faire: "pme.capture.travail.a_faire",
  en_cours: "pme.capture.travail.en_cours",
  abandonne: "pme.capture.travail.abandonne",
  en_panne: "pme.capture.travail.en_panne",
  epuise: "pme.capture.travail.epuise",
  termine: "pme.capture.travail.termine",
  refuse: "pme.capture.travail.refuse",
  en_erreur: "pme.capture.travail.en_erreur",
};

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
          <img src={portraitMalica} alt="Malica" width={620} height={620} />
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
  /**
   * Le numéro du travail DURABLE de chaque pièce qu'on a fait lire.
   *
   * Sans lui, « où en est cette lecture ? » se demande à la mémoire du
   * processus, qui répond « plus rien ne tourne » aussi bien pour une lecture
   * terminée que pour une lecture morte avec son processus. L'écran cochait
   * la seconde : une pastille verte sur une pièce jamais lue.
   */
  const [travaux, setTravaux] = useState<Readonly<Record<string, string>>>({});
  /** Les pièces décochées à l'étape 2 : gardées pour soi, non lues. */
  const [exclues, setExclues] = useState<readonly string[]>([]);
  /** La vignette ouverte dans la bande, et son petit menu. */
  const [choisie, setChoisie] = useState<string | null>(null);
  /*
   * ================================ LAQUELLE EST PARTIE, AU FAIT ?
   *
   * Supprimer une vignette la faisait disparaître à l'instant où la requête
   * revenait : trois vignettes devenaient deux, sans que rien ne dise
   * laquelle des trois. Ici elle garde sa place pendant 220 ms, rétrécit
   * sur elle-même en s'effaçant, et la bande se referme sur le trou — on
   * VOIT laquelle s'en va.
   *
   * Un état local et non une liste : une seule pièce part à la fois, le
   * menu de la vignette n'en ouvre qu'une.
   *
   * Le mouvement ne RETIENT rien : la mutation part dans le même geste, et
   * la suppression n'attend pas la fin de l'animation. Si le serveur répond
   * en moins de 220 ms, le mouvement est coupé court — c'est le bon sens de
   * la priorité, pas un défaut. Et `prefers-reduced-motion` l'éteint
   * (`styles-pme.css`) : la vignette reste alors visible jusqu'au retour de
   * la requête, ce qui est l'ancien comportement, exactement.
   */
  const [partante, setPartante] = useState<string | null>(null);
  const [question, setQuestion] = useState(0);
  /** La pièce montrée à « Vérifier » : on les passe une à une. */
  const [verifiee, setVerifiee] = useState(0);
  /** « Oui, déjà payées » : ouvre le choix du moyen. */
  const [payeOui, setPayeOui] = useState(false);
  /** « Plus tard » : un écran de fin, les pièces restent non lues. */
  const [plusTard, setPlusTard] = useState(false);
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
    queryKey: ["lectures-en-cours", pme.tenantId, ids.join(","), Object.values(travaux).join(",")],
    enabled: etape === 3 && ids.length > 0,
    queryFn: async () => {
      const etats = await Promise.all(
        ids.map(async (id) => {
          const travailId = travaux[id];
          /*
           * La file durable quand on tient le numéro du travail : elle survit
           * au redémarrage du serveur, et elle distingue « terminée » de
           * « plus rien ne tourne ». Sans numéro — une pièce lue par la file
           * hors ligne, un retour sur l'écran — on retombe sur la question au
           * processus, qui ne sait dire que « en cours ou pas ».
           */
          if (travailId) {
            const t = await office().fabrique.etatDeLaLecture(travailId);
            return {
              id,
              etat: t?.etat ?? null,
              enCours: t?.etat === "a_faire" || t?.etat === "en_cours",
            };
          }
          const m = await office().malica.etatDeLecture(id);
          return { id, etat: null, enCours: m.enCours };
        }),
      );
      return etats;
    },
    refetchInterval: (q) => (q.state.data?.some((e) => e.enCours) ? 3_000 : false),
  });

  /*
   * ============================== CE QUI A ÉTÉ LU SE RELIT QUAND LA LECTURE FINIT
   *
   * Recette « vie réelle » du 21 octobre 2026 (ANO-LIVE-008) : « Voici ce que
   * j'ai lu » disait « je n'ai pas lu » sur les quatre lignes, 30 fois sur 30,
   * alors que la fiche de chaque pièce affichait tout. Le résultat arrive par
   * la LISTE ; or la liste n'était redemandée par personne quand la dernière
   * lecture s'achevait — l'étape 4 montrait l'état d'avant la lecture.
   *
   * On la redemande donc dès que plus rien ne tourne, et à l'entrée de
   * l'étape 4 : ce que l'écran dit avoir lu est ce que la base a enregistré.
   */
  const plusRienNeTourne =
    lectures.isSuccess && (lectures.data ?? []).length > 0 && !lectures.data.some((e) => e.enCours);
  useEffect(() => {
    if (plusRienNeTourne || etape === 4)
      void qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
  }, [plusRienNeTourne, etape, qc, pme.tenantId]);

  const questions = useQuery({
    queryKey: ["charge-questions", pme.tenantId],
    enabled: etape >= 4,
    queryFn: () => office().charges.questions(pme.tenantId),
  });

  const familles = useQuery({
    queryKey: ["charges-familles", pme.packId, locale],
    enabled: etape >= 5 && !!pme.packId,
    queryFn: () => office().charges.familles(pme.packId!, locale),
  });

  const sansDate = useQuery({
    queryKey: ["charges-sans-date", pme.tenantId],
    enabled: etape >= 4,
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
      // L'accusé porte le numéro du travail inscrit en base. On le garde :
      // c'est la seule façon de redemander où en est CETTE lecture-là.
      const pris: Record<string, string> = {};
      for (const id of ids) {
        await office().collab.setPieceVis(id, "entite");
        const travail = await office().malica.demanderLaLecture(id);
        pris[id] = travail.travailId;
      }
      return pris;
    },
    onSuccess: async (pris) => {
      setTravaux(pris);
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
      setPartante(null);
      await qc.invalidateQueries({ queryKey: ["pieces-lues", pme.tenantId] });
    },
    onError: (raison: unknown) => {
      // La pièce reste : elle n'est pas partie. Sans ce retour, elle serait
      // figée à zéro largeur par le `both` de l'animation — invisible, et
      // pourtant toujours là.
      setPartante(null);
      echoue(raison);
    },
  });

  /* ── la navigation ───────────────────────────────────────────────────── */

  /** 8bis : l'espace privé a sa propre fin, et il n'y a rien à lire. */
  const finPrivee = dest === "prive";

  /*
   * ============================================ LES ÉTAPES SANS RIEN À FAIRE PASSENT
   *
   * 24 octobre 2026, parcours validé par Wissem : « Aucune question » et « Tout
   * est daté » étaient deux écrans où l'on ne pouvait que toucher « Continuer ».
   * Ils passent seuls quand la réponse est connue — et le retour les saute
   * aussi, sinon « ‹ » depuis le règlement retomberait sur un écran qui
   * repartirait aussitôt en avant.
   */
  const vide5 = questions.isSuccess && aRepondre.length === 0;
  const vide6 =
    sansDate.isSuccess &&
    (sansDate.data?.pieces ?? 0) === 0 &&
    retenues.every((p) => p.dateDocument !== null);
  useEffect(() => {
    if (etape === 5 && vide5) setEtape(6);
    else if (etape === 6 && vide6) setEtape(7);
  }, [etape, vide5, vide6]);

  /*
   * « À lire » (accueil, bibliothèque) rouvre un lot déjà pris : on part de
   * « Pour qui ? », une fois, dès que le lot est là.
   */
  useEffect(() => {
    if (
      lotDemande.depart === "destination" &&
      etape === 0 &&
      fige === null &&
      candidats.length > 0
    ) {
      setFige(candidats.map((p) => p.id));
      setEtape(1);
    }
  }, [lotDemande.depart, etape, fige, candidats]);

  function reculer() {
    if (plusTard) {
      setPlusTard(false);
      return;
    }
    if (etape === 0) {
      void navigate({ to: "/pme" });
      return;
    }
    // La fin privée vient de la destination, pas du règlement.
    if (finPrivee && etape === 8) {
      setEtape(1);
      return;
    }
    if (etape === 4 && verifiee > 0) {
      setVerifiee(verifiee - 1);
      return;
    }
    let e = etape - 1;
    while ((e === 6 && vide6) || (e === 5 && vide5)) e -= 1;
    setEtape(Math.max(0, e));
  }

  function recommencer() {
    /*
     * Le lot de ce passage a fini sa course : on le retire de l'URL, sinon
     * « capturer la suivante » rouvrirait l'étape 0 sur une liste de pièces
     * désormais lues — c'est-à-dire sur rien, sans dire pourquoi.
     */
    void navigate({ to: "/pme/capturer", search: {}, replace: true });
    setEtape(0);
    setFige(null);
    setDest(null);
    setExclues([]);
    setChoisie(null);
    setQuestion(0);
    setVerifiee(0);
    setMoyen(null);
    setReference("");
    setPaye(false);
    setPayeOui(false);
    setTransmis(null);
    setPlusTard(false);
  }

  const pasEncore = (p: PieceLue) => p.emetteur === null;
  const jour = (iso: string | null) =>
    iso === null
      ? null
      : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", timeZone: "UTC" }).format(
          new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso),
        );

  /** La pièce montrée à « Vérifier » : une à la fois. */
  const enVerification = retenues[Math.min(verifiee, Math.max(0, retenues.length - 1))] ?? null;
  const moyensPayes = (moyens.data ?? []).filter((m) => m.code !== "non_paye");
  /** « Plus tard » se propose tant que rien n'a été lu ni décidé. */
  const plusTardPossible =
    !plusTard && (etape === 1 || etape === 2 || (etape === 0 && lot.length > 0));

  /* ── l'écran ─────────────────────────────────────────────────────────── */

  return (
    <div data-ecran="capture" className="rg-rise">
      {/*
       * La barre : des traits, pas des chiffres. Un pas sur neuf ne se compte
       * pas, il se voit. Le retour est TOUJOURS là, à gauche.
       */}
      <div className="prog">
        <button type="button" className="x" onClick={reculer} aria-label={t("pme.capture.revenir")}>
          <Icone d={etape === 0 && !plusTard ? G.x : G.back} />
        </button>
        <span className="tr" aria-hidden>
          {ETAPES.map((cle, i) => (
            <i key={cle} className={i < etape || (plusTard && i === 0) ? "on" : ""} />
          ))}
        </span>
        {plusTardPossible ? (
          <button type="button" className="tard" onClick={() => setPlusTard(true)}>
            {t("pme.capture.plusTardCourt")}
          </button>
        ) : null}
      </div>

      <div className="pad">
        {(erreur ?? pme.captureError) ? (
          <div className="flag" role="alert">
            <i />
            <span>{erreur ?? pme.captureError}</span>
          </div>
        ) : null}

        {/* ═══════════════════════════════════════════ PLUS TARD : une vraie fin
            Les pièces restent telles quelles, non lues, et « À lire » les
            retrouve — sur l'accueil et dans la bibliothèque. On ne revient
            plus au début pour reposer la question. */}
        {plusTard ? (
          <>
            <div className="c-ok am">
              <span className="rond">
                <Icone d={G.horl} />
              </span>
              <h1>{t("pme.capture.plusTard.titre")}</h1>
              <p>{t("pme.capture.plusTard.sous")}</p>
            </div>
            <div className="go">
              <button type="button" className="pr" onClick={() => void navigate({ to: "/pme" })}>
                {t("pme.capture.plusTard.accueil")}
              </button>
              <button type="button" className="sc" onClick={recommencer}>
                {t("pme.capture.fin.suivante")}
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════ 0 · AJOUTER : on photographie,
            on ne lit pas. Le geste appartient au layout ; cet écran l'appelle. */}
        {!plusTard && etape === 0 ? (
          <>
            <h1 className="c-titre">{t("pme.capture.ajouter.titre")}</h1>
            <button
              type="button"
              className="c-photo"
              disabled={pme.capturing}
              onClick={pme.ouvrirScanner}
            >
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              <span>{t("pme.capture.photo")}</span>
            </button>
            <div className="c-deux">
              <button type="button" disabled={pme.capturing} onClick={() => pme.capture("images")}>
                <Icone d={G.gal} />
                <span>{t("pme.capture.galerie")}</span>
              </button>
              <button type="button" disabled={pme.capturing} onClick={() => pme.capture("pdf")}>
                <Icone d={G.fat} />
                <span>{t("pme.doc.importer")}</span>
              </button>
            </div>
            {pme.capturing ? <p className="c-sous">{t("pme.capture.preparation")}</p> : null}

            {/* La bande : ce qui est entré, avec sa vraie page, et le petit menu
                de la vignette ouverte. */}
            {lot.length > 0 ? (
              <>
                <p className="c-sous">{t("pme.capture.lot.nonLues", { count: lot.length })}</p>
                <div className="bande">
                  {lot.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className={[
                        "vg",
                        exclues.includes(p.id) ? "pv" : "",
                        choisie === p.id ? "sel" : "",
                        partante === p.id ? "part" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={p.emetteur ?? t("pme.capture.pieceNonLue")}
                      onClick={() => setChoisie(choisie === p.id ? null : p.id)}
                    >
                      <ApercuDePiece pieceId={p.id} className="mini" />
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
                      onClick={() => {
                        setPartante(choisie);
                        supprimer.mutate(choisie);
                      }}
                    >
                      {t("pme.capture.menu.supprimer")}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {enFile.length > 0 ? (
              <div className="flag">
                <i />
                <span>{t("pme.capture.file.attente", { count: enFile.length })}</span>
              </div>
            ) : null}

            {lot.length > 0 ? (
              <div className="go">
                <button
                  type="button"
                  className="pr"
                  onClick={() => {
                    setFige(lot.map((p) => p.id));
                    setEtape(1);
                  }}
                >
                  {t("pme.capture.repondre", { count: lot.length })}
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ═════════════════════════════════ 1 · POUR QUI ? — avant la lecture
            B6 : une pièce personnelle n'est jamais lue. La question se pose donc
            avant : la poser après, c'était débiter le quota de la société pour
            un papier qui ne la regarde pas. Un toucher répond et avance. */}
        {!plusTard && etape === 1 ? (
          <>
            <div className="c-tete">
              <h1 className="c-titre">{t("pme.capture.dest.titre")}</h1>
              <Aide
                titre={t("pme.capture.dest.titre")}
                paragraphes={[
                  { texte: t("pme.capture.dest.s") },
                  { texte: t("pme.capture.dest.prive.flag") },
                ]}
              />
            </div>
            <p className="c-sous">{t("pme.capture.lot.nonLues", { count: lot.length })}</p>

            {/* Le sélecteur de société n'apparaît que s'il y a plusieurs
                dossiers — et il vient du layout, qui les a déjà. */}
            {pme.dossiers.length > 1 ? (
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

            <button
              type="button"
              className="c-carte acc"
              onClick={() => {
                setDest("societe");
                setEtape(2);
              }}
            >
              <svg viewBox="0 0 24 24" className="g" aria-hidden>
                <path d="M4 21V7l8-4 8 4v14M9 21v-5h6v5M8 10h1M15 10h1M8 13.5h1M15 13.5h1" />
              </svg>
              <b>{t("pme.capture.dest.societe")}</b>
              <span>{t("pme.capture.dest.societe.court")}</span>
            </button>
            <button
              type="button"
              className="c-carte"
              disabled={garder.isPending}
              onClick={() => {
                setDest("prive");
                garder.mutate(
                  lot.map((p) => p.id),
                  { onSuccess: () => setEtape(8) },
                );
              }}
            >
              <Icone d={G.prive} />
              <b>{t("pme.capture.dest.prive")}</b>
              <span>{t("pme.capture.dest.prive.court")}</span>
            </button>
          </>
        ) : null}

        {/* ══════════════════════════════════════ 2 · LIRE MAINTENANT ?
            Tout est coché : décocher est plus court que cocher, et ce qu'on
            décoche reste chez soi, non lu, sans rien coûter. Le compte dit ce
            que le geste coûte, avant de le faire. */}
        {!plusTard && etape === 2 ? (
          <>
            <h1 className="c-titre">{t("pme.capture.choix.titre")}</h1>
            <p className="c-sous">{t("pme.capture.choix.retirer")}</p>
            <div className="c-grille">
              {lot.map((p) => {
                const gardee = exclues.includes(p.id);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={gardee ? "c-vg off" : "c-vg"}
                    aria-pressed={!gardee}
                    aria-label={p.emetteur ?? t("pme.capture.pieceNonLue")}
                    onClick={() =>
                      setExclues((e) => (gardee ? e.filter((x) => x !== p.id) : [...e, p.id]))
                    }
                  >
                    <ApercuDePiece pieceId={p.id} />
                    <span className="coche" aria-hidden>
                      <Icone d={G.ok} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
             * Le bouton n'est jamais barré par le plafond : c'est la base qui
             * refuse la lecture de trop, et une pièce refusée reste là,
             * intacte, non lue.
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

            <p className="c-compte">
              {t("pme.capture.choix.compte", { count: retenues.length, reste: resteDit })}
            </p>
            <div className="go">
              <button
                type="button"
                className="pr"
                disabled={retenues.length === 0 || lire.isPending}
                onClick={() => lire.mutate()}
              >
                {lire.isPending
                  ? t("common.loading")
                  : t("pme.capture.choix.lireCourt", { count: retenues.length })}
              </button>
              <button type="button" className="sc" onClick={() => setPlusTard(true)}>
                {t("pme.capture.plusTardCourt")}
              </button>
            </div>
          </>
        ) : null}

        {/* ══════════════════════════════════════════════════ 3 · JE LIS
            Ce qui s'affiche est l'état réel de chaque pièce, redemandé tant
            qu'une tourne. On peut vérifier la première sans attendre les
            autres, ou revenir à l'accueil : la lecture continue. */}
        {!plusTard && etape === 3 ? (
          <>
            <div className="c-malica">
              <img src={portraitMalica} alt="Malica" width={620} height={620} />
              <h1>{t("pme.capture.lire.q", { count: retenues.length })}</h1>
            </div>
            <div className="c-liste">
              {retenues.map((p) => {
                const etat = (lectures.data ?? []).find((e) => e.id === p.id);
                /*
                 * « Faite » veut dire LUE, pas « plus rien ne tourne » : le
                 * dossier porte un émetteur, ou la file durable dit « termine ».
                 */
                const faite = !pasEncore(p) || etat?.etat === "termine";
                const mot = faite
                  ? t("pme.capture.lire.lue")
                  : etat?.etat
                    ? t(MOT_DU_TRAVAIL[etat.etat])
                    : t("pme.capture.travail.a_faire");
                return (
                  <div key={p.id} className={faite ? "ok" : ""}>
                    <ApercuDePiece pieceId={p.id} className="mini" />
                    <span className="nom">{p.emetteur ?? t("pme.capture.pieceNonLue")}</span>
                    <span className="et">{mot}</span>
                  </div>
                );
              })}
            </div>
            <div className="go">
              <button type="button" className="pr" onClick={() => setEtape(4)}>
                {t("pme.capture.lire.verifier")}
              </button>
              <button type="button" className="sc" onClick={() => void navigate({ to: "/pme" })}>
                {t("pme.capture.lire.accueil")}
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════════════════ 4 · VÉRIFIER, UNE À UNE
            La vraie page, le montant, quatre lignes. Chaque ligne se corrige sur
            le dossier de la pièce, où `capture.preciser` vit (R7 : une précision
            s'ajoute, elle n'écrase jamais). */}
        {!plusTard && etape === 4 && enVerification ? (
          <>
            <p className="c-rang">
              {t("pme.capture.verif.rang", {
                n: Math.min(verifiee, retenues.length - 1) + 1,
                total: retenues.length,
              })}
            </p>
            <div className="c-piece">
              <button
                type="button"
                className="c-grande"
                aria-label={t("pme.piece.voir")}
                onClick={() =>
                  void navigate({
                    to: "/pme/piece/$pieceId",
                    params: { pieceId: enVerification.id },
                  })
                }
              >
                <ApercuDePiece pieceId={enVerification.id} />
              </button>
              <div className="qui">
                {enVerification.kind ? (
                  <span className="k">{t(CLE_DU_TYPE[enVerification.kind])}</span>
                ) : null}
                <h1>{enVerification.emetteur ?? t("pme.capture.pieceNonLue")}</h1>
                {enVerification.total !== null ? (
                  <span className="mt">
                    {montant(enVerification.total, locale)}{" "}
                    <u>{enVerification.devise ?? pme.currency}</u>
                  </span>
                ) : null}
              </div>
            </div>
            {(() => {
              const p = enVerification;
              const corriger = () =>
                void navigate({ to: "/pme/piece/$pieceId", params: { pieceId: p.id } });
              return (
                <div className="lu">
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
                    onCorriger={corriger}
                  />
                  {/* Le motif passe par son traducteur : c'est un CODE de la base. */}
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
            })()}
            <div className="go">
              <button
                type="button"
                className="pr"
                onClick={() =>
                  verifiee + 1 < retenues.length ? setVerifiee(verifiee + 1) : setEtape(5)
                }
              >
                {verifiee + 1 < retenues.length
                  ? t("pme.capture.verif.suivante")
                  : t("pme.capture.verif.bon")}
              </button>
              <button type="button" className="sc" onClick={pme.ouvrirScanner}>
                {t("pme.verifie.corriger")}
              </button>
            </div>
          </>
        ) : null}

        {/* ═══════════════════════════════ 5 · LES QUESTIONS, UNE PAR ÉCRAN
            Seulement s'il y en a : sinon l'étape passe seule. Le seuil est une
            politique de l'entreprise : la question se pose, elle ne se tranche
            pas toute seule. */}
        {!plusTard && etape === 5 ? (
          courante ? (
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
            <p className="c-sous" role="status">
              {t("pme.capture.q.jeRegarde")}
            </p>
          )
        ) : null}

        {/* ══════════════════════════════════════════ 6 · CE QUI ATTEND SA DATE
            Seulement s'il y en a. C'est la date qui décide de la TVA, et elle
            ne se choisit pas à la place de quelqu'un : le geste est sur le
            dossier de la pièce. */}
        {!plusTard && etape === 6 ? (
          vide6 || !sansDate.isSuccess ? (
            <p className="c-sous" role="status">
              {t("pme.capture.q.jeRegarde")}
            </p>
          ) : (
            <>
              <Dit
                q={t("pme.capture.dates.q", { count: sansDate.data?.pieces ?? 0 })}
                s={t("pme.capture.dates.s")}
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
          )
        ) : null}

        {/* ═══════════════════════════════════════════ 7 · DÉJÀ PAYÉES ?
            Une réponse pour tout le lot : un mois d'achats au comptoir est
            presque toujours d'un seul moyen. Le montant n'est pas retapé — le
            Socle prend celui de chaque pièce. « Pas encore » passe à la fin :
            chaque pièce garde son règlement ouvert, sur sa fiche. */}
        {!plusTard && etape === 7 ? (
          <>
            <h1 className="c-titre">{t("pme.capture.pay.titre", { count: retenues.length })}</h1>
            <p className="c-sous">{t("pme.capture.fin.lues", { count: retenues.length })}</p>
            <div className="c-seg">
              <button
                type="button"
                aria-pressed={payeOui}
                className={payeOui ? "on" : undefined}
                onClick={() => setPayeOui(true)}
              >
                {t("pme.capture.pay.oui")}
              </button>
              <button type="button" onClick={() => setEtape(8)}>
                {t("pme.capture.pay.pasEncore")}
              </button>
            </div>

            {payeOui ? (
              <>
                <div className="c-puces" role="group" aria-label={t("pme.paiement.moyen")}>
                  {moyensPayes.map((m) => (
                    <button
                      type="button"
                      key={m.code}
                      aria-pressed={moyen === m.code}
                      className={moyen === m.code ? "on" : undefined}
                      onClick={() => {
                        setMoyen(m.code);
                        setReference("");
                      }}
                    >
                      {m.libelle}
                    </button>
                  ))}
                </div>
                {/* La référence n'est demandée que si le référentiel l'exige. */}
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
                {exigeTalon ? <p className="c-sous">{t("pme.capture.pay.talon")}</p> : null}
                <div className="go">
                  <button
                    type="button"
                    className="pr"
                    disabled={moyen === null || payer.isPending}
                    onClick={() => payer.mutate()}
                  >
                    {payer.isPending ? t("common.loading") : t("pme.capture.pay.enregistrer")}
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {/* ══════════════════════════════════════════════════════ 8 · LA FIN
            Deux boutons de même poids. La transmission est une DÉCISION, prise
            ici, quand le verdict de la lecture existe — et pas à la photo. */}
        {!plusTard && etape === 8 && !finPrivee ? (
          <>
            <div className="c-ok">
              <span className="rond">
                <Icone d={G.ok} />
              </span>
              <h1>{t("pme.capture.fin.lues", { count: retenues.length })}</h1>
              {restantes !== null ? (
                <p>{t("pme.capture.fin.reste", { count: restantes })}</p>
              ) : null}
            </div>
            <div className="fin">
              {exclues.length > 0 ? (
                <Fin>{t("pme.capture.fin.gardees", { count: exclues.length })}</Fin>
              ) : null}
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
              ) : null}
              {transmis === true ? (
                <Fin>{t("pme.capture.fin.transmises", { count: retenues.length })}</Fin>
              ) : transmis === false ? (
                <Fin>{t("pme.capture.fin.conservees", { count: retenues.length })}</Fin>
              ) : null}
            </div>

            {transmis === null ? (
              pme.aUnCabinet ? (
                <div className="c-envoi">
                  <b>{t("pme.capture.fin.envoyer.q", { count: retenues.length })}</b>
                  <div className="deux">
                    <button
                      type="button"
                      disabled={terminer.isPending}
                      onClick={() => terminer.mutate(false)}
                    >
                      {t("pme.capture.fin.garder")}
                    </button>
                    <button
                      type="button"
                      className="pr"
                      disabled={terminer.isPending}
                      onClick={() => terminer.mutate(true)}
                    >
                      {t("pme.capture.fin.envoyer")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="go">
                  <button
                    type="button"
                    className="pr"
                    disabled={terminer.isPending}
                    onClick={() => terminer.mutate(false)}
                  >
                    {t("pme.capture.fin.terminer")}
                  </button>
                </div>
              )
            ) : (
              <div className="go">
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
              </div>
            )}
          </>
        ) : null}

        {/* ═══════════════════════════════════════ 8bis · LA FIN, CHEZ VOUS
            Rien n'a été lu, et c'est le propos : quota intact, invisible. */}
        {!plusTard && etape === 8 && finPrivee ? (
          <>
            <div className="c-ok">
              <span className="rond">
                <Icone d={G.prive} />
              </span>
              <h1>{t("pme.capture.prive.q")}</h1>
              <p>
                {restantes === null
                  ? t("pme.capture.prive.intactes", { count: lot.length })
                  : t("pme.capture.prive.intactes.reste", {
                      count: lot.length,
                      reste: restantes,
                    })}
              </p>
            </div>
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
    <button
      type="button"
      onClick={onCorriger}
      aria-label={`${k} — ${t("pme.capture.lu.corriger")}`}
    >
      <span className="k">{k}</span>
      <span className={["v", mono ? "mono" : "", v === null ? "am" : ""].filter(Boolean).join(" ")}>
        {v ?? t("pme.capture.lu.nonLu")}
      </span>
      <span className="ed" aria-hidden>
        <svg viewBox="0 0 24 24" className="g">
          <path d="M4 20h4L19 9l-4-4L4 16z" />
        </svg>
      </span>
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
