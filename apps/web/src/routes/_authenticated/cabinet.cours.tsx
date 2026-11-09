/**
 * Les cours de change du cabinet (31 octobre 2026).
 *
 * Une facture en devise se convertit au cours que la règle de change du
 * dossier désigne. Ce cours est une donnée : importé par l'exploitation pour
 * tous (l'officiel), ou saisi ici par le cabinet pour ses dossiers. À date
 * égale, l'officiel passe devant une saisie ; une DÉROGATION motivée du
 * cabinet passe devant l'officiel (`ref.rangs_des_cours`, revue de #148).
 * L'écran montre ceux que les dossiers du cabinet lisent, chacun avec son
 * origine, et en saisit un. Une correction s'ajoute (R7), motivée : la plus
 * récente fait foi, et les pièces en devise se rejugent à leur ouverture.
 *
 * Le geste le plus courant reste celui de la pièce (« Taux … à saisir »,
 * `components/malica/cours-de-change.tsx`) : même formulaire, même porte.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { useCabinet, useMalicaPanel } from "@/components/malica/cabinet-context";
import { FormulaireDuCours, type CoursAEnregistrer } from "@/components/malica/cours-de-change";
import { EmptyState, EnTeteCabinet, MalicaNote, SectionTitle } from "@/components/malica/office-ui";
import { useI18n } from "@/i18n";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import { dateEnChiffres, montant } from "@/lib/lisible";
import { office } from "@/verticals/malica-office/composition";

export const Route = createFileRoute("/_authenticated/cabinet/cours")({
  head: () => ({
    meta: [
      { title: "Cours de change — comptabilité — Malica Office" },
      {
        name: "description",
        content: "Les cours de change que lisent les dossiers de la comptabilité.",
      },
    ],
  }),
  component: CabinetCours,
});

const OU = "routes/_authenticated/cabinet.cours";

function CabinetCours() {
  const { t, locale } = useI18n();
  const { org } = useCabinet();
  const qc = useQueryClient();
  const [devise, setDevise] = useState("");
  const [vers, setVers] = useState(org.currency ?? "");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);

  useMalicaPanel(<MalicaNote>{t("cab.cours.malica")}</MalicaNote>, [locale]);

  const cours = useQuery({
    queryKey: ["cours-de-change", org.id, locale],
    queryFn: () => office().office.coursDeChange(org.id, locale),
  });

  const saisir = useMutation({
    mutationFn: (c: CoursAEnregistrer) =>
      office().office.saisirUnCours({
        orgId: org.id,
        devise,
        versDevise: vers,
        date,
        source,
        taux: c.taux,
        unite: c.unite,
        // Depuis cet écran, une dérogation vaut pour tout le cabinet ; celle
        // d'un seul dossier se fait depuis sa pièce.
        motif: c.derogation?.motif ?? null,
      }),
    onMutate: () => {
      setErreur(null);
      setEnregistre(false);
    },
    onSuccess: async () => {
      setEnregistre(true);
      await qc.invalidateQueries({ queryKey: ["cours-de-change", org.id] });
    },
    onError: (e: unknown) => setErreur(texteDeLErreur(e, OU, t("common.error"))),
  });

  const devises = cours.data?.devises ?? [];
  const sources = cours.data?.sources ?? [];
  const pret = Boolean(devise && vers && devise !== vers && date && source);
  const champ =
    "h-[48px] border border-border bg-background px-2 text-[14px] font-normal text-foreground";

  return (
    <div className="space-y-6">
      <EnTeteCabinet surtitre={t("cab.cours.surtitre")} titre={t("cab.cours.titre")} />

      <section className="space-y-3" aria-labelledby="cours-nouveau">
        <SectionTitle>
          <span id="cours-nouveau">{t("cab.cours.nouveau")}</span>
        </SectionTitle>
        <div className="grid gap-2.5 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
            {t("cab.cours.devise")}
            <select value={devise} onChange={(e) => setDevise(e.target.value)} className={champ}>
              <option value="">—</option>
              {devises.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
            {t("cab.cours.vers")}
            <select value={vers} onChange={(e) => setVers(e.target.value)} className={champ}>
              <option value="">—</option>
              {devises.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
            {t("cab.cours.date")}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={`num ${champ}`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
            {t("cab.cours.source")}
            <select value={source} onChange={(e) => setSource(e.target.value)} className={champ}>
              <option value="">—</option>
              {sources.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.nom}
                </option>
              ))}
            </select>
          </label>
        </div>
        {pret ? (
          <FormulaireDuCours
            devise={devise}
            vers={vers}
            enCours={saisir.isPending}
            portees={["cabinet"]}
            onEnregistrer={(c) => saisir.mutate(c)}
          />
        ) : null}
        {enregistre ? (
          <p role="status" className="text-[12.5px] font-medium text-signal-ok">
            {t("cab.cours.enregistre")}
          </p>
        ) : null}
        {erreur ? (
          <p role="alert" className="text-[12.5px] text-signal-stop">
            {erreur}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <SectionTitle>{t("cab.cours.titre")}</SectionTitle>
        {cours.isPending ? (
          <EmptyState>{t("common.loading")}</EmptyState>
        ) : cours.isError ? (
          <EmptyState>{texteDeLErreur(cours.error, OU, t("common.error"))}</EmptyState>
        ) : (cours.data?.cours ?? []).length === 0 ? (
          <EmptyState>{t("cab.cours.vide")}</EmptyState>
        ) : (
          <ul className="grid gap-px border border-border bg-border text-[13px]">
            {cours.data!.cours.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-2 gap-2 bg-card px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,2fr)]"
              >
                <span className="num">{dateEnChiffres(c.date, locale)}</span>
                <span className="num text-end sm:text-start" dir="ltr">
                  {t("cab.cours.applique", {
                    unite: String(c.unite),
                    devise: c.devise,
                    taux: montant(c.taux, locale),
                    vers: c.versDevise,
                    source: c.source,
                    date: dateEnChiffres(c.date, locale),
                  })}
                </span>
                <span
                  className="col-span-2 text-muted-foreground sm:col-span-1 sm:text-end"
                  dir="auto"
                >
                  {c.libelleOrigine}
                  {c.motif ? ` · ${c.motif}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
