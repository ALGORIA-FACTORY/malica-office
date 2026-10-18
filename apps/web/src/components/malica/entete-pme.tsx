/**
 * La ligne du haut, commune à tous les écrans PME.
 *
 * =========================================================== POURQUOI ICI
 *
 * Elle vivait en deux exemplaires : celui de l'accueil — le sigle, la pastille
 * qui bat, le dossier, « changer d'espace », « FR · ⚙ » — et celui de la mise
 * en page, qui servait tous les autres écrans avec un sélecteur de langue
 * complet, sans sigle et sans pastille. Deux en-têtes veut dire deux
 * évolutions : celle qu'on retouche et celle qu'on oublie.
 *
 * L'accueil est la référence. Cet objet EST l'en-tête de l'accueil, extrait
 * tel quel ; l'accueil l'appelle comme les autres. Il n'en existe plus de
 * second à faire diverger.
 *
 * ==================================================== POURQUOI DES PROPRIÉTÉS
 *
 * La mise en page dessine l'en-tête AVANT d'entrer dans `PmeProvider` — le
 * contexte n'est pas encore posé à cet endroit de l'arbre. L'en-tête reçoit
 * donc ce qu'il affiche, il ne va pas le chercher.
 */
import { Link } from "@tanstack/react-router";

import { useI18n } from "@/i18n";

import { MarqueRg } from "./office-ui";

export interface EntetePmeProps {
  /** Les dossiers PME de la personne. Un seul : le sélecteur laisse la place. */
  dossiers: ReadonlyArray<{ id: string; name: string }>;
  dossierActif: string | null;
  choisirDossier: (id: string) => void;
  /** La bascule vers le cabinet n'existe que s'il y a un cabinet où aller. */
  aUnCabinet: boolean;
}

export function EntetePme({ dossiers, dossierActif, choisirDossier, aUnCabinet }: EntetePmeProps) {
  const { t, locale } = useI18n();

  /*
   * `flex-wrap` : a 320 px, les deux liens de droite et le selecteur ne
   * tiennent pas sur une seule ligne, et c'est le selecteur qui payait —
   * mesure 36 px de large. Plutot que de le laisser se reduire sous le
   * pouce, la ligne se coupe en deux et il prend la premiere. A 360 px et
   * au-dela, rien ne bouge : tout tient, la ligne reste unique.
   */
  return (
    <div className="relative flex flex-wrap items-center gap-[9px]">
      <MarqueRg aria-hidden className="h-[19px] w-[19px] flex-none" />
      <span className="rg-blink h-[5px] w-[5px] flex-none bg-marigold" />
      {/*
       * Le sélecteur de dossier prend la place de « je veille » quand il y a
       * plusieurs dossiers : les deux ne tiennent pas côte à côte sous 375 px,
       * et une PME — qui n'en a qu'un — ne voit jamais le premier.
       */}
      {/*
       * 44 px : le plancher d'Apple, et la feuille PME s'impose deja 34 pour
       * une simple pilule de filtre. Mesure avant : le selecteur faisait
       * 38 x 24 px a 320 et les deux liens 25 px de haut, colles au bord haut
       * de l'ecran — la ou le pouce arrive le plus mal. C'est par la qu'on
       * change de societe. La cible grandit, la police ne bouge pas.
       *
       * Et `max-w-[110px]` part : avec `min-w-0`, il reduisait le selecteur a
       * 38 px de large. Il prend maintenant la place disponible au lieu de la
       * refuser.
       */}
      {dossiers.length > 1 ? (
        <select
          aria-label={t("pme.org.switch")}
          value={dossierActif ?? ""}
          onChange={(e) => choisirDossier(e.target.value)}
          className="min-h-[44px] min-w-[4.5rem] flex-1 truncate border border-border bg-transparent px-1.5 text-[10px] uppercase tracking-wide focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {dossiers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="truncate text-[11px] text-muted-foreground">{t("pme.home.veille")}</span>
      )}
      <span className="ms-auto flex items-center gap-1.5">
        {aUnCabinet ? (
          <Link
            to="/office"
            className="inline-flex min-h-[44px] items-center whitespace-nowrap border border-border px-2 text-[10px] uppercase tracking-wide text-text-2 hover:bg-accent"
          >
            {t("portal.switch")}
          </Link>
        ) : null}
        {/*
         * « FR · ⚙ » mène aux réglages, où la langue ET le thème se changent.
         * Le sélecteur de langue complet qui vivait ici doublait ce que les
         * réglages font mieux, et il ne tenait pas dans la ligne du sigle.
         */}
        <Link
          to="/pme/reglages"
          // Le lecteur d'écran lisait « FR point engrenage » : le lien dit où il mène.
          aria-label={t("pme.reglages.titre")}
          className="inline-flex min-h-[44px] items-center whitespace-nowrap border border-border px-2 font-mono text-[10px] tracking-[0.06em] text-text-2 hover:bg-accent"
        >
          {locale.toUpperCase()} · ⚙
        </Link>
      </span>
    </div>
  );
}
