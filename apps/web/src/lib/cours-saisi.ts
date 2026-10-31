/**
 * Un cours de change tapé à l'écran, relu comme la base le reçoit
 * (31 octobre 2026) : un taux décimal positif, écrit dans la langue de la
 * personne (« 3,3456 »), pour une unité qui est une puissance de dix (1, 10,
 * 100…). Ce qui ne se relit pas vaut `null` : le bouton reste éteint, rien
 * n'est deviné. La base refait le contrôle (`cours_de_change_saisir`).
 */
import { saisieDecimale } from "@malica/socle/saisie-decimale";

export function coursSaisi(taux: string, unite: string): { taux: string; unite: number } | null {
  const lu = saisieDecimale(taux);
  if (lu === null || !/^\d+(\.\d+)?$/.test(lu) || !/[1-9]/.test(lu)) return null;
  if (!/^10*$/.test(unite.trim())) return null;
  return { taux: lu, unite: Number(unite.trim()) };
}
