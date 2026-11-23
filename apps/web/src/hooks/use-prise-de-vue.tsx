/**
 * La prise de vue — UN chemin pour photographier, quel que soit le papier.
 *
 * ================================================================= POURQUOI
 *
 * 23 novembre 2026, sur Android : la carte d'identification fiscale ouvrait
 * l'ancien écran de cadrage de la page (aperçu, équerres, « Cadrez la facture
 * entière »), quand les pièces ouvraient le scanner de l'appareil. Deux
 * caméras pour un même geste. « Je veux tous comme 2 » : il n'en reste qu'une,
 * ici, et les pièces comme la carte l'appellent.
 *
 * ================================================================= L'ORDRE
 *
 *   1. le scanner de l'appareil (ML Kit, VisionKit) — dans la coque ;
 *   2. notre cadrage (`CameraScanner`) — dans un navigateur, ou quand le
 *      téléphone n'a pas de scanner (pas de services Google, un émulateur) ;
 *   3. l'appareil photo natif (`surRepli`) — quand la page n'a pas de caméra
 *      (HTTP, permission refusée). La lecture qui suit est la même.
 *
 * Le hook ne sait pas ce qu'on photographie : il rend des pages, et l'écran
 * décide où elles vont — une pièce déposée, ou une carte lue.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { files } from "@/capabilities/files";
import { useSuperposition } from "@/hooks/use-superposition";

/*
 * Le cadrage du navigateur — détection, redressement, et un modèle qui se
 * télécharge — n'est chargé que si on l'ouvre. Dans la coque, il ne l'est
 * jamais : le scanner de l'appareil prend sa place.
 */
const CameraScanner = lazy(() =>
  import("@/components/malica/CameraScanner").then((m) => ({ default: m.CameraScanner })),
);

export interface SuiteDeLaPrise {
  /**
   * Les pages prises, dans l'ordre. `dejaCadrees` : le scanner de l'appareil
   * les a déjà redressées — on ne refait pas son travail.
   */
  surPages: (pages: Blob[], dejaCadrees: boolean) => void;
  /** Notre cadrage n'a pas de caméra : l'appareil photo natif prend le relais. */
  surRepli: () => void;
  /** Rien n'a été pris. Un abandon n'est pas une panne. */
  surAbandon?: () => void;
  /** Le nombre de pages que le scanner de l'appareil accepte (une carte : une). */
  pagesMax?: number;
}

export interface PriseDeVue {
  /** Ouvrir la caméra. */
  photographier: () => void;
  /** Notre cadrage, quand il est ouvert : l'écran le rend où il veut. */
  ecran: ReactNode;
}

export function usePriseDeVue(suite: SuiteDeLaPrise): PriseDeVue {
  const [cadrage, setCadrage] = useState(false);
  /*
   * Une référence et non une dépendance : le scanner de l'appareil rend la
   * main par une promesse, et c'est la suite COURANTE qu'il faut appeler à ce
   * moment-là — pas celle du rendu où l'on a appuyé.
   */
  const suiteRef = useRef(suite);
  useEffect(() => {
    suiteRef.current = suite;
  });

  const photographier = useCallback(() => {
    const natif = files.scannerDeLAppareil();
    if (!natif) {
      setCadrage(true);
      return;
    }
    void (async () => {
      let pages: Blob[];
      try {
        pages = await natif.capturer(suiteRef.current.pagesMax);
      } catch {
        /*
         * Un téléphone sans scanner rejette ici « Document scanner is not
         * supported ». L'erreur filait sans être prise, et le bouton ne
         * faisait rien. Notre cadrage prend le relais.
         */
        setCadrage(true);
        return;
      }
      if (pages.length > 0) suiteRef.current.surPages(pages, true);
      else suiteRef.current.surAbandon?.();
    })();
  }, []);

  /** Le cadrage fermé sans photo — son bouton, ou le retour d'Android. */
  const abandonner = useCallback(() => {
    setCadrage(false);
    suiteRef.current.surAbandon?.();
  }, []);
  useSuperposition(cadrage, abandonner);

  const ecran = cadrage ? (
    <Suspense fallback={null}>
      <CameraScanner
        onCancel={abandonner}
        onFallback={() => {
          setCadrage(false);
          suiteRef.current.surRepli();
        }}
        onDone={(pages) => {
          setCadrage(false);
          if (pages.length > 0) suiteRef.current.surPages(pages, false);
          else suiteRef.current.surAbandon?.();
        }}
      />
    </Suspense>
  ) : null;

  return { photographier, ecran };
}
