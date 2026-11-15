/**
 * « Gérer » — la fiche d'une PME dans la tour (2 novembre 2026).
 *
 * Ce qu'elle dit : son état, son offre, sa consommation, ses factures, sa
 * bibliothèque en nombres, et l'historique des gestes de la tour.
 *
 * Ce qu'elle fait : les SEULES interventions que la base porte aujourd'hui —
 * suspendre, reprendre (`plateforme.suspendre` / `reprendre`) et accorder des
 * lectures pour un mois (`plateforme.accorder_lectures`). Chacune exige un
 * motif ; la base refuse à qui n'est pas opérateur et inscrit le geste
 * (`plateforme.interventions`, ajout seul).
 *
 * Ce qu'elle ne montre PAS, et c'est voulu : changer d'offre, offrir des mois,
 * remiser, prolonger l'essai, rattacher. Leurs portes viennent avec le moteur
 * commercial ; un bouton sans porte serait un faux bouton.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useRef, useState } from "react";

import type { PmeDeLaTour } from "@malica/socle/ports/repositories";

import { useSuperposition } from "@/hooks/use-superposition";
import { useI18n, type MessageKey } from "@/i18n";
import { auQuota, etatDeLaPme } from "@/lib/clients-de-la-tour";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { montant, quantite } from "@/lib/lisible";
import { cn } from "@/lib/utils";
import { office } from "@/verticals/malica-office/composition";

import { CLE_CLIENTS, dateCourte } from "./donnees";
import { Consommation, FOCUS, PastilleDEtat } from "./ui";

const OU = "components/malica/tour/fiche-pme";

/** Les gestes, et leur libellé. Les actes historiques gardent le leur. */
const ACTES: Record<string, MessageKey> = {
  suspension: "tour.acte.suspension",
  reprise: "tour.acte.reprise",
  supplement_lectures: "tour.acte.supplement_lectures",
  remise_commerciale: "tour.acte.remise_commerciale",
  changement_offre: "tour.acte.changement_offre",
  note: "tour.acte.note",
};

type Geste = "suspendre" | "reprendre" | "lectures";

const GESTES: Record<Geste, { libelle: MessageKey; confirmer: MessageKey }> = {
  suspendre: { libelle: "tour.geste.suspendre", confirmer: "tour.geste.suspendre.confirmer" },
  reprendre: { libelle: "tour.geste.reprendre", confirmer: "tour.geste.reprendre.confirmer" },
  lectures: { libelle: "tour.geste.lectures", confirmer: "tour.geste.lectures.confirmer" },
};

/** Le mois en cours, « AAAA-MM », à l'heure du poste : un défaut que l'opérateur change. */
function moisEnCours(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function FicheDeLaPme({ pme, fermer }: { pme: PmeDeLaTour; fermer: () => void }) {
  const { t, locale } = useI18n();
  const panneau = useRef<HTMLElement | null>(null);
  useSuperposition(true, fermer, panneau);

  const n = { format: (v: number) => quantite(String(v), locale) };
  const lignes: Array<[MessageKey, React.ReactNode]> = [
    ["tour.col.cabinet", pme.cabinet_nom ?? t("tour.direct")],
    [
      "tour.fiche.payeur",
      t(pme.paye_par_cabinet ? "tour.fiche.payeur.cabinet" : "tour.fiche.payeur.direct"),
    ],
    ["tour.col.offre", pme.offre_libelle ?? "—"],
    [
      "tour.col.lectures",
      <Consommation key="c" lues={pme.lectures_consommees} droit={pme.lectures_droit} />,
    ],
    [
      "tour.col.echeance",
      <span key="e" className="num">
        {dateCourte(pme.echeance_le, locale)}
      </span>,
    ],
    [
      "tour.fiche.reste",
      <span key="r" className="num">
        {pme.reste_du && pme.devise_du && Number(pme.reste_du) > 0
          ? `${montant(pme.reste_du, locale)} ${pme.devise_du}`
          : "—"}
      </span>,
    ],
    [
      "tour.col.documents",
      <span key="d" className="num">
        {n.format(pme.documents)}
      </span>,
    ],
    [
      "tour.col.dernierDepot",
      <span key="dd" className="num">
        {dateCourte(pme.dernier_depot_le, locale)}
      </span>,
    ],
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={fermer}
        className="hidden flex-1 bg-foreground/25 sm:block"
      />
      <aside
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fiche-pme-titre"
        data-fiche-pme={pme.id}
        className="flex h-full w-full flex-col overflow-y-auto border-s border-border bg-background sm:w-[440px]"
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background px-5 py-3">
          <div className="min-w-0 flex-1 pt-1.5">
            <h2
              id="fiche-pme-titre"
              className="truncate text-[16px] font-semibold tracking-[-0.01em]"
            >
              {pme.nom}
            </h2>
            <p className="num truncate text-[11.5px] text-muted-foreground">
              <bdi>{pme.matricule ?? "—"}</bdi>
            </p>
          </div>
          <button
            type="button"
            onClick={fermer}
            aria-label={t("tour.fermer")}
            className={cn("-me-2 flex h-11 w-11 shrink-0 items-center justify-center", FOCUS)}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <PastilleDEtat etat={etatDeLaPme(pme)} />
            {auQuota(pme) ? (
              <span className="inline-flex h-6 items-center bg-etat-warn/10 px-2 text-[11.5px] font-medium text-etat-warn">
                {t("tour.filtre.au_quota")}
              </span>
            ) : null}
          </div>

          <dl className="divide-y divide-border border-y border-border">
            {lignes.map(([cle, valeur]) => (
              <div key={cle} className="flex min-h-11 items-center justify-between gap-4 py-2">
                <dt className="text-[12px] text-muted-foreground">{t(cle)}</dt>
                <dd className="min-w-0 truncate text-end text-[13px]">{valeur}</dd>
              </div>
            ))}
          </dl>

          {pme.licence_id ? (
            <Gerer pme={pme} licence={pme.licence_id} />
          ) : (
            <p className="text-[12.5px] text-muted-foreground">{t("tour.fiche.sansLicence")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Gerer({ pme, licence }: { pme: PmeDeLaTour; licence: string }) {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const suspendue = pme.statut === "suspendue";
  const gestes: Geste[] =
    pme.statut === "resiliee" ? ["lectures"] : [suspendue ? "reprendre" : "suspendre", "lectures"];
  const [voulu, setGeste] = useState<Geste>(gestes[0]!);
  // Après une suspension, « Suspendre » cède la place à « Reprendre ».
  const geste = gestes.includes(voulu) ? voulu : gestes[0]!;
  const [motif, setMotif] = useState("");
  const [nombre, setNombre] = useState("");
  const [mois, setMois] = useState(moisEnCours);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  const historique = useQuery({
    queryKey: ["tour-interventions", licence],
    queryFn: () => office().tour.interventions(licence),
  });

  const nombreValide = /^\d+$/.test(nombre.trim()) && Number(nombre) > 0;
  const pret = motif.trim() !== "" && (geste !== "lectures" || (nombreValide && mois !== ""));

  const agir = useMutation({
    mutationFn: () => {
      const tour = office().tour;
      if (geste === "suspendre") return tour.suspendre(licence, motif.trim());
      if (geste === "reprendre") return tour.reprendre(licence, motif.trim());
      return tour.accorderLectures(licence, Number(nombre), mois, motif.trim());
    },
    onSuccess: async () => {
      setRetour({ ok: true, texte: t("tour.fait") });
      setMotif("");
      setNombre("");
      await qc.invalidateQueries({ queryKey: CLE_CLIENTS });
      await qc.invalidateQueries({ queryKey: ["tour-interventions", licence] });
    },
    onError: (e: unknown) =>
      setRetour({ ok: false, texte: texteDeLErreur(e, OU, t("common.error")) }),
  });

  const champ =
    "h-11 w-full border border-border bg-card px-3 text-[13px] outline-none focus:border-foreground";

  return (
    <>
      <section aria-labelledby="gerer-titre" className="space-y-3">
        <h3 id="gerer-titre" className="text-[13px] font-semibold">
          {t("tour.gerer")}
        </h3>
        <div role="radiogroup" aria-label={t("tour.gerer")} className="flex flex-wrap gap-2">
          {gestes.map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={geste === g}
              onClick={() => {
                setGeste(g);
                setRetour(null);
              }}
              className={cn(
                "h-11 border px-3 text-[12.5px]",
                FOCUS,
                geste === g
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              {t(GESTES[g].libelle)}
            </button>
          ))}
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pret) agir.mutate();
          }}
        >
          {geste === "lectures" ? (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11.5px] text-muted-foreground">
                {t("tour.geste.nombre")}
                <input
                  inputMode="numeric"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  className={cn(champ, "num mt-1 text-foreground")}
                />
              </label>
              <label className="text-[11.5px] text-muted-foreground">
                {t("tour.geste.mois")}
                <input
                  type="month"
                  value={mois}
                  onChange={(e) => setMois(e.target.value)}
                  className={cn(champ, "num mt-1 text-foreground")}
                />
              </label>
            </div>
          ) : null}
          <label className="block text-[11.5px] text-muted-foreground">
            {t("common.motif")}
            <textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={2}
              required
              className="mt-1 w-full border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={!pret || agir.isPending}
            className={cn(
              "h-11 w-full bg-foreground px-4 text-[13px] font-medium text-background disabled:opacity-40",
              FOCUS,
            )}
          >
            {agir.isPending ? t("common.loading") : t(GESTES[geste].confirmer)}
          </button>
          {retour ? (
            <p
              role={retour.ok ? "status" : "alert"}
              className={cn("text-[12.5px]", retour.ok ? "text-etat-ok" : "text-etat-stop")}
            >
              {retour.texte}
            </p>
          ) : null}
        </form>
      </section>

      <section aria-labelledby="historique-titre" className="space-y-2">
        <h3 id="historique-titre" className="text-[13px] font-semibold">
          {t("tour.historique")}
        </h3>
        {historique.isPending ? (
          <p role="status" className="text-[12px] text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : (historique.data ?? []).length === 0 ? (
          <p className="text-[12px] text-muted-foreground">{t("tour.historique.vide")}</p>
        ) : (
          <ol className="divide-y divide-border border-y border-border">
            {(historique.data ?? []).map((g) => (
              <li key={g.id} className="py-2.5">
                <p className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="font-medium">
                    {ACTES[g.acte] ? t(ACTES[g.acte]!) : g.acte}
                    {g.acte === "supplement_lectures" && g.valeur ? (
                      <span className="num font-normal"> · +{Number(g.valeur)}</span>
                    ) : null}
                  </span>
                  <span className="num shrink-0 text-[11px] text-muted-foreground">
                    {dateCourte(g.le, locale)}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{g.motif}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
