/**
 * La voix avec Malica — planche 8, approuvée le 7 novembre 2026.
 *
 * Deux choses que le navigateur sait déjà faire, et rien d'autre :
 *   — écouter (`SpeechRecognition`) : la question dite devient le texte
 *     envoyé à Malica, par le même appel que le clavier ;
 *   — lire à voix haute (`speechSynthesis`) la réponse d'une question posée
 *     à la voix.
 *
 * « Que ce qui existe » : là où l'appareil ne sait pas écouter (certaines
 * coques Android, Firefox), le micro ne s'affiche pas. Un bouton qui ne fait
 * rien se tape une fois, pas deux.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface ResultatDeDictee {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface EvenementDeDictee {
  readonly resultIndex: number;
  readonly results: ArrayLike<ResultatDeDictee>;
}
interface Dictee {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: EvenementDeDictee) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type ConstructeurDeDictee = new () => Dictee;

function constructeur(): ConstructeurDeDictee | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstructeurDeDictee;
    webkitSpeechRecognition?: ConstructeurDeDictee;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** La langue parlée, au format que le navigateur attend. */
function langueParlee(locale: string): string {
  if (locale.startsWith("ar")) return "ar-TN";
  if (locale.startsWith("en")) return "en-US";
  return "fr-FR";
}

export function useVoix(locale: string) {
  const [ecoute, setEcoute] = useState(false);
  const [entendu, setEntendu] = useState("");
  const [parle, setParle] = useState(false);
  const dictee = useRef<Dictee | null>(null);
  const [disponible, setDisponible] = useState(false);

  // Lu après le montage : le rendu serveur ne connaît pas le navigateur.
  useEffect(() => setDisponible(constructeur() !== null), []);

  useEffect(
    () => () => {
      dictee.current?.abort();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    },
    [],
  );

  const ecouter = useCallback(() => {
    const C = constructeur();
    if (!C) return;
    window.speechSynthesis?.cancel();
    setParle(false);
    const d = new C();
    d.lang = langueParlee(locale);
    d.interimResults = true;
    d.continuous = false;
    d.onresult = (e) => {
      let texte = "";
      for (let i = 0; i < e.results.length; i += 1) texte += e.results[i]![0].transcript;
      setEntendu(texte);
    };
    d.onend = () => setEcoute(false);
    d.onerror = () => setEcoute(false);
    dictee.current = d;
    setEntendu("");
    setEcoute(true);
    d.start();
  }, [locale]);

  /** Arrêter d'écouter ; ce qui a été entendu reste dans `entendu`. */
  const arreter = useCallback(() => {
    dictee.current?.stop();
    setEcoute(false);
  }, []);

  const annuler = useCallback(() => {
    dictee.current?.abort();
    setEcoute(false);
    setEntendu("");
  }, []);

  /** Lire une réponse à voix haute, si l'appareil sait le faire. */
  const lire = useCallback(
    (texte: string) => {
      const s = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!s || typeof SpeechSynthesisUtterance === "undefined") return;
      s.cancel();
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = langueParlee(locale);
      u.onend = () => setParle(false);
      u.onerror = () => setParle(false);
      setParle(true);
      s.speak(u);
    },
    [locale],
  );

  const taire = useCallback(() => {
    window.speechSynthesis?.cancel();
    setParle(false);
  }, []);

  return { disponible, ecoute, entendu, parle, ecouter, arreter, annuler, lire, taire };
}
