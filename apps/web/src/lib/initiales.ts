/**
 * Les deux lettres d'une adresse ou d'un nom, pour un avatar sobre.
 *
 * « amine.bouzid@cabinet.tn » → « AB » ; « Leïla Ben Salah » → « LB » ;
 * « support » → « SU ». Jamais vide : une adresse sans lettre rend « — ».
 */
export function initialesDe(texte: string): string {
  const base = (texte.split("@")[0] ?? texte).trim();
  if (!base) return "—";
  const morceaux = base.split(/[.\s_-]+/).filter(Boolean);
  const lettres = morceaux.length >= 2 ? `${morceaux[0]![0]}${morceaux[1]![0]}` : base.slice(0, 2);
  return lettres.toUpperCase();
}
