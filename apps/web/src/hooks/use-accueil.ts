/**
 * Ce que l'accueil a le droit d'afficher.
 *
 * ============================================================ LA RÈGLE (R2)
 *
 * Aucun chiffre n'est fabriqué ici. La TVA vient de `computeTva`, le résultat
 * de `computePnl`, l'avancement d'un comptage de pièces réelles. Ce module
 * n'assemble que des entrées et invoque les moteurs — c'est exactement ce que
 * fait déjà `use-tva`, à une échelle plus large.
 *
 * Quand une donnée manque, la valeur est `null` et l'écran le dit. Il ne dit
 * jamais « 0,000 » à la place : zéro est un fait comptable, l'absence n'en est
 * pas un, et les confondre sur l'écran d'accueil d'un dirigeant est la pire
 * chose que ce produit puisse faire.
 *
 * ==================================================== POURQUOI UN SEUL APPEL
 *
 * La maquette montre douze mois de trajectoire. Douze requêtes donneraient
 * douze allers-retours pour un écran qui doit s'ouvrir en moins d'une seconde
 * sur un téléphone d'entrée de gamme. On charge donc UNE fenêtre de douze
 * mois, et on invoque le moteur douze fois sur des données déjà en mémoire :
 * les moteurs sont purs, cela ne coûte que du calcul.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { usePme } from "@/components/malica/pme-context";
import { useI18n } from "@/i18n";
import { useDecimales, useDecimalesEnEchec } from "./use-decimales";
import { usePiecesLues } from "./use-pieces-lues";
import { avancementDeLaListe } from "@/lib/lecture";
import { office } from "@/verticals/malica-office/composition";
import { tvaDesExtraits } from "@malica/socle/engines/tva/des-extraits";
import { useDeclarationsTva, useDeclarationsTvaEnEchec } from "./use-declaration-tva";
import { computePnl } from "@malica/socle";

import { moisDecale, moisGlissants } from "@malica/socle/exercice";

import { monthBounds } from "./use-tva";

/**
 * Douze mois : celui-ci et les onze qui précèdent.
 *
 * C'est la fenêtre de CALCUL, pas celle d'affichage — elle traverse le
 * changement d'exercice exprès, pour que janvier garde son comparatif.
 * `moisGlissants` du Socle en porte la définition et la raison.
 */
const FENETRE = 12;

/*
 * Plus exporté : l'accueil ne nomme plus ce type depuis que sa trajectoire
 * douze mois a laissé la place au dessin. Il reste employé ICI, par `Accueil`,
 * et un type non exporté reste atteignable du dehors par `Accueil["serie"]` —
 * rien n'est perdu, et `knip` cesse de signaler un export que personne ne lit.
 */
export interface MoisDeTva {
  /** « 2026-04 ». */
  periode: string;
  /** La TVA déductible du mois, ou null si le mois n'a rien à dire. */
  recuperee: string | null;
  /** La TVA collectée du mois, ou null si le mois n'a rien à dire. */
  collectee: string | null;
  /** Collectée moins déductible. Positif : à reverser. */
  solde: string | null;
  /** Les pièces du mois hors du calcul — un extrait illisible, un taux inconnu. */
  horsDuCalcul: number;
}

export interface Accueil {
  devise: string;
  /**
   * Le mois que montre la carte de TVA (`moisDeLaCarte`) : le plus récent de
   * la série qui a quelque chose à dire, jamais un mois à venir. Son solde est
   * ce qu'il restera à reverser à l'État (collectée moins déductible) :
   * positif, un décaissement à prévoir ; négatif, un crédit qui se reporte.
   * Ses pièces hors du calcul disent un chiffre incomplet, jamais écartées en
   * silence (Codex sur #140).
   */
  tva: MoisDeTva;
  /** L'écart avec le mois précédent, signé. `null` si l'un des deux manque. */
  ecart: string | null;
  /** Douze mois, du plus ancien au mois courant. */
  serie: MoisDeTva[];
  /** Combien de mois d'affilée la récupération progresse, mois courant inclus. */
  moisDeSuite: number;
  /** Part des pièces prises en charge par le cabinet, de 0 à 1. `null` : aucune pièce. */
  avancement: number | null;
  /**
   * Les pièces qui attendent une réponse DU DIRIGEANT : lues, dans la
   * société, ni envoyées ni gardées — « À envoyer ». Il ne confirme aucune
   * écriture (« Malica sans blocage », 28 octobre 2026).
   *
   * Ce n'est pas un compte par mois, et c'est voulu. Le 10 octobre, l'accueil
   * disait « Presque » à 0 % et « quelques factures » sans en connaître le
   * nombre. Compter ce qui attend une réponse est vrai, actionnable, et
   * n'oblige pas à choisir entre la date de la photo et celle de la facture —
   * un dossier n'a qu'une pile d'attente, pas une par mois.
   */
  enAttente: number;
  /** Les pièces LUES du dossier, et celles qui ne le sont pas encore. */
  documentsLus: number;
  documentsNonLus: number;
  /**
   * Vrai quand le dossier n'a JAMAIS reçu de pièce, tous mois confondus.
   *
   * Ce n'est pas « zéro ce mois-ci » : un dossier actif peut avoir un mois
   * creux. C'est la seule mesure qui autorise à montrer l'arrivée.
   */
  jamaisRienDepose: boolean;
  /**
   * L'écart de charges avec le mois précédent, en pourcentage signé.
   *
   * `null` quand l'un des deux mois n'a rien à dire : « en baisse de 100 % »
   * parce que le mois d'avant était vide n'est pas une baisse, c'est un trou.
   */
  chargesEcart: number | null;
  /** Les pièces que le cabinet a retournées, et qui attendent le dirigeant. */
  retournees: number;
  enCours: boolean;
  /**
   * Vrai tant que la carte de TVA ne sait pas encore quel mois montrer.
   *
   * Relevé le 4 novembre 2026 : pendant le chargement, la carte disait
   * « TVA · novembre — Solde TVA à confirmer », puis basculait sur
   * « TVA · février 142,130 Crédit de TVA ». La série vide retombait sur le
   * mois courant, et le dirigeant lisait une seconde un mois et un état faux.
   * L'écran reste neutre tant que ceci est vrai. Une lecture en échec n'est
   * plus « en cours » : la carte dit alors qu'elle ne sait pas, comme avant.
   */
  tvaEnCours: boolean;
}

/*
 * `moisPrecedent` vivait ici, identique ligne pour ligne à `moisDecale` du
 * Socle — lequel avait été écrit le 10 octobre EN NOMMANT ce fichier parmi
 * les trois qui portaient chacun leur propre fenêtre. Deux des trois ont été
 * corrigés le jour même ; celui-ci, nommément cité, était resté.
 */
const moisPrecedent = moisDecale;

/**
 * Le mois que la carte de TVA montre : le mois EN COURS, toujours — décision
 * du dirigeant, 4 novembre 2026. La carte montrait jusque-là le plus récent
 * mois « qui avait quelque chose à dire », et un dossier dont la dernière
 * pièce était de février affichait « TVA · février » en novembre : le chiffre
 * parlait d'un autre mois que celui qu'on vit. Un mois en cours encore vide
 * dit « à confirmer », il ne se remplace pas par un autre. La série s'arrête
 * au mois courant : son dernier mois est celui-là.
 */
export function moisDeLaCarte(serie: readonly MoisDeTva[]): MoisDeTva {
  return serie[serie.length - 1]!;
}

export function useAccueil(periode: string): Accueil {
  const pme = usePme();
  const devise = pme.currency;
  // Du pack, jamais d'une table de devises écrite en TypeScript (R4).
  const { locale } = useI18n();
  const decimalesDuPack = useDecimales();

  const debut = moisPrecedent(periode, FENETRE - 1);
  const { from } = monthBounds(debut);
  const { to } = monthBounds(periode);

  // La nature des classes du plan, lue au pack. Elle decide de ce qui EST une
  // charge : le moteur le testait sur le premier chiffre du code (R4).
  const classes = useQuery({
    queryKey: ["ref-classes", pme.packId],
    queryFn: () => office().referential.classesDeComptes(pme.packId!),
    enabled: Boolean(pme.packId),
    staleTime: 60 * 60 * 1000,
  });
  const extraits = useQuery({
    queryKey: ["accueil-extraits", pme.tenantId, from, to],
    queryFn: () => office().office.extraitsTransmis(pme.tenantId, from, to),
  });

  const taux = useQuery({
    // La langue entre dans la cle : les libelles des taux sont traduits, et
    // un cache commun aurait servi l arabe a un ecran francais.
    queryKey: ["tax-rates", pme.packId, locale],
    queryFn: () => office().referential.taxRates(pme.packId!, pme.jurisdiction, locale),
    enabled: !!pme.packId,
  });

  // La déclaration de CHAQUE mois de la série, en vigueur à sa fin : une
  // ligne datée ne vaut pas pour les mois d'avant (revue de #145).
  const finsDeMois = useMemo(
    () => moisGlissants(periode, FENETRE).map((p) => monthBounds(p).to),
    [periode],
  );
  const declarations = useDeclarationsTva(pme.packId, pme.tenantId, finsDeMois);
  // Une entrée du calcul en échec : la carte quitte son attente neutre.
  const declarationsEnEchec = useDeclarationsTvaEnEchec(pme.packId, pme.tenantId, finsDeMois);
  const decimalesEnEchec = useDecimalesEnEchec();
  const entreeEnEchec = declarationsEnEchec || decimalesEnEchec;

  // La PME ne voit jamais les écritures (lot S2) : l'accueil lit des TOTAUX
  // par mois et par classe du plan, jamais une ligne ni un compte. C'est tout
  // ce que la carte des charges montre — un pourcentage.
  const lignes = useQuery({
    queryKey: ["accueil-totaux", pme.tenantId, periode],
    queryFn: () => {
      // Deux mois d'un coup : la carte des charges compare, et une seconde
      // requête pour un seul pourcentage ne se justifie pas.
      const debut = monthBounds(moisPrecedent(periode, 1));
      const fin = monthBounds(periode);
      return office().office.totauxParClasse(pme.tenantId, debut.from, fin.to);
    },
  });

  // La liste avec ses faits de suivi : le statut se classe comme partout
  // ailleurs (`statutDeLaPieceLue`), jamais sur le statut brut.
  const pieces = usePiecesLues();

  // ------------------------------------------------------ la série de douze
  //
  // `lue` dit si les entrées du calcul sont TOUTES arrivées. Tant qu'elles ne
  // le sont pas, la série est vide et `moisDeLaCarte` retomberait sur le mois
  // courant : l'écran ne doit pas l'annoncer (voir `tvaEnCours`).
  const { serie, lue } = useMemo<{ serie: MoisDeTva[]; lue: boolean }>(() => {
    const mois: MoisDeTva[] = moisGlissants(periode, FENETRE).map((p) => ({
      periode: p,
      recuperee: null,
      collectee: null,
      solde: null,
      horsDuCalcul: 0,
    }));
    if (!extraits.data || !taux.data || !declarations || decimalesDuPack === null)
      return { serie: mois, lue: false };
    const decimales = decimalesDuPack;
    const tarifs = taux.data;

    /*
     * ================== LA TVA SE RANGE AU MOIS OÙ LE CABINET A REÇU LA PIÈCE
     *
     * Décision du commanditaire, 10 octobre 2026 : « le calcul de TVA dans le
     * dashboard serait imputé à la date de transmission au comptable, car le
     * comptable est censé la déclarer dans le mois courant ».
     *
     * Avant, deux dates se croisaient sans que personne le dise : la requête
     * sélectionnait sur la date d'ÉCRITURE, puis cette boucle regroupait sur
     * la date du DOCUMENT. Une facture de février comptabilisée en octobre
     * était retenue, puis rangée en février.
     *
     * Les charges, elles, restent rangées à la date de la FACTURE : c'est la
     * dépense, et elle appartient à son mois. Les deux lectures diffèrent
     * exprès, et chaque écran dit laquelle il montre.
     */
    const parMois = new Map<string, Array<{ pieceId: string; extract: unknown }>>();
    for (const ligne of extraits.data) {
      // Le mois d'imputation, la même règle que le cabinet (25 octobre 2026).
      const cle = ligne.imputeeLe.slice(0, 7);
      parMois.set(cle, [...(parMois.get(cle) ?? []), ligne]);
    }

    const calcules = mois.map((m) => {
      const dedans = parMois.get(m.periode);
      const declaration = declarations.get(monthBounds(m.periode).to);
      if (!dedans || dedans.length === 0 || !declaration) return m;
      // Le même calcul que l'écran de la TVA : un extrait illisible y est
      // refusé, et compté ici — jamais écarté en silence.
      const calcul = tvaDesExtraits({
        period: m.periode,
        currency: { code: devise, decimals: decimales },
        taux: tarifs,
        declaration,
        rows: dedans,
      });
      return {
        periode: m.periode,
        recuperee: calcul.totals.deductible,
        collectee: calcul.totals.collectee,
        solde: calcul.totals.solde,
        horsDuCalcul: calcul.refused.length,
      };
    });
    return { serie: calcules, lue: true };
  }, [extraits.data, taux.data, declarations, periode, devise, decimalesDuPack]);

  const courant = serie[serie.length - 1]?.recuperee ?? null;
  const precedent = serie[serie.length - 2]?.recuperee ?? null;

  const ecart = useMemo(() => {
    if (courant === null || precedent === null || decimalesDuPack === null) return null;
    const delta = Number(courant) - Number(precedent);
    return delta.toFixed(decimalesDuPack);
  }, [courant, precedent, decimalesDuPack]);

  // Combien de mois d'affilée la récupération progresse. Un mois sans donnée
  // coupe la série : on ne comble pas un trou par une hypothèse.
  const moisDeSuite = useMemo(() => {
    let compte = 0;
    for (let i = serie.length - 1; i > 0; i -= 1) {
      const ici = serie[i]!.recuperee;
      const avant = serie[i - 1]!.recuperee;
      if (ici === null || avant === null) break;
      if (Number(ici) <= Number(avant)) break;
      compte += 1;
    }
    return compte;
  }, [serie]);

  // ---------------------------------------------------- les charges, comparées
  //
  // Le moteur du compte de résultat sert deux fois, sur deux mois. Il ne rend
  // les charges qu'en creux — `resultat = produits − charges` — donc on lui
  // passe les lignes d'un mois à la fois et on lit ce qu'il en dit.
  const chargesEcart = useMemo(() => {
    if (!lignes.data || lignes.data.length === 0) return null;
    const avant = moisPrecedent(periode, 1);
    const chargesDe = (mois: string): number | null => {
      const duMois = lignes.data!.filter((l) => l.mois === mois);
      if (duMois.length === 0 || decimalesDuPack === null) return null;
      const pnl = computePnl({
        period: mois,
        currency: { code: devise, decimals: decimalesDuPack },
        // Une entrée par classe : son préfixe tient lieu de code, et le
        // moteur y reconnaît la classe elle-même (préfixe le plus long).
        entries: duMois.map((l) => ({
          account_code: l.classe,
          debit: l.debit,
          credit: l.credit,
        })),
        // Les libellés ne servent qu'au détail par compte, que l'accueil
        // n'affiche pas — et qu'il ne reçoit plus.
        coa: [],
        // La nature des classes, elle, décide de ce qui EST une charge : sans
        // elle le pourcentage serait calculé sur un total vide (R4).
        classes: classes.data ?? [],
      });
      return Number(pnl.charges);
    };
    const ici = chargesDe(periode);
    const la = chargesDe(avant);
    if (ici === null || la === null || la === 0) return null;
    return ((ici - la) / la) * 100;
  }, [lignes.data, periode, devise, decimalesDuPack, classes.data]);

  // ----------------------------------------------------------- l'avancement
  const { avancement, enAttente, documentsLus, documentsNonLus, jamaisRienDepose, retournees } =
    useMemo(() => {
      const liste = pieces.data ?? [];
      /*
       * ======================================= LES ÉTATS, ET CE QU'ILS VEULENT DIRE
       *
       * capturee                       déposée, pas encore lue
       * à envoyer · gardée             dans la société : la décision du dirigeant
       * prise en charge                le cabinet l'a validée ou forcée : close
       * retour                         le cabinet la renvoie
       *
       * Chaque état vient de `statutDeLaPieceLue`, sur les faits du suivi : une
       * pièce inscrite avant « Malica sans blocage » (encore `comptabilisee`)
       * est « Prise en charge » ici comme dans la liste.
       *
       * Le compte du mois, lui, a disparu d'ici : il était pris sur
       * `createdAt` — la date de la PHOTO — pendant que « Vos documents »
       * comptait par la date de la FACTURE. D'où « 1 » sur l'accueil et « 0 »
       * sur l'autre écran, le 10 octobre. Une seule définition, et elle vit
       * là où la date de la pièce est connue.
       */
      return avancementDeLaListe(liste);
    }, [pieces.data]);

  return {
    devise,
    tva: moisDeLaCarte(serie),
    ecart,
    serie,
    moisDeSuite,
    avancement,
    enAttente,
    documentsLus,
    documentsNonLus,
    jamaisRienDepose,
    chargesEcart,
    retournees,
    enCours: extraits.isPending || taux.isPending || lignes.isPending || pieces.isPending,
    tvaEnCours: !lue && !extraits.isError && !taux.isError && !entreeEnEchec,
  };
}
