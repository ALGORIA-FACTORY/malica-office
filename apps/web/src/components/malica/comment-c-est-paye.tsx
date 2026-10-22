/**
 * « Comment avez-vous payé ? » — l'étape qui suit la lecture.
 *
 * ================================================================= POURQUOI
 *
 * Demandé le 10 octobre 2026 : « le moyen de paiement doit être choisi entre
 * la liste suivante dans un écran qui suit la lecture : espèce, chèque, carte
 * bancaire, traite, chèque de banque, virement ou autre. À l'exception
 * d'espèces les autres on doit prendre une photo et le rattacher à la
 * facture. »
 *
 * ======================================== PAS UN ÉCRAN DE PLUS : UNE PAGE QUI DESCEND
 *
 * Quatre écrans font quatre occasions d'abandonner. Celui-ci vit donc SOUS
 * les montants, sur la même page : on descend, on répond, on continue.
 *
 * ===================================================== CE QUI NE BLOQUE PAS
 *
 * La photo du justificatif ne conditionne rien. Un dirigeant qui n'a pas son
 * talon sous la main doit pouvoir avancer : la pièce est marquée
 * « justificatif manquant » et la liste le lui rappellera. Un écran qui
 * refuse d'avancer se contourne en cochant « espèces », et l'information est
 * perdue au lieu d'être gagnée.
 *
 * ============================================== ET LA LISTE VIENT DU PACK
 *
 * Huit moyens, leurs comptes de trésorerie, leurs libellés traduits : tout
 * vient de `ref.payment_means`, à la date de la pièce. Un moyen de paiement
 * écrit en dur donnerait une écriture fausse dans la première juridiction
 * suivante — avec des libellés justes et des comptes faux, donc invisible.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText } from "lucide-react";
import { useState } from "react";

import { files } from "@/capabilities/files";
import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { montant } from "@/lib/lisible";
import { totalDesPaiements } from "@/lib/total-des-paiements";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { vidage } from "@/lib/hors-ligne";
import { office } from "@/verticals/malica-office/composition";
import { depuisUniteMineure } from "@malica/socle/somme-decimale";
import { construireRecu } from "@malica/socle/use-cases/recu-de-paiement";

export function CommentCEstPaye({
  pieceId,
  visDeLaPiece,
  dateDeLaPiece,
  ttcMineur,
  devise,
  sens,
  tiers,
  reference,
  decimales,
}: {
  pieceId: string;
  /**
   * La visibilité de la facture, que la preuve reprend.
   *
   * « Et qui doit être transmis au comptable avec la photo » : si la facture
   * est partie, le talon part avec elle. Une preuve restée personnelle sur une
   * facture transmise donnerait au cabinet une pièce dont le justificatif
   * existe et reste invisible.
   */
  visDeLaPiece: "personnel" | "partage";
  /** La date de la pièce : c'est à elle que le pack est lu, jamais à l'horloge. */
  dateDeLaPiece: string | null;
  /** Le total lu, en unités mineures — proposé par défaut, jamais imposé. */
  ttcMineur: number | null;
  devise: string;
  /**
   * Dépense ou revenu — pour le titre du reçu.
   *
   * `null` quand la lecture n'a pas tranché le sens : le reçu ne se produit
   * alors pas, parce qu'un « reçu de dépense » posé sur une vente est un
   * document faux, et qu'un document faux remis à un tiers est pire qu'un
   * document absent.
   */
  sens: "depense" | "revenu" | null;
  /** Le tiers et la référence, tels que la lecture les a cités. */
  tiers: string | null;
  reference: string | null;
  /** Les décimales de la devise, lues au pack. `null` tant qu'on ne les a pas. */
  decimales: number | null;
}) {
  const { t, locale, dir } = useI18n();
  const pme = usePme();
  const qc = useQueryClient();
  const [erreur, setErreur] = useState<string | null>(null);
  /*
   * ============================ OU S'AFFICHE UNE ERREUR : SOUS CE QUI L'A PRODUITE
   *
   * 13 octobre 2026. Le dirigeant appuie sur « Generer le recu », et « il ne
   * se passe rien ». La base ne contient aucun recu — pas un seul — et son
   * dossier porte bien son matricule : l'echec est donc reel, et anterieur au
   * depot.
   *
   * Le message EXISTAIT. Il s'affichait en bas de la section, apres la grille
   * des huit moyens : environ deux cent vingt pixels sous le bouton, donc hors
   * de l'ecran d'un telephone. Et le journal d'atelier qui l'aurait garde ne
   * tourne qu'en developpement (`journal-atelier.ts`, `import.meta.env.DEV`) :
   * sur l'application installee, la raison etait perdue deux fois.
   *
   * Une erreur se pose donc sous le geste qui l'a produite. C'est le meme
   * defaut que celui deja nomme dans l'ecran de la piece, et la meme correction.
   */
  const [erreurDe, setErreurDe] = useState<"recu" | "autre" | null>(null);
  /** Le recu est fabrique mais attend le reseau : ce n'est ni un echec ni un silence. */
  const [recuEnAttente, setRecuEnAttente] = useState(false);
  const poserErreur = (ou: "recu" | "autre", e: unknown) => {
    setErreurDe(ou);
    setErreur(texteDeLErreur(e, "components/malica/comment-c-est-paye", t("common.error")));
  };
  const effacerErreur = () => {
    setErreur(null);
    setErreurDe(null);
  };

  const au = dateDeLaPiece ?? new Date().toISOString().slice(0, 10);

  const moyens = useQuery({
    queryKey: ["moyens-paiement", pme.packId, locale, au],
    queryFn: () => office().referential.moyensDePaiement(pme.packId!, locale, au),
    enabled: !!pme.packId,
    staleTime: 60 * 60 * 1000,
  });

  const paiements = useQuery({
    queryKey: ["paiements", pieceId],
    queryFn: () => office().capture.paiementsDUnePiece(pieceId),
  });

  /**
   * Ce qui est NÉ de cette facture : le reçu, les talons.
   *
   * 13 octobre 2026 : « le reçu ne se génère pas ». Et même quand il se
   * générait, l'écran de la PME n'en montrait RIEN — aucune liste, aucun
   * nom, aucun geste pour l'ouvrir. Le bouton passait une seconde en
   * « Chargement… », revenait, et c'était tout. Le cabinet, lui, lisait
   * déjà ces pièces depuis septembre (`piecesIssuesDe`).
   */
  const joints = useQuery({
    queryKey: ["joints", pieceId],
    queryFn: () => office().capture.piecesIssuesDe(pieceId),
  });
  const typesDoc = useQuery({
    queryKey: ["types-document", locale],
    queryFn: () => office().referential.typesDeDocument(locale),
    staleTime: 60 * 60 * 1000,
  });
  const nomDuType = (code: string | null) =>
    (typesDoc.data ?? []).find((x) => x.code === code)?.libelle ?? code ?? "—";

  /** Les motifs d'annulation, du référentiel et traduits — jamais du code. */
  const motifs = useQuery({
    queryKey: ["motifs-annulation", locale],
    queryFn: () => office().capture.motifsDAnnulation(locale),
    staleTime: 60 * 60 * 1000,
  });

  /*
   * =============================== CE QU'ON DEMANDE AVANT D'INSCRIRE
   *
   * 13 octobre 2026. L'écran inscrivait TOUJOURS le TTC entier : la colonne
   * `montant_mineur` acceptait depuis toujours un acompte — son commentaire
   * le dit — mais rien ne permettait de le saisir. Et deux taps produisaient
   * deux lignes au total plein, donc le double.
   *
   * On demande donc, et la question est celle que pose n'importe quel
   * commerçant : la totalité, ou une partie ?
   */
  const [partiel, setPartiel] = useState<boolean | null>(null);
  const [montantSaisi, setMontantSaisi] = useState("");
  const [referenceSaisie, setReferenceSaisie] = useState("");
  /** Le paiement dont on a ouvert la correction, et son motif choisi. */
  const [aCorriger, setACorriger] = useState<string | null>(null);

  /*
   * ============================== LA DATE DU PAIEMENT SE DÉCLARE, ELLE NE SE DEVINE PAS
   *
   * 13 octobre 2026. La colonne `paye_le` dit, depuis le premier jour, « la
   * date du paiement, déclarée par la personne ». L'écran y mettait
   * l'horloge du téléphone, toujours.
   *
   * Une facture payée en espèces la semaine dernière et saisie aujourd'hui
   * entrait donc à la mauvaise date — et c'est elle qui lit le pack, qui
   * range la trésorerie, et qui date l'écriture du règlement. Un
   * rapprochement bancaire cherche alors un mouvement au mauvais jour.
   *
   * Le jour même reste proposé : c'est le cas courant, et faire ressaisir
   * une date juste à chaque paiement coûterait plus que ça ne rapporte. Mais
   * c'est un défaut VISIBLE et modifiable, pas une valeur invisible (R10-2).
   */
  const aujourdHui = new Date().toISOString().slice(0, 10);
  const [dateDuPaiement, setDateDuPaiement] = useState(aujourdHui);

  /**
   * La photo du justificatif — même capture, même archive, même chiffrement.
   *
   * Elle passe par la FILE, comme toute pièce : hors ligne, la preuve attend
   * dans l'appareil et part au retour du réseau. Photographier un talon de
   * chèque dans un parking sans réseau est précisément le cas qui se présente.
   *
   * Son type, `justificatif_paiement`, porte `porte_ecriture = false` : un
   * document transmis au cabinet et comptabilisable une seconde fois est la
   * façon la plus simple de compter une charge deux fois.
   */
  async function photographierLaPreuve(): Promise<string | null> {
    const [pris] = await files.takePhoto();
    if (!pris) return null;
    const cle = await vidage().deposer(
      {
        cle: files.newIdempotencyKey(),
        tenantId: pme.tenantId,
        entityId: pme.entityId,
        source: pris.source,
        // La preuve suit la facture : si celle-ci est partie au cabinet, le
        // talon part avec elle — « transmise au comptable avec la photo ».
        vis: visDeLaPiece,
        contentType: pris.blob.type || "application/pdf",
        documentKind: "justificatif_paiement",
        /*
         * LA PREUVE SAIT DE QUELLE FACTURE ELLE VIENT.
         *
         * 13 octobre 2026 : le talon de chèque photographié apparaissait
         * comme un document flottant — dans la liste de la PME et chez le
         * cabinet, sous « pas encore classés », avec « Émetteur non trouvé ».
         *
         * La cause tenait en une absence : cette propriété manquait ici,
         * alors que le reçu la passe cent quarante lignes plus bas, dans ce
         * même fichier. Les deux étages de la file font `?? null`, donc
         * l'oubli ne levait rien : la pièce naissait orpheline, en silence.
         */
        sourcePieceId: pieceId,
        nomFichier: pris.name,
      },
      pris.blob,
    );
    const element = await vidage().attendre(cle, 8_000);
    return element?.pieceId ?? null;
  }

  const inscrire = useMutation({
    /*
     * ============================ LA PHOTO D'ABORD, QUAND LE MOYEN L'EXIGE
     *
     * Demandé le 10 octobre : « à l'exception d'espèces les autres on doit
     * prendre une photo et la rattacher à la facture ». L'appareil s'ouvre
     * donc au tap, avant l'inscription, et le paiement naît déjà prouvé —
     * une seule écriture, et la table des paiements reste en ajout seul.
     *
     * Un abandon de l'appareil n'annule RIEN : le paiement s'inscrit sans
     * preuve, la ligne dit « justificatif à photographier », et le bouton
     * reste là. Un écran qui refuse d'avancer se contourne en cochant
     * « espèces », et l'information est perdue au lieu d'être gagnée.
     */
    mutationFn: async (moyenCode: string) => {
      const paye = moyenCode !== "non_paye";
      if (!historiquePret || (paye && montantAInscrire === null))
        throw new Error(t("pme.paiement.incomplet"));
      const justificatifPieceId = exigeUnePreuve(moyenCode) ? await photographierLaPreuve() : null;
      return office().capture.enregistrerPaiement({
        pieceId,
        packId: pme.packId!,
        moyenCode,
        // Le montant et la date vont ensemble ou pas du tout : la base le
        // refuse autrement, et un paiement à moitié saisi ne se lit pas.
        montantMineur: paye ? montantAInscrire : null,
        devise,
        payeLe: paye && montantAInscrire !== null ? dateDuPaiement : null,
        justificatifPieceId,
        reference: referenceSaisie.trim() === "" ? null : referenceSaisie.trim(),
      });
    },
    onSuccess: async () => {
      effacerErreur();
      setPartiel(null);
      setMontantSaisi("");
      setReferenceSaisie("");
      await qc.invalidateQueries({ queryKey: ["paiements", pieceId] });
    },
    onError: (e: unknown) => poserErreur("autre", e),
  });

  /**
   * La preuve qui arrive APRÈS — et c'est le cas courant.
   *
   * Le paiement est en ajout seul : il ne se réécrit pas. Le rattachement est
   * donc une écriture nouvelle, et la dernière vaut — reprendre une photo
   * floue n'est pas l'exception.
   */
  const rattacher = useMutation({
    mutationFn: async (paiementId: string) => {
      const preuve = await photographierLaPreuve();
      if (!preuve) return;
      await office().capture.rattacherJustificatif(paiementId, preuve);
    },
    onSuccess: async () => {
      effacerErreur();
      await qc.invalidateQueries({ queryKey: ["paiements", pieceId] });
    },
    onError: (e: unknown) => poserErreur("autre", e),
  });

  const deja = paiements.data ?? [];

  /*
   * =========================== CE QUI EST PAYÉ AUJOURD'HUI, ET CE QUI RESTE
   *
   * Les lignes ÉTEINTES ne comptent pas — ni dans le reste dû, ni dans le
   * reçu. Elles restent affichées : l'histoire d'un fait comptable ne se
   * cache pas, elle se barre (R7).
   */
  const vivants = deja.filter((p) => !p.eteint);
  const historiquePret = paiements.isSuccess && !paiements.isFetching;
  const payeMineur = paiements.isSuccess ? totalDesPaiements(deja) : null;
  const restantMineur =
    ttcMineur === null || payeMineur === null ? null : Math.max(0, ttcMineur - payeMineur);
  const solde = restantMineur !== null && restantMineur === 0 && vivants.length > 0;

  /** Le montant lisible, aux décimales du pack — jamais divisé par 1000 en dur. */
  const lisible = (mineur: number | null) =>
    mineur === null || decimales === null
      ? "—"
      : montant(depuisUniteMineure(mineur, decimales), locale);

  /**
   * Le montant qu'on va inscrire.
   *
   * Après choix explicite de la totalité, ce qui RESTE à payer. Sur un
   * solde, proposer à nouveau le total entier est l'erreur qui a produit le
   * doublon du 13 octobre.
   */
  const montantAInscrire = (() => {
    if (!historiquePret || payeMineur === null || partiel === null) return null;
    if (!partiel)
      return restantMineur !== null && Number.isSafeInteger(restantMineur) && restantMineur > 0
        ? restantMineur
        : null;
    if (decimales === null) return null;
    const n = Number(montantSaisi.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    const mineur = Math.round(n * 10 ** decimales);
    return Number.isSafeInteger(mineur) && mineur > 0 ? mineur : null;
  })();

  /**
   * Corriger un moyen de paiement — par une annulation, jamais par une rature.
   *
   * « Il faut avoir le moyen de retour si le moyen de paiement choisi est
   * faux. » Le voici : la ligne s'éteint, motivée, et l'ancienne reste
   * lisible. Inscrire le bon moyen est ensuite le geste ordinaire.
   */
  const annuler = useMutation({
    mutationFn: ({ paiementId, motifId }: { paiementId: string; motifId: string }) =>
      office().capture.annulerPaiement(paiementId, motifId),
    onSuccess: async () => {
      effacerErreur();
      setACorriger(null);
      await qc.invalidateQueries({ queryKey: ["paiements", pieceId] });
    },
    onError: (e: unknown) => poserErreur("autre", e),
  });
  const libelleDuMoyen = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.libelle ?? code;
  const exigeUnePreuve = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.exigeJustificatif ?? false;
  /*
   * Le numero du cheque, de la traite, la reference du virement.
   *
   * C'est ce que l'extrait bancaire reprendra, et donc ce qui permet de
   * rapprocher. Il n'existait nulle part : l'expert ouvrait la photo du
   * talon, dechiffrait le numero a l'oeil, et le recopiait.
   *
   * Quels moyens en portent une est une donnee du pack, pas une regle
   * d'ecran — comme le justificatif juste au-dessus (R4, R10).
   */
  const exigeUneReference = (code: string) =>
    (moyens.data ?? []).find((m) => m.code === code)?.exigeReference ?? false;
  /** Un moyen au moins en demande une : on montre alors le champ. */
  const uneReferenceEstUtile = (moyens.data ?? []).some((m) => m.exigeReference);

  /**
   * ============================================= LE REÇU DE DÉPENSE OU DE REVENU
   *
   * Demandé le 10 octobre : « Malica génère le reçu de dépense ou de revenu
   * et le moyen de paiement ».
   *
   * Le contenu vient du Socle — la somme en unités mineures, le refus d'un
   * reçu sans paiement, les décimales du pack. Cet écran ne compose rien : il
   * rassemble ce que la lecture a cité, appelle le moteur, dessine, et dépose
   * le résultat comme une PIÈCE de plus, rattachée à la facture.
   *
   * Les mentions obligatoires descendent du pack, traduites (R4). Une mention
   * écrite ici serait fausse dans la juridiction suivante, et personne ne le
   * verrait avant un contrôle.
   */
  const recu = useMutation({
    mutationFn: async () => {
      if (sens === null || decimales === null || !pme.packId) return null;
      const mentions = await office().referential.mentionsDuPack(pme.packId, locale);
      const emisLe = new Date().toISOString().slice(0, 10);
      const construit = construireRecu({
        sens,
        decimales,
        devise,
        dossier: { nom: pme.orgName, matricule: pme.matricule },
        tiers,
        piece: { reference, date: dateDeLaPiece },
        /*
         * Seuls les paiements QUI ONT EU LIEU. « Pas encore payé » est une
         * réponse valable sur une facture à trente jours, et ce n'est pas un
         * règlement : le faire figurer sur un reçu attesterait d'un versement
         * qui n'existe pas.
         */
        paiements: vivants
          .filter((p) => p.montantMineur !== null)
          .map((p) => ({
            moyen: libelleDuMoyen(p.moyenCode),
            montant: depuisUniteMineure(p.montantMineur!, decimales),
            date: p.payeLe,
          })),
        // Seulement celles que le pack rend obligatoires : un reçu qui
        // recopierait toute la liste serait illisible.
        mentions: mentions.filter((m) => m.mandatory).map((m) => m.label),
        libelles: {
          titreDepense: t("pme.recu.titre.depense"),
          titreRevenu: t("pme.recu.titre.revenu"),
          dossier: t("pme.recu.dossier"),
          matricule: t("pme.recu.matricule"),
          tiers: t("pme.recu.tiers"),
          piece: t("pme.recu.piece"),
          date: t("pme.recu.date"),
          moyen: t("pme.paiement.moyen"),
          montant: t("pme.recu.montant"),
          total: t("pme.recu.total"),
          emisLe: t("pme.recu.emisLe"),
        },
        emisLe,
      });

      const { rendreRecuEnPdf } = await import("@/capabilities/recu-pdf");
      const rendu = await rendreRecuEnPdf(construit, dir);
      const cle = await vidage().deposer(
        {
          cle: files.newIdempotencyKey(),
          tenantId: pme.tenantId,
          entityId: pme.entityId,
          source: "pdf",
          // Le reçu suit la facture : transmise, il part avec elle.
          vis: visDeLaPiece,
          contentType: "application/pdf",
          documentKind: "recu_de_paiement",
          sourcePieceId: pieceId,
          nomFichier: rendu.name,
        },
        rendu.blob,
      );
      /*
       * Ce que la file rend, et ce qu'on en fait.
       *
       * `null` : l'element a ete purge, donc la piece est partie — c'est
       * arrive. Un element avec `pieceId` : enregistre. Un element en
       * `echec_definitif` : l'API a refuse, et jusqu'ici ce refus passait par
       * `onSuccess` sans un mot. Un element encore en file au bout de huit
       * secondes n'est pas un echec : il partira au retour du reseau, et on
       * le DIT plutot que de laisser croire qu'il ne s'est rien passe.
       */
      const element = await vidage().attendre(cle, 8_000);
      if (element?.etat === "echec_definitif")
        throw new Error(element.derniereErreur ?? t("common.error"));
      return element;
    },
    onSuccess: async (element) => {
      effacerErreur();
      setRecuEnAttente(element !== null && element.pieceId === null);
      await qc.invalidateQueries({ queryKey: ["pieces", pme.tenantId] });
      await qc.invalidateQueries({ queryKey: ["piece", pieceId] });
      await qc.invalidateQueries({ queryKey: ["joints", pieceId] });
    },
    onError: (e: unknown) => poserErreur("recu", e),
  });

  // Un reçu atteste d'un règlement : sans montant payé, il n'atteste de rien.
  // Le Socle le refuse ; l'écran ne propose donc pas le geste.
  const recuPossible =
    historiquePret &&
    payeMineur !== null &&
    sens !== null &&
    decimales !== null &&
    vivants.some((p) => p.montantMineur !== null);

  return (
    <section className="mt-6 border-t border-border pt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-marigold">
        {t("pme.paiement.titre")}
      </p>

      {paiements.isPending ? <p role="status">{t("common.loading")}</p> : null}
      {paiements.error || moyens.error ? (
        <div role="alert" className="mt-2 text-[13px] text-signal-warn">
          <p>
            {texteDeLErreur(
              paiements.error ?? moyens.error,
              "components/malica/comment-c-est-paye",
              t("common.error"),
            )}
          </p>
          <button
            type="button"
            className="min-h-[44px] underline"
            onClick={() => {
              void paiements.refetch();
              void moyens.refetch();
            }}
          >
            {t("doc.retry")}
          </button>
        </div>
      ) : null}
      {paiements.isSuccess && payeMineur === null ? (
        <p role="status" className="mt-2 text-[13px] text-signal-warn">
          {t("pme.paiement.incomplet")}
        </p>
      ) : null}

      {deja.length > 0 ? (
        <>
          {/*
           * Ce qui a DÉJÀ été inscrit, en premier : un acompte puis un solde
           * sont deux faits, et le second ne remplace pas le premier.
           */}
          <ul className="mt-2.5 grid gap-px border border-border bg-border">
            {deja.map((p) => (
              <li key={p.id} className={`bg-card px-3 py-2 ${p.eteint ? "opacity-55" : ""}`}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`text-[13.5px] font-medium ${p.eteint ? "line-through" : ""}`}>
                    {libelleDuMoyen(p.moyenCode)}
                    {p.reference ? (
                      <span className="num ms-1.5 text-[12px] text-text-2">{p.reference}</span>
                    ) : null}
                  </span>
                  {/*
                   * Le montant aux decimales du PACK.
                   *
                   * Il etait divise par 1000 en dur, avec trois decimales
                   * ecrites a la main : juste en Tunisie, faux dans la
                   * premiere monnaie a deux decimales — et invisible, parce
                   * que le libelle, lui, resterait juste (R4). L'ecran du
                   * cabinet faisait deja correctement, a deux fichiers de la.
                   */}
                  <span className={`num shrink-0 text-[13.5px] ${p.eteint ? "line-through" : ""}`}>
                    {lisible(p.montantMineur)}
                  </span>
                </span>
                {p.eteint ? (
                  <span className="mt-0.5 block text-[11.5px] text-text-2">
                    {p.annulePaiementId === null
                      ? t("pme.paiement.etat.annule")
                      : t("pme.paiement.etat.annulation")}
                  </span>
                ) : null}
                {/*
                 * Le manque était dit, et rien ne permettait d'y répondre :
                 * une ligne orange sur toutes les pièces, pour toujours. Elle
                 * est devenue le bouton qui ouvre l'appareil.
                 */}
                {p.justificatifPieceId === null && exigeUnePreuve(p.moyenCode) ? (
                  <button
                    type="button"
                    onClick={() => rattacher.mutate(p.id)}
                    disabled={rattacher.isPending}
                    className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-signal-warn underline underline-offset-2 disabled:opacity-40"
                  >
                    <Camera className="h-[13px] w-[13px]" aria-hidden />
                    {rattacher.isPending ? t("common.loading") : t("pme.paiement.preuve.prendre")}
                  </button>
                ) : p.justificatifPieceId !== null ? (
                  <span className="mt-0.5 block text-[11.5px] text-signal-ok">
                    {t("pme.paiement.preuve.jointe")}
                  </span>
                ) : null}

                {/*
                 * ======================================= LE RETOUR EN ARRIERE
                 *
                 * « Il faut avoir le moyen de retour si le moyen de paiement
                 * choisi est faux. » Le 13 octobre, la seule issue etait d'en
                 * ajouter un second — et le total doublait.
                 *
                 * On n'efface pas : on eteint, avec un motif. L'ancienne
                 * ligne reste lisible, barree.
                 */}
                {!p.eteint ? (
                  aCorriger === p.id ? (
                    <span className="mt-1.5 block">
                      <span className="block text-[11.5px] text-text-2">
                        {t("pme.paiement.pourquoi")}
                      </span>
                      {(motifs.data ?? []).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          disabled={annuler.isPending}
                          onClick={() => annuler.mutate({ paiementId: p.id, motifId: m.id })}
                          className="mt-1 block min-h-[36px] w-full border border-border px-2 text-start text-[12.5px] hover:bg-accent disabled:opacity-40"
                        >
                          {m.libelle}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setACorriger(null)}
                        className="mt-1 text-[11.5px] text-text-2 underline underline-offset-2"
                      >
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setACorriger(p.id)}
                      className="mt-0.5 block text-[11.5px] text-text-2 underline underline-offset-2"
                    >
                      {t("pme.paiement.corriger")}
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-text-2">{t("pme.paiement.ajouter")}</p>

          {/*
           * ========================================== LE REÇU, QUAND IL A UN SENS
           *
           * Il n'apparaît qu'une fois un règlement inscrit, et seulement si la
           * lecture a tranché dépense ou revenu : un « reçu de dépense » posé
           * sur une vente est un document faux, et un document faux remis à un
           * tiers est pire qu'un document absent.
           */}
          {recuPossible ? (
            <button
              type="button"
              onClick={() => recu.mutate()}
              disabled={recu.isPending}
              className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 border border-foreground text-[13.5px] font-medium hover:bg-accent disabled:opacity-40"
            >
              <FileText className="h-[15px] w-[15px]" aria-hidden />
              {recu.isPending ? t("common.loading") : t("pme.recu.generer")}
            </button>
          ) : null}

          {/*
           * L'ERREUR SOUS LE GESTE QUI L'A PRODUITE.
           *
           * Elle s'affichait jusqu'ici tout en bas de la section, sous la
           * grille des huit moyens — environ deux cent vingt pixels plus
           * loin, donc hors de l'ecran. « Il ne se passe rien » voulait dire
           * « le message est en bas de page ».
           */}
          {erreur && erreurDe === "recu" ? (
            <p className="mt-1.5 text-[12.5px] text-signal-warn">{erreur}</p>
          ) : null}
          {recuEnAttente ? (
            <p className="mt-1.5 text-[12.5px] text-text-2">{t("pme.recu.enAttente")}</p>
          ) : null}

          {/*
           * CE QUI EST NE DE CETTE FACTURE.
           *
           * Sans cette liste, un recu produit, depose et lu restait
           * invisible sur l'ecran qui venait de le creer — et le dirigeant
           * concluait, a juste titre, que rien ne s'etait passe.
           */}
          {(joints.data ?? []).length > 0 ? (
            <ul className="mt-2 grid gap-px border border-border bg-border">
              {(joints.data ?? []).map((j) => (
                <li
                  key={j.id}
                  className="flex items-baseline justify-between gap-3 bg-card px-3 py-1.5"
                >
                  <span className="text-[12.5px]">{nomDuType(j.documentKind)}</span>
                  <span className="num shrink-0 text-[11.5px] text-text-2">
                    {j.createdAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-1.5 text-[13px] leading-[1.5] text-text-2">{t("pme.paiement.lede")}</p>
      )}

      {/*
       * ================================ TOTALITE OU PARTIE, ET COMBIEN RESTE
       *
       * L'ecran inscrivait toujours le TTC entier. La colonne acceptait
       * pourtant un acompte depuis le premier jour — personne ne pouvait le
       * saisir. On pose donc la question, et on propose par defaut ce qui
       * RESTE, jamais le total : c'est en reproposant le total entier qu'on
       * fabrique un doublon.
       */}
      {solde ? (
        <p className="mt-3 text-[12.5px] text-signal-ok">{t("pme.paiement.solde")}</p>
      ) : (
        <>
          {restantMineur !== null && payeMineur !== null && payeMineur > 0 ? (
            <p className="mt-3 flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="text-text-2">{t("pme.paiement.reste")}</span>
              <span className="num font-medium">{lisible(restantMineur)}</span>
            </p>
          ) : null}

          {partiel === null ? (
            <p className="mt-2 text-[13px] text-text-2">{t("pme.paiement.choisirMontant")}</p>
          ) : null}
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setPartiel(false)}
              aria-pressed={partiel === false}
              className={`min-h-[40px] border px-2 text-[12.5px] ${
                partiel === false ? "border-foreground font-medium" : "border-border"
              }`}
            >
              {t("pme.paiement.tout")}
            </button>
            <button
              type="button"
              onClick={() => setPartiel(true)}
              aria-pressed={partiel === true}
              className={`min-h-[40px] border px-2 text-[12.5px] ${
                partiel ? "border-foreground font-medium" : "border-border"
              }`}
            >
              {t("pme.paiement.partie")}
            </button>
          </div>

          {partiel ? (
            <label className="mt-1.5 block">
              <span className="text-[11.5px] text-text-2">{t("pme.paiement.combien")}</span>
              <input
                type="text"
                inputMode="decimal"
                value={montantSaisi}
                onChange={(e) => setMontantSaisi(e.target.value)}
                className="num mt-0.5 block min-h-[44px] w-full border border-border bg-card px-2.5 text-[14px]"
              />
            </label>
          ) : null}

          <label className="mt-1.5 block">
            <span className="text-[11.5px] text-text-2">{t("pme.paiement.quand")}</span>
            <input
              type="date"
              value={dateDuPaiement}
              max={aujourdHui}
              onChange={(e) => setDateDuPaiement(e.target.value || aujourdHui)}
              className="num mt-0.5 block min-h-[44px] w-full border border-border bg-card px-2.5 text-[14px]"
            />
          </label>

          {uneReferenceEstUtile ? (
            <label className="mt-1.5 block">
              <span className="text-[11.5px] text-text-2">{t("pme.paiement.reference")}</span>
              <input
                type="text"
                value={referenceSaisie}
                onChange={(e) => setReferenceSaisie(e.target.value)}
                className="num mt-0.5 block min-h-[44px] w-full border border-border bg-card px-2.5 text-[14px]"
              />
            </label>
          ) : null}
        </>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {(moyens.data ?? []).map((m) => (
          <button
            key={m.code}
            type="button"
            onClick={() => inscrire.mutate(m.code)}
            disabled={
              inscrire.isPending ||
              !historiquePret ||
              // Un montant partiel illisible n'inscrit rien : le bouton le dit
              // en restant eteint, plutot que de laisser la base refuser.
              (m.code !== "non_paye" && montantAInscrire === null) ||
              (exigeUneReference(m.code) && referenceSaisie.trim() === "")
            }
            className="min-h-[46px] border border-border px-2.5 text-[13.5px] font-medium hover:bg-accent disabled:opacity-40"
          >
            {m.libelle}
          </button>
        ))}
      </div>

      {erreur && erreurDe !== "recu" ? (
        <p role="alert" className="mt-2 text-[12.5px] text-signal-warn">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
