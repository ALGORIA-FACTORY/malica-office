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
import { useDecimales } from "./use-decimales";
import { office } from "@/verticals/malica-office/composition";
import { computePnl, computeTva } from "@malica/socle";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";

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

export interface MoisDeTva {
  /** « 2026-04 ». */
  periode: string;
  /** La TVA déductible du mois, ou null si le mois n'a rien à dire. */
  recuperee: string | null;
  /** Collectée moins déductible. Positif : à reverser. */
  solde: string | null;
}

export interface Accueil {
  devise: string;
  /** La TVA récupérée du mois courant. `null` : rien de comptabilisé. */
  recuperee: string | null;
  /** L'écart avec le mois précédent, signé. `null` si l'un des deux manque. */
  ecart: string | null;
  /** Douze mois, du plus ancien au mois courant. */
  serie: MoisDeTva[];
  /** Combien de mois d'affilée la récupération progresse, mois courant inclus. */
  moisDeSuite: number;
  /**
   * Ce qu'il restera à reverser à l'État : TVA collectée moins déductible.
   *
   * Positif, c'est un décaissement à prévoir ; négatif, un crédit qui se
   * reporte. C'est le seul chiffre de cet écran sur lequel un dirigeant doit
   * agir, et c'est pour cela qu'il vient en premier.
   */
  aReverser: string | null;
  /** Part des pièces du mois déjà comptabilisées, de 0 à 1. `null` : aucune pièce. */
  avancement: number | null;
  /**
   * Les pièces qui attendent une réponse DU DIRIGEANT : lues, et pas encore
   * confirmées.
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
}

/*
 * `moisPrecedent` vivait ici, identique ligne pour ligne à `moisDecale` du
 * Socle — lequel avait été écrit le 10 octobre EN NOMMANT ce fichier parmi
 * les trois qui portaient chacun leur propre fenêtre. Deux des trois ont été
 * corrigés le jour même ; celui-ci, nommément cité, était resté.
 */
const moisPrecedent = moisDecale;

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

  const lignes = useQuery({
    queryKey: ["accueil-lignes", pme.tenantId, periode],
    queryFn: () => {
      // Deux mois d'un coup : la carte des charges compare, et une seconde
      // requête pour un seul pourcentage ne se justifie pas.
      const debut = monthBounds(moisPrecedent(periode, 1));
      const fin = monthBounds(periode);
      return office().office.periodeLignes(pme.tenantId, debut.from, fin.to);
    },
  });

  const pieces = useQuery({
    queryKey: ["pieces", pme.tenantId],
    queryFn: () => office().capture.list(pme.tenantId),
  });

  // ------------------------------------------------------ la série de douze
  const serie = useMemo<MoisDeTva[]>(() => {
    const mois: MoisDeTva[] = moisGlissants(periode, FENETRE).map((p) => ({
      periode: p,
      recuperee: null,
      solde: null,
    }));
    if (!extraits.data || !taux.data || decimalesDuPack === null) return mois;
    const decimales = decimalesDuPack;

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
    const parMois = new Map<string, Array<{ item_id: string | null; extract: ExtractV1 }>>();
    for (const ligne of extraits.data) {
      const lu = ExtractV1.safeParse(ligne.extract);
      if (!lu.success) continue;
      const cle = ligne.transmiseLe.slice(0, 7);
      const liste = parMois.get(cle) ?? [];
      liste.push({ item_id: ligne.pieceId, extract: lu.data });
      parMois.set(cle, liste);
    }

    const tarifs = taux.data.map((r) => ({
      code: r.code,
      label: r.label,
      rate: r.rate,
      valid_from: r.validFrom,
      valid_to: r.validTo,
      jurisdiction: r.jurisdiction,
    }));

    return mois.map((m) => {
      const dedans = parMois.get(m.periode);
      if (!dedans || dedans.length === 0) return m;
      const calcul = computeTva({
        period: m.periode,
        currency: { code: devise, decimals: decimales },
        tax_rates: tarifs,
        achats: dedans.filter((e) => e.extract.document_kind !== "facture_vente"),
        ventes: dedans.filter((e) => e.extract.document_kind === "facture_vente"),
      });
      return {
        periode: m.periode,
        recuperee: calcul.totals.deductible,
        solde: calcul.totals.solde,
      };
    });
  }, [extraits.data, taux.data, periode, devise, decimalesDuPack]);

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
      const duMois = lignes.data!.filter((l) => l.dateEcriture.slice(0, 7) === mois);
      if (duMois.length === 0 || decimalesDuPack === null) return null;
      const pnl = computePnl({
        period: mois,
        currency: { code: devise, decimals: decimalesDuPack },
        entries: duMois.map((l) => ({
          account_code: l.accountCode,
          debit: l.debit,
          credit: l.credit,
        })),
        // Les libellés ne servent qu'au détail par compte, que l'accueil
        // n'affiche pas : on ne charge pas six cent vingt-six lignes pour un
        // seul pourcentage.
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
       * lue · proposee                 lue, et elle attend le dirigeant
       * confirmee                      il a répondu, le cabinet suit
       * comptabilisee · supervisee     close
       * retournee                      le cabinet la renvoie
       *
       * Le compte du mois, lui, a disparu d'ici : il était pris sur
       * `createdAt` — la date de la PHOTO — pendant que « Vos documents »
       * comptait par la date de la FACTURE. D'où « 1 » sur l'accueil et « 0 »
       * sur l'autre écran, le 10 octobre. Une seule définition, et elle vit
       * là où la date de la pièce est connue.
       */
      const lues = liste.filter((p) => p.status !== "capturee");
      const closes = liste.filter(
        (p) => p.status === "comptabilisee" || p.status === "supervisee",
      ).length;
      return {
        avancement: liste.length === 0 ? null : closes / liste.length,
        enAttente: liste.filter((p) => p.status === "lue" || p.status === "proposee").length,
        documentsLus: lues.length,
        documentsNonLus: liste.length - lues.length,
        jamaisRienDepose: liste.length === 0,
        retournees: liste.filter((p) => p.status === "retournee").length,
      };
    }, [pieces.data]);

  return {
    devise,
    recuperee: courant,
    ecart,
    serie,
    moisDeSuite,
    aReverser: serie[serie.length - 1]?.solde ?? null,
    avancement,
    enAttente,
    documentsLus,
    documentsNonLus,
    jamaisRienDepose,
    chargesEcart,
    retournees,
    enCours: extraits.isPending || taux.isPending || lignes.isPending || pieces.isPending,
  };
}
