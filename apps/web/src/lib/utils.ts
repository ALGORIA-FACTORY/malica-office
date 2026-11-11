/**
 * La fusion des classes CSS — l'assistant que tous les écrans appellent pour habiller.
 *
 * `cn` accepte des classes conditionnelles et garde, quand deux classes Tailwind se
 * contredisent, la dernière : un composant peut ainsi proposer un style par défaut
 * que l'écran qui l'emploie redéfinit, sans que les deux s'additionnent.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
