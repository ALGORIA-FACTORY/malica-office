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

  return (
    <div className="relative flex items-center gap-[9px]">
      <MarqueRg aria-hidden className="h-[19px] w-[19px] flex-none" />
      <span className="rg-blink h-[5px] w-[5px] flex-none bg-marigold" />
      {/*
       * Le sélecteur de dossier prend la place de « je veille » quand il y a
       * plusieurs dossiers : les deux ne tiennent pas côte à côte sous 375 px,
       * et une PME — qui n'en a qu'un — ne voit jamais le premier.
       */}
      {dossiers.length > 1 ? (
        <select
          aria-label={t("pme.org.switch")}
          value={dossierActif ?? ""}
          onChange={(e) => choisirDossier(e.target.value)}
          className="min-w-0 max-w-[110px] truncate border border-border bg-transparent px-1.5 py-1 text-[10px] uppercase tracking-wide focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
            className="whitespace-nowrap border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-text-2 hover:bg-accent"
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
          className="whitespace-nowrap border border-border px-2 py-1 font-mono text-[10px] tracking-[0.06em] text-text-2 hover:bg-accent"
        >
          {locale.toUpperCase()} · ⚙
        </Link>
      </span>
    </div>
  );
}
