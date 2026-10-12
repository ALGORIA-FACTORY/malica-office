/**
 * Le référentiel fiscal — porté depuis l'adaptateur Supabase, à l'identique.
 *
 * Mêmes vues, mêmes transformations, mêmes erreurs. Seul le transport change :
 * `db.query` au lieu de `supabase.from`. Les vues restent en `security_invoker`,
 * donc c'est toujours la RLS qui décide de ce qui remonte.
 *
 * R4 s'applique ici plus qu'ailleurs : aucun taux, compte ou seuil n'est écrit
 * dans ce fichier. Tout vient du pack, versionné par date d'effet.
 */

import type { Requete } from "../db.ts";

import { aujourdhui, dec as decStr } from "./decimal.ts";

export const referentiel = {
  /**
   * Les juridictions que le produit sait traiter, et leur devise.
   *
   * C'est la seule source : un écran qui propose « Tunisie » le fait parce
   * qu'un pack tunisien est en vigueur, pas parce que quelqu'un a écrit « TN »
   * dans un menu déroulant.
   */
  async juridictions(db: Requete) {
    const { rows } = await db.query(
      `select distinct on (jurisdiction) jurisdiction, currency, version
         from ref_packs_v
        where effective_from <= $1
        order by jurisdiction, effective_from desc`,
      [aujourdhui()],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      jurisdiction: r["jurisdiction"] as string,
      currency: r["currency"] as string,
      version: r["version"] as string,
    }));
  },

  async activePack(db: Requete, jurisdiction: string) {
    const { rows } = await db.query(
      `select id, jurisdiction, version, effective_from, ratified, currency
         from ref_packs_v
        where jurisdiction = $1 and effective_from <= $2
        order by effective_from desc
        limit 1`,
      [jurisdiction, aujourdhui()],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row["id"] as string,
      jurisdiction: row["jurisdiction"] as string,
      version: row["version"] as string,
      effectiveFrom: row["effective_from"] as string,
      ratified: Boolean(row["ratified"]),
      currency: row["currency"] as string,
    };
  },

  /**
   * Les taux de TVA du pack, traduits.
   *
   * Le libellé vient de `ref.labels`, pas de la colonne `label` de la table,
   * qui est FRANÇAISE. L'espace de noms `tva_rate` existait depuis le 24 août 2026
   * et aucun code ne le joignait : un écran en arabe affichait du français au
   * milieu de l'arabe, alors que la traduction était à côté. Le repli sur le
   * français est explicite — un libellé sans traduction s'affiche, il ne vide
   * pas l'écran.
   */
  async taxRates(db: Requete, packId: string, jurisdiction: string, locale = "fr") {
    const { rows } = await db.query(
      `select t.code, t.rate, t.valid_from, t.valid_to,
              coalesce(demandee.value, francais.value, t.label) as label
         from ref_tva_rates_v t
         left join ref_labels_v demandee
           on demandee.ns = 'tva_rate' and demandee.key = t.code and demandee.locale = $2
         left join ref_labels_v francais
           on francais.ns = 'tva_rate' and francais.key = t.code and francais.locale = 'fr'
        where t.pack_version_id = $1`,
      [packId, locale],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        code: row["code"] as string,
        label: (row["label"] as string) ?? (row["code"] as string),
        rate: decStr(row["rate"], 4),
        validFrom: row["valid_from"] as string,
        validTo: (row["valid_to"] as string | null) ?? null,
        jurisdiction,
      };
    });
  },

  async accountMappings(db: Requete, packId: string) {
    const { rows } = await db.query(
      `select document_kind, tax_code, main_account, vat_account, counterparty_account,
              journal_code
         from ref_account_mappings_v where pack_version_id = $1`,
      [packId],
    );
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        documentKind: row["document_kind"] as string,
        taxCode: (row["tax_code"] as string | null) ?? null,
        mainAccount: row["main_account"] as string,
        vatAccount: row["vat_account"] as string,
        counterpartyAccount: row["counterparty_account"] as string,
        // Le journal où l'écriture s'inscrit. Il était écrit en TypeScript —
        // « achat ? ACH : VEN » — et appartient au plan de l'organisation.
        journalCode: (row["journal_code"] as string | null) ?? null,
      };
    });
  },

  /**
   * Ce qu'est chaque classe du plan : charge, produit, actif, passif.
   *
   * Le moteur du compte de résultat testait `code.startsWith("6")`. C'est une
   * propriété du plan tunisien écrite dans le code du produit, et la première
   * juridiction qui numérote autrement aurait rendu un résultat VIDE — zéro
   * charge sur un mois qui en porte étant un chiffre parfaitement plausible.
   *
   * La reconnaissance se fait par préfixe, le plus long d'abord, ce qui couvre
   * aussi les comptes qu'un cabinet crée hors du plan livré.
   */
  async classesDeComptes(db: Requete, packId: string) {
    const jour = aujourdhui();
    const { rows } = await db.query(
      `select prefix, nature from ref_account_classes_v
        where pack_version_id = $1
          and valid_from <= $2
          and (valid_to is null or valid_to >= $2)
        order by length(prefix) desc, prefix`,
      [packId, jour],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      prefix: r["prefix"] as string,
      nature: r["nature"] as "charge" | "produit" | "actif" | "passif",
    }));
  },

  /**
   * Les droits et taxes hors TVA du pack, traduits.
   *
   * Le libellé vient de `ref.labels`, pas de la colonne `label` de la table,
   * qui est FRANÇAISE. L'espace de noms `fiscal_charge` existait depuis le 24 août 2026
   * et aucun code ne le joignait : un écran en arabe affichait du français au
   * milieu de l'arabe, alors que la traduction était à côté. Le repli sur le
   * français est explicite — un libellé sans traduction s'affiche, il ne vide
   * pas l'écran.
   */
  async fiscalCharges(db: Requete, packId: string, locale = "fr") {
    const jour = aujourdhui();
    const { rows } = await db.query(
      `select c.code, c.document_kind, c.account_code, c.fixed_amount,
              c.legal_reference, c.valid_from, c.valid_to,
              coalesce(demandee.value, francais.value, c.label) as label
         from ref_fiscal_charges_v c
         left join ref_labels_v demandee
           on demandee.ns = 'fiscal_charge' and demandee.key = c.code
          and demandee.locale = $3
         left join ref_labels_v francais
           on francais.ns = 'fiscal_charge' and francais.key = c.code
          and francais.locale = 'fr'
        where c.pack_version_id = $1 and c.valid_from <= $2`,
      [packId, jour, locale],
    );
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => !r["valid_to"] || (r["valid_to"] as string) >= jour)
      .map((r) => ({
        code: r["code"] as string,
        label: r["label"] as string,
        documentKind: r["document_kind"] as string,
        accountCode: r["account_code"] as string,
        fixedAmount:
          r["fixed_amount"] === null || r["fixed_amount"] === undefined
            ? null
            : decStr(r["fixed_amount"], 3),
        legalReference: (r["legal_reference"] as string | null) ?? null,
      }));
  },

  async socleParams(db: Requete, packId: string) {
    const { rows } = await db.query(
      `select code, value_text, value_num from ref_socle_params_v where pack_version_id = $1`,
      [packId],
    );
    const parCode = new Map<string, { text: string | null; num: unknown }>();
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      parCode.set(row["code"] as string, {
        text: (row["value_text"] as string | null) ?? null,
        num: row["value_num"],
      });
    }

    // Un paramètre absent lève, il ne retombe pas sur une valeur par défaut :
    // un pack incomplet doit se voir, pas produire un calcul plausible.
    const num = (code: string): number => {
      const v = parCode.get(code)?.num;
      if (v === null || v === undefined) {
        throw new Error(`Paramètre du Socle absent du pack : ${code}`);
      }
      return Number(v);
    };
    const text = (code: string): string => {
      const v = parCode.get(code)?.text;
      if (!v) throw new Error(`Paramètre du Socle absent du pack : ${code}`);
      return v;
    };

    const decimals = num("money.decimals");
    const methode = text("stock.methode");
    if (methode !== "cump" && methode !== "fifo") {
      throw new Error(`Méthode de stock inconnue au pack : ${methode}`);
    }
    return {
      packVersionId: packId,
      moneyDecimals: decimals,
      stockMethode: methode,
      stockQuantiteDecimals: num("stock.quantite_decimals"),
      rapprochementToleranceJours: num("rapprochement.tolerance_jours"),
      rapprochementToleranceMontant: num("rapprochement.tolerance_montant").toFixed(decimals),
    };
  },

  /**
   * Les types de document, traduits, avec le drapeau de ceux qu'on propose.
   *
   * ================================================================= POURQUOI
   *
   * La lecture partait en aveugle sur une invite de facture : un extrait
   * bancaire était lu comme une facture ratée plutôt que reconnu. Le type
   * décide de l'invite, et l'invite décide de la qualité — d'où une question
   * AVANT la lecture, et non une correction après.
   *
   * ============================================ POURQUOI SIX, ET PAS DIX-SEPT
   *
   * `ref.document_types` en porte dix-sept. Ils ne tiennent pas sur un écran
   * de téléphone, et choisir dans une liste de dix-sept est un autre genre
   * d'abandon. La colonne `propose_a_la_capture` dit lesquels se proposent ;
   * les autres restent atteignables ensuite, sur la pièce.
   *
   * ================================== POURQUOI TOUS, ET PAS SEULEMENT CES SIX
   *
   * Cette lecture ne rendait QUE les six, et le cabinet n'avait alors aucun
   * moyen de nommer les onze autres : un reçu de paiement joint à une facture
   * s'affichait « Document », parce que la seule lecture qui connaissait son
   * libellé le filtrait. Le drapeau descend donc avec les lignes, et c'est
   * l'écran de la photo qui filtre.
   *
   * ========================================== ET LE LIBELLÉ VIENT DE ref.labels
   *
   * Pas de la colonne `libelle`, qui est française. Le produit lit l'arabe :
   * un écran en arabe affichait « Facture d'achat » partout où une table de
   * référentiel portait un libellé, parce que six namespaces de `ref.labels`
   * existaient et qu'un seul était joint. Le repli sur le français est
   * explicite : un type sans traduction s'affiche, il ne disparaît pas.
   */
  async typesDeDocument(db: Requete, locale: string) {
    const { rows } = await db.query(
      `select d.code, d.famille, d.porte_ecriture, d.transmissible, d.propose_a_la_capture,
              coalesce(demandee.value, francais.value, d.libelle) as libelle
         from ref.document_types d
         left join ref_labels_v demandee
           on demandee.ns = 'document_type' and demandee.key = d.code
          and demandee.locale = $1
         left join ref_labels_v francais
           on francais.ns = 'document_type' and francais.key = d.code
          and francais.locale = 'fr'
        order by d.rang`,
      [locale],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["code"] as string,
      famille: r["famille"] as string,
      libelle: r["libelle"] as string,
      porteEcriture: Boolean(r["porte_ecriture"]),
      transmissible: Boolean(r["transmissible"]),
      proposeALaCapture: Boolean(r["propose_a_la_capture"]),
    }));
  },

  /**
   * Les mentions que le pack exige, TRADUITES.
   *
   * ================================================================= POURQUOI
   *
   * Le reçu de paiement les porte en pied, et c'est R4 en action : aucune
   * mention obligatoire n'est écrite dans le code, elle est lue au pack.
   *
   * Le namespace `mention` de `ref.labels` existait depuis le 24 août 2026 —
   * trois langues, chaque mention — et AUCUN code ne le joignait. Les
   * honoraires lisent encore la colonne `label`, qui est française : un reçu
   * en arabe aurait porté « Identifiant fiscal de l'émetteur ». Le repli sur
   * le français est explicite : une mention sans traduction s'affiche, elle
   * ne disparaît pas d'un document légal.
   */
  async mentionsDuPack(db: Requete, packId: string, locale: string) {
    const { rows } = await db.query(
      `select m.code, m.mandatory, m.legal_reference,
              coalesce(demandee.value, francais.value, m.label) as label
         from ref_mentions_v m
         left join ref_labels_v demandee
           on demandee.ns = 'mention' and demandee.key = m.code and demandee.locale = $2
         left join ref_labels_v francais
           on francais.ns = 'mention' and francais.key = m.code and francais.locale = 'fr'
        where m.pack_version_id = $1
        order by m.mandatory desc, m.code`,
      [packId, locale],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["code"] as string,
      label: r["label"] as string,
      mandatory: Boolean(r["mandatory"]),
      legalReference: (r["legal_reference"] as string | null) ?? null,
    }));
  },

  /**
   * Les moyens de paiement du pack, traduits, en vigueur à une date.
   *
   * ================================================================= POURQUOI
   *
   * Le référentiel a été posé le 11 octobre 2026 — huit moyens, leur compte
   * de trésorerie, vingt-quatre libellés traduits — et personne ne le lisait.
   * Pendant ce temps la même nomenclature vivait en dur dans deux écrans du
   * cabinet, trois fois plus pauvre : trois moyens au lieu de huit, et une
   * quatrième liste dans un commentaire de port qui inventait « carte ».
   *
   * C'est le motif récurrent de ce dépôt à l'état pur : l'outil est
   * construit, daté, traduit, commenté — et le consommateur ne l'importe pas.
   *
   * ======================================== POURQUOI UNE DATE, ET PAS « MAINTENANT »
   *
   * Un moyen de paiement a une date d'effet : un cabinet peut en retirer un,
   * et les pièces d'avant doivent garder celui qu'elles portaient. La date
   * est donc donnée par l'appelant — celle de la pièce — et non lue à
   * l'horloge (R11).
   */
  async moyensDePaiement(db: Requete, packId: string, locale: string, au: string) {
    const { rows } = await db.query(
      `select m.code, m.tresorerie_account, m.exige_justificatif, m.rang,
              coalesce(demandee.value, francais.value, m.libelle) as libelle
         from ref_payment_means_v m
         left join ref_labels_v demandee
           on demandee.ns = 'moyen_paiement' and demandee.key = m.code
          and demandee.locale = $2
         left join ref_labels_v francais
           on francais.ns = 'moyen_paiement' and francais.key = m.code
          and francais.locale = 'fr'
        where m.pack_version_id = $1
          and m.valid_from <= $3::date
          and (m.valid_to is null or m.valid_to >= $3::date)
        order by m.rang`,
      [packId, locale, au],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      code: r["code"] as string,
      libelle: r["libelle"] as string,
      tresorerieAccount: (r["tresorerie_account"] as string | null) ?? null,
      exigeJustificatif: Boolean(r["exige_justificatif"]),
    }));
  },
};
