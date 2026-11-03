/**
 * Le signaleur — ce que l'appareil a vécu, dit à l'API par lots.
 *
 * ============================================================== POURQUOI
 *
 * Novembre 2026, la facture MyTek : l'écran Android montrait un TTC faux, et
 * personne ne pouvait dire si la valeur servie par l'API était celle que
 * l'écran avait affichée. La capture, l'attente hors ligne, la
 * synchronisation et l'AFFICHAGE se passent sur l'appareil : sans lui, la
 * chronologie d'une pièce s'arrête à la réponse servie.
 *
 * ============================================================= LA RÈGLE
 *
 *   — rien ne bloque : `signaler` range et rend la main ; le lot part après un
 *     court délai, cinquante étapes au plus (`journal.etapes`) ;
 *   — hors ligne, le lot attend : il repart au retour du réseau ou au signal
 *     suivant, deux cents étapes au plus en mémoire. Au-delà, les plus
 *     anciennes cèdent, et ce n'est jamais silencieux : elles sont COMPTÉES,
 *     et le compte part en tête du lot suivant (une étape `perte`). Le lot en
 *     vol est à part : ce qui arrive pendant son envoi ne peut ni le
 *     raccourcir, ni être retiré à sa place ;
 *   — une même étape (trace, étape, clé) ne part qu'une fois par session ;
 *     l'API dédoublonne aussi, et compte un renvoi comme une répétition ;
 *   — jamais une photo, jamais un texte : des identifiants, la plateforme,
 *     des compteurs, et pour `affiche` les montants rendus à l'écran.
 */
import type { EtapeDeLAppareil } from "@malica/socle/ports/repositories";

import { CIBLE_COQUE, estInstallee, estNatif } from "@/capabilities/coque";
import { ErreurApi } from "@/lib/transport/erreurs";

import { retenirLaTrace, traceDe } from "./traces";

const LOT_MAX = 50;
const MEMOIRE_MAX = 200;
const DEJA_MAX = 500;

export type Plateforme = "android" | "pwa" | "web";

/** Où l'écran tourne : la coque Android, l'application installée (PWA), ou un onglet. */
export function plateforme(): Plateforme {
  if (CIBLE_COQUE && estNatif()) return "android";
  return estInstallee() ? "pwa" : "web";
}

export interface DependancesDuSignaleur {
  envoyer: (lot: readonly EtapeDeLAppareil[]) => Promise<unknown>;
  plateforme: () => Plateforme;
  nouvelleTrace: () => string;
  delaiMs?: number;
}

export interface Signaleur {
  /** Range une étape ; la plateforme s'ajoute à son détail. */
  signaler(etape: EtapeDeLAppareil): void;
  /**
   * L'écran a RÉELLEMENT montré ces valeurs pour cette pièce. Une fois par
   * rendu : les mêmes valeurs rendues de nouveau ne repartent pas.
   */
  signalerLAffichage(affichage: {
    piece: string;
    ecran: "pme" | "comptabilite";
    source: string;
    valeurs: Readonly<Record<string, string | null>>;
  }): void;
  /** Envoie ce qui attend ; rend quand l'envoi est fini (ou a échoué). */
  vider(): Promise<void>;
}

export function creerSignaleur(deps: DependancesDuSignaleur): Signaleur {
  const enAttente: EtapeDeLAppareil[] = [];
  const deja = new Set<string>();
  /** Les étapes qui ont cédé à la borne et ne sont pas encore dites. */
  let perdues = 0;

  const cleDe = (e: EtapeDeLAppareil) => `${e.trace}|${e.etape}|${e.cle}`;

  /**
   * La borne : les plus anciennes en attente cèdent, comptées. Leur clé est
   * oubliée, pour que la file hors ligne puisse les redire à la synchronisation.
   */
  function borner(): void {
    const surplus = enAttente.length - MEMOIRE_MAX;
    if (surplus <= 0) return;
    for (const e of enAttente.splice(0, surplus)) deja.delete(cleDe(e));
    perdues += surplus;
  }

  /** La perte comptée, dite comme une étape de l'appareil. */
  function etapeDePerte(nombre: number): EtapeDeLAppareil {
    const trace = deps.nouvelleTrace();
    return {
      trace,
      etape: "perte",
      issue: "erreur",
      cle: `perte:${trace}`,
      debut: new Date().toISOString(),
      detail: { nombre, raison: "memoire", plateforme: deps.plateforme() },
    };
  }
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  let envoi: Promise<void> | null = null;

  function planifier(): void {
    if (minuteur) return;
    minuteur = setTimeout(() => {
      minuteur = null;
      void vider();
    }, deps.delaiMs ?? 1500);
  }

  function vider(): Promise<void> {
    if (envoi) return envoi;
    if (minuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
    envoi = (async () => {
      while (enAttente.length > 0 || perdues > 0) {
        // Le lot en vol sort de la file : la borne ne touche que ce qui attend.
        const dites = perdues;
        perdues = 0;
        const tete = dites > 0 ? [etapeDePerte(dites)] : [];
        const enVol = enAttente.splice(0, LOT_MAX - tete.length);
        try {
          await deps.envoyer([...tete, ...enVol]);
        } catch (erreur) {
          // Un refus de l'API ne se rejoue pas ; un réseau absent, si — plus tard.
          if (erreur instanceof ErreurApi && erreur.statut < 500) continue;
          // Le lot revient en tête, la perte reste à dire ; la borne recompte.
          enAttente.unshift(...enVol);
          perdues += dites;
          borner();
          return;
        }
      }
    })().finally(() => {
      envoi = null;
    });
    return envoi;
  }

  function signaler(etape: EtapeDeLAppareil): void {
    const cle = cleDe(etape);
    if (deja.has(cle)) return;
    deja.add(cle);
    if (deja.size > DEJA_MAX) deja.delete(deja.values().next().value!);
    enAttente.push({ ...etape, detail: { ...etape.detail, plateforme: deps.plateforme() } });
    borner();
    if (enAttente.length >= LOT_MAX) void vider();
    else planifier();
  }

  return {
    signaler,
    vider,
    signalerLAffichage({ piece, ecran, source, valeurs }) {
      // La trace de la capture si l'appareil la connaît ; sinon une trace de
      // consultation, retenue pour la pièce : un nouveau rendu y retombe.
      let trace = traceDe(piece);
      if (!trace) {
        trace = deps.nouvelleTrace();
        retenirLaTrace([piece], trace);
      }
      const rendu = Object.values(valeurs)
        .map((v) => v ?? "-")
        .join("|");
      signaler({
        trace,
        etape: "affiche",
        issue: "ok",
        cle: `affiche:${ecran}:${rendu}`.slice(0, 100),
        debut: new Date().toISOString(),
        piece,
        detail: { ecran, source, ...valeurs },
      });
    },
  };
}
