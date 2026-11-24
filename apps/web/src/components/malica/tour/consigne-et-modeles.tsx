/**
 * Ce que l'assistant et le conseil cité partagent dans la tour : la consigne versionnée
 * et le réglage des modèles.
 *
 * La consigne vit en base (R10) : publier en crée une version nouvelle, datée et motivée ;
 * la précédente reste lisible. Le réglage sépare le modèle courant de celui des questions
 * difficiles ; chaque écran y ajoute ses champs propres. La base refuse un modèle sans tarif
 * en vigueur (R8) et toute valeur hors de ses bornes. Les libellés sont les clés que
 * l'écran nomme en entier : rien n'est écrit ici en dur, et chaque clé reste lisible
 * telle quelle dans le code (la recherche des clés que rien ne lit la trouve).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { useI18n } from "@/i18n";

import { ALERTE, BOUTON, CARTE, CHAMP, TEXTE, TITRE, useRetour } from "./commun";

/** Le préfixe des clés de messages d'un écran. */
type Prefixe = "tour.assistant" | "tour.conseilCite";

type Libelle =
  | "consigne"
  | "consigne.aide"
  | "consigne.enVigueur"
  | "consigne.borne"
  | "publier"
  | "reglage"
  | "reglage.aide"
  | "mois"
  | "modeleCourant"
  | "modeleDifficile"
  | "longueurDifficile"
  | "motsDifficiles"
  | "borne";

/** Les clés de messages d'un écran, chacune tenue d'être `${préfixe}.${libellé}`. */
export type Messages<P extends Prefixe> = { readonly [L in Libelle]: `${P}.${L}` };

/** Ce que la base rend d'un écran à consigne et à modèles. */
interface EtatDesModeles<R> {
  consignes: Array<{ texte: string; decide_le: string }>;
  reglage: R | null;
  modeles: string[];
  mois: { appels: number; cout: number };
}

/** Ce que la base rend du réglage commun aux deux écrans. */
interface ReglageLu {
  modele_courant: string;
  modele_difficile: string;
  longueur_difficile: number;
  mots_difficiles: string[];
}

/** Le réglage commun, tel qu'il part vers la base. */
interface ReglageCommun {
  modeleCourant: string;
  modeleDifficile: string;
  longueurDifficile: number;
  motsDifficiles: string[];
}

type CleCommune = "modeleCourant" | "modeleDifficile" | "longueurDifficile" | "motsDifficiles";

/** Les champs du réglage, tels que l'écran les saisit (en texte). */
type Saisie<K extends string> = Record<CleCommune | K, string>;

export const ENTIER = /^\d{1,5}$/;

/** Ce qu'un écran partage avec ses deux cartes : ses clés, sa requête et sa lecture. */
interface Ecran<R> {
  messages: Messages<Prefixe>;
  cle: readonly string[];
  lire: () => Promise<EtatDesModeles<R> | null>;
}

/** La consigne d'un écran — le prompt système, versionné en base (R10). */
export function LaConsigne<R>({
  messages,
  cle,
  lire,
  publier: envoyer,
  lignes,
}: Ecran<R> & {
  publier: (texte: string, motif: string) => Promise<unknown>;
  lignes: number;
}) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: cle, queryFn: lire });
  const enVigueur = etat.data?.consignes[0] ?? null;
  const [texte, setTexte] = useState("");
  const [motif, setMotif] = useState("");

  useEffect(() => {
    if (enVigueur) setTexte(enVigueur.texte);
  }, [enVigueur]);

  const publier = useMutation({
    mutationFn: () => envoyer(texte, motif),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: cle });
    },
    onError: echec,
  });

  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
      new Date(iso),
    );
  const assezLongue = texte.trim().length >= 200;

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t(messages["consigne"])}</h2>
      <p className={TEXTE}>{t(messages["consigne.aide"])}</p>
      {enVigueur ? (
        <p className={TEXTE}>
          {t(messages["consigne.enVigueur"], {
            date: date(enVigueur.decide_le),
            versions: String(etat.data?.consignes.length ?? 0),
          })}
        </p>
      ) : null}
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={lignes}
        aria-label={t(messages["consigne"])}
        className="w-full border border-border bg-background p-2 font-mono text-[12.5px] leading-[1.5]"
      />
      {!assezLongue ? <p className={ALERTE}>{t(messages["consigne.borne"])}</p> : null}
      <div className="flex flex-col gap-2">
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={
            publier.isPending ||
            motif.trim() === "" ||
            !assezLongue ||
            texte.trim() === enVigueur?.texte.trim()
          }
          onClick={() => publier.mutate()}
        >
          {t(messages["publier"])}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}

/** Ce qu'un écran reçoit pour dessiner ses champs propres. */
interface Outils<K extends string> {
  champ: (cle: K, libelle: string, mode: "numeric" | "decimal" | "text") => ReactNode;
  choix: (cle: K, libelle: string, valeurs: readonly string[]) => ReactNode;
}

/**
 * Le réglage des modèles d'un écran : le modèle courant, celui des questions difficiles et
 * la règle simple qui les sépare, puis les champs propres de l'écran.
 *
 * `saisir` doit être stable (déclaré hors du composant) : il relit le réglage à chaque
 * réponse de la base.
 */
export function LeReglageDesModeles<R extends ReglageLu, K extends string>({
  messages,
  cle,
  lire,
  saisir,
  valide: propresValides,
  regler: envoyer,
  propres,
}: Ecran<R> & {
  saisir: (r: R) => Record<K, string>;
  valide: (s: Saisie<K>) => boolean;
  regler: (commun: ReglageCommun, s: Saisie<K>, motif: string) => Promise<unknown>;
  propres: (outils: Outils<K>) => ReactNode;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const etat = useQuery({ queryKey: cle, queryFn: lire });
  const [s, setS] = useState<Saisie<K> | null>(null);
  const [motif, setMotif] = useState("");

  useEffect(() => {
    const r = etat.data?.reglage;
    if (!r) return;
    setS({
      modeleCourant: r.modele_courant,
      modeleDifficile: r.modele_difficile,
      longueurDifficile: String(r.longueur_difficile),
      motsDifficiles: r.mots_difficiles.join(", "),
      ...saisir(r),
    });
  }, [etat.data?.reglage, saisir]);

  const regler = useMutation({
    mutationFn: (v: Saisie<K>) =>
      envoyer(
        {
          modeleCourant: v.modeleCourant,
          modeleDifficile: v.modeleDifficile,
          longueurDifficile: Number(v.longueurDifficile),
          motsDifficiles: v.motsDifficiles
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
        },
        v,
        motif,
      ),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      setMotif("");
      await qc.invalidateQueries({ queryKey: cle });
    },
    onError: echec,
  });

  if (!s) {
    return (
      <div className={CARTE}>
        <h2 className={TITRE}>{t(messages["reglage"])}</h2>
      </div>
    );
  }

  const valide = ENTIER.test(s.longueurDifficile.trim()) && propresValides(s);
  const modeles = etat.data?.modeles ?? [];
  const champ = (cle: CleCommune | K, libelle: string, mode: "numeric" | "decimal" | "text") => (
    <label className={TEXTE} key={cle}>
      {libelle}
      <input
        value={s[cle]}
        onChange={(e) => setS({ ...s, [cle]: e.target.value })}
        inputMode={mode}
        aria-label={libelle}
        className={`${CHAMP} mt-1 w-full`}
      />
    </label>
  );
  const choix = (cle: CleCommune | K, libelle: string, valeurs: readonly string[]) => (
    <label className={TEXTE} key={cle}>
      {libelle}
      <select
        value={s[cle]}
        onChange={(e) => setS({ ...s, [cle]: e.target.value })}
        aria-label={libelle}
        className={`${CHAMP} mt-1 w-full`}
      >
        {[...new Set([s[cle], ...valeurs])].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t(messages["reglage"])}</h2>
      <p className={TEXTE}>{t(messages["reglage.aide"])}</p>
      {etat.data?.mois ? (
        <p className={TEXTE}>
          {t(messages["mois"], {
            appels: String(etat.data.mois.appels),
            cout: String(etat.data.mois.cout),
          })}
        </p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">
        {choix("modeleCourant", t(messages["modeleCourant"]), modeles)}
        {choix("modeleDifficile", t(messages["modeleDifficile"]), modeles)}
        {champ("longueurDifficile", t(messages["longueurDifficile"]), "numeric")}
        {champ("motsDifficiles", t(messages["motsDifficiles"]), "text")}
        {propres({ champ, choix })}
        {!valide ? <p className={ALERTE}>{t(messages["borne"])}</p> : null}
        <input
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t("common.motif")}
          aria-label={t("common.motif")}
          className={CHAMP}
        />
        <button
          type="button"
          className={BOUTON}
          disabled={regler.isPending || motif.trim() === "" || !valide}
          onClick={() => regler.mutate(s)}
        >
          {t("tour.enregistrer")}
        </button>
      </div>
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
