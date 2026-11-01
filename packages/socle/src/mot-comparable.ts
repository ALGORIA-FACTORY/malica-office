/**
 * Ce qui rend deux écritures d'un même mot comparables.
 *
 * Une OCR rend « fevrier » aussi souvent que « février » : refuser le premier
 * reviendrait à perdre la date pour un accent. On décompose donc, puis on
 * retire les marques — mais en DEUX plages, et c'est le piège qui a coûté un
 * test rouge : « أغسطس » décomposé donne « ا » suivi de U+0654, qui vit dans
 * le bloc arabe et non dans celui des diacritiques latins. Retirer seulement
 * U+0300–U+036F réunit « février » et « fevrier », et laisse « أوت » et
 * « اوت » distincts.
 *
 * Les marques arabes retirées couvrent aussi le tashkeel (U+064B–U+0652) :
 * une facture vocalisée se lit comme une facture qui ne l'est pas.
 *
 * Sert aux mots que la base fournit et que la pièce imprime : les noms de mois
 * (`normalizeDate`) et les mots d'un montant en lettres (`montant-en-lettres.ts`).
 */
export function comparable(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ؐ-ًؚ-ٰٟ]/g, "")
    .toLowerCase();
}
