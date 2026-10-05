/**
 * Les droits hors TVA d'une pièce, rendus lisibles.
 *
 * ================================================================= POURQUOI
 *
 * Le 4 octobre 2026, une facture de loyer portait un droit de timbre de
 * 1,000 dinar. Il a été désigné, relu, stocké — et l'écran ne l'a jamais
 * montré. Le diagnostic a trouvé pourquoi : dans `pme.piece.$pieceId.tsx`, la
 * chaîne `other_charges` apparaissait EXACTEMENT UNE FOIS, à la ligne 76, dans
 * la déclaration de type. Jamais lue, jamais parcourue, jamais rendue.
 *
 * Un champ typé mais jamais affiché ne casse aucune compilation : c'est pour
 * cela que ce défaut a survécu, et c'est pour cela que cette fonction est pure
 * et testée plutôt que fondue dans le JSX.
 *
 * ==================================================== LE LIBELLÉ VIENT DU PACK
 *
 * L'extraction ne porte que le CODE du droit (`DROIT_TIMBRE`) : son libellé et
 * sa référence légale vivent dans `ref.fiscal_charges`, datés et versionnés.
 * On les lit donc là (R4 : aucune constante réglementaire dans le code), et la
 * référence légale est rendue avec le montant — le produit doit pouvoir dire
 * de quel texte un chiffre vient.
 *
 * Un code que le pack ne connaît pas n'est pas traduit en douce : il est rendu
 * tel quel, `connu: false`, pour que l'écran le dise. Afficher « DROIT_TIMBRE »
 * sans avertir serait le même défaut que le `ISSUER` du 4 octobre — un
 * identifiant machine présenté comme un libellé.
 */

export interface DroitDeLaPiece {
  /** Le code du droit, tel que la lecture l'a désigné. */
  code: string;
  /** Le libellé du pack, ou le code lui-même quand le pack l'ignore. */
  libelle: string;
  /** Le montant lu sur la pièce, tel quel : cette fonction ne formate pas. */
  montant: string;
  /** L'article qui fonde ce droit, quand le pack le porte. */
  reference: string | null;
  /** Faux quand le pack ne connaît pas ce code : l'écran doit le signaler. */
  connu: boolean;
}

export function droitsDeLaPiece(
  droits: ReadonlyArray<{ code: string; amount: string }> | null | undefined,
  referentiel: ReadonlyArray<{ code: string; label: string; legalReference: string | null }>,
): DroitDeLaPiece[] {
  if (!droits || droits.length === 0) return [];
  /*
   * Le pack peut porter plusieurs versions d'un même code (dates d'effet
   * successives). Le dépôt ne rend que celles en vigueur ce jour, mais rien ne
   * garantit l'unicité : on retient la PREMIÈRE et on ne choisit pas entre
   * deux libellés, ce qui serait arbitraire.
   */
  const parCode = new Map<string, { label: string; legalReference: string | null }>();
  for (const r of referentiel) {
    if (!parCode.has(r.code)) parCode.set(r.code, r);
  }

  return droits.map((d) => {
    const connu = parCode.get(d.code);
    return {
      code: d.code,
      libelle: connu?.label?.trim() ? connu.label : d.code,
      montant: d.amount,
      reference: connu?.legalReference ?? null,
      connu: Boolean(connu?.label?.trim()),
    };
  });
}
