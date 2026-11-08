/**
 * « Dans quel rayon ? » — planche 10, approuvée le 7 novembre 2026.
 *
 * Pour un papier gardé pour soi, à la place d'Achats / Ventes : des rayons à
 * soi. Un toucher sur un rayon range le lot ; un nom se donne avant, si on
 * veut. « Nouveau rayon » s'écrit sur place.
 */
import { useState } from "react";

import { useI18n } from "@/i18n";
import { RAYONS_PROPOSES } from "@/lib/rayons-prives";

export function RayonsPrives({
  aSoi,
  occupe,
  onChoisir,
  onSociete,
}: {
  /** Les rayons que la personne s'est déjà faits. */
  aSoi: readonly string[];
  occupe: boolean;
  onChoisir: (rayon: string, nom: string | null) => void;
  /** « Plutôt pour la société » : revenir au choix de la société. */
  onSociete: (() => void) | null;
}) {
  const { t } = useI18n();
  const [nom, setNom] = useState("");
  const [nouveau, setNouveau] = useState<string | null>(null);
  const choisir = (rayon: string) => {
    const r = rayon.trim();
    if (!r || occupe) return;
    onChoisir(r.slice(0, 40), nom.trim() ? nom.trim().slice(0, 80) : null);
  };

  return (
    <div className="rp">
      <p className="rp-sous">{t("pme.prive.pourMoi")}</p>
      <h1 className="c-titre">{t("pme.prive.rayon.titre")}</h1>
      <label className="rp-nom">
        <input
          type="text"
          value={nom}
          maxLength={80}
          placeholder={t("pme.prive.nom")}
          aria-label={t("pme.prive.nom")}
          onChange={(e) => setNom(e.target.value)}
        />
      </label>
      <div className="rp-grille">
        {RAYONS_PROPOSES.map((r) => (
          <button
            key={r.code}
            type="button"
            className="rp-tt"
            style={{ background: r.teinte }}
            disabled={occupe}
            onClick={() => choisir(r.code)}
          >
            <i aria-hidden>{t(r.libelle).slice(0, 1)}</i>
            <small>{t(r.sous)}</small>
            <b>{t(r.libelle)}</b>
          </button>
        ))}
        {aSoi.map((r) => (
          <button
            key={r}
            type="button"
            className="rp-tt"
            disabled={occupe}
            onClick={() => choisir(r)}
          >
            <i aria-hidden>{r.slice(0, 1).toLocaleUpperCase()}</i>
            <small>{t("pme.prive.rayon.aSoi")}</small>
            <b>{r}</b>
          </button>
        ))}
        {nouveau === null ? (
          <button type="button" className="rp-tt rp-nouveau" onClick={() => setNouveau("")}>
            <small>+</small>
            <b>{t("pme.prive.rayon.nouveau")}</b>
          </button>
        ) : (
          <form
            className="rp-tt rp-nouveau"
            onSubmit={(e) => {
              e.preventDefault();
              choisir(nouveau);
            }}
          >
            <input
              ref={(el) => el?.focus()}
              value={nouveau}
              maxLength={40}
              placeholder={t("pme.prive.rayon.nouveau")}
              aria-label={t("pme.prive.rayon.nouveau")}
              onChange={(e) => setNouveau(e.target.value)}
            />
            <button type="submit" disabled={!nouveau.trim() || occupe}>
              {t("pme.capture.continuer")}
            </button>
          </form>
        )}
      </div>
      {onSociete ? (
        <button type="button" className="rp-lien" onClick={onSociete}>
          {t("pme.prive.plutotSociete")}
        </button>
      ) : null}
    </div>
  );
}
