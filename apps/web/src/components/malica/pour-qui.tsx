/**
 * « Pour qui ? » : la société — planche 5, approuvée le 7 novembre 2026.
 *
 * En recette, choisir la société au dépôt a demandé une soixantaine de crans
 * de molette dans une liste de 113 pastilles. Désormais :
 *
 *   [AF] ALGORIA FACTORY SUARL · Société ouverte          (Choisie)
 *   [ Une autre société : nom ou matricule…   ]
 *   RÉCENTES   les dernières ouvertes (la même liste que l'en-tête)
 *
 * La société ouverte est déjà choisie ; les autres se trouvent en tapant deux
 * lettres. Choisir une autre société l'OUVRE, comme les pastilles d'avant.
 * Avec une seule société, ce bloc n'existe pas (l'appelant ne le monte pas).
 */
import { useMemo, useState } from "react";

import { useI18n } from "@/i18n";
import { initialesDe, noterRecente, plier, recentes } from "@/lib/mes-societes";

interface Societe {
  id: string;
  name: string;
  matricule?: string | null;
}

const RECENTES_MONTREES = 3;
const TROUVEES_MONTREES = 30;

export function PourQuiSociete({
  societes,
  ouverte,
  onChoisir,
}: {
  societes: readonly Societe[];
  ouverte: string;
  onChoisir: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [cherche, setCherche] = useState("");
  // Lues une fois à l'ouverture de l'étape : la liste ne saute pas sous le doigt.
  const [dernieres] = useState(recentes);

  const parId = useMemo(() => new Map(societes.map((s) => [s.id, s])), [societes]);
  const courante = parId.get(ouverte);
  const q = plier(cherche.trim());
  const trouvees = useMemo(
    () =>
      q
        ? societes
            .filter(
              (s) =>
                s.id !== ouverte &&
                (plier(s.name).includes(q) || plier(s.matricule ?? "").includes(q)),
            )
            .sort((a, b) => a.name.localeCompare(b.name, locale))
        : [],
    [q, societes, ouverte, locale],
  );
  const recentesMontrees = dernieres
    .filter((id) => id !== ouverte)
    .map((id) => parId.get(id))
    .filter((s): s is Societe => !!s)
    .slice(0, RECENTES_MONTREES);

  const choisir = (id: string) => {
    noterRecente(id);
    setCherche("");
    onChoisir(id);
  };

  const contenu = (s: Societe, choisie: boolean) => (
    <>
      <span className="ini" aria-hidden>
        {initialesDe(s.name)}
      </span>
      <span className="bd">
        <b>{s.name}</b>
        <span>
          {choisie ? t("pme.capture.dest.ouverte") : null}
          {choisie && s.matricule ? " · " : null}
          {s.matricule ?? null}
        </span>
      </span>
      {choisie ? <em>{t("pme.capture.dest.choisie")}</em> : null}
    </>
  );
  const ligne = (s: Societe) => (
    <li key={s.id}>
      <button type="button" className="pq-so" onClick={() => choisir(s.id)}>
        {contenu(s, false)}
      </button>
    </li>
  );

  return (
    <div className="pq">
      {courante ? (
        <div className="pq-so choisie" aria-current="true">
          {contenu(courante, true)}
        </div>
      ) : null}
      <label className="pq-cherche">
        <svg viewBox="0 0 24 24" className="g" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={cherche}
          placeholder={t("pme.capture.dest.autre")}
          aria-label={t("pme.capture.dest.autre")}
          onChange={(e) => setCherche(e.target.value)}
        />
      </label>
      {q ? (
        trouvees.length > 0 ? (
          <ul>{trouvees.slice(0, TROUVEES_MONTREES).map((s) => ligne(s))}</ul>
        ) : (
          <p className="pq-rien">{t("pme.societes.aucune")}</p>
        )
      ) : recentesMontrees.length > 0 ? (
        <>
          <p className="pq-grp">{t("pme.societes.recentes")}</p>
          <ul>{recentesMontrees.map((s) => ligne(s))}</ul>
        </>
      ) : null}
    </div>
  );
}
