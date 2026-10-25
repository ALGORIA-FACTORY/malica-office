import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";
import { texteDeLErreur } from "@/lib/erreur-lisible";
import {
  QualificationFiscaleSchema,
  type QualificationFiscale,
  type ContexteQualificationFiscale,
} from "@malica/socle/ports/qualification-fiscale";
import { ChoixFiscal, TexteFiscal } from "./configuration-fiscale";

type Affectation = Omit<QualificationFiscale["lignes"][number], "deduction"> & {
  deduction: QualificationFiscale["lignes"][number]["deduction"] | "";
};
const BOUTON = "min-h-[44px] rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40";
/** L'expert qualifie ; aucune valeur de taxe n'est saisie ni fabriquée dans l'écran. */
export function QualificationFiscalePiece({
  pieceId,
  cabinetId,
}: {
  pieceId: string;
  cabinetId: string;
}) {
  const { t } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const contexte = useQuery({
    queryKey: ["qualification-fiscale", pieceId],
    queryFn: () => office().office.contexteQualificationFiscale(pieceId),
    enabled: ouvert,
  });
  const acces = useQuery({
    queryKey: ["cab-acces", cabinetId],
    queryFn: () => office().acces.monAcces(cabinetId),
    enabled: ouvert,
  });
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        className="min-h-[44px] text-start text-sm font-semibold"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
      >
        {t("fq.title")}
      </button>
      {ouvert ? (
        contexte.isPending ? (
          <p role="status">{t("common.loading")}</p>
        ) : contexte.error ? (
          <p role="alert">
            {texteDeLErreur(contexte.error, "qualification.fiscale", t("fx.error"))}
          </p>
        ) : contexte.data ? (
          <Formulaire
            key={`${contexte.data.extractionId}/${contexte.data.profilVersionId}/${contexte.data.qualification?.id}/${contexte.data.dateLue}/${contexte.data.documentKind}`}
            c={contexte.data}
            pieceId={pieceId}
            expert={acces.data?.role === "expert"}
          />
        ) : null
      ) : null}
    </section>
  );
}
function Formulaire({
  c,
  pieceId,
  expert,
}: {
  c: ContexteQualificationFiscale;
  pieceId: string;
  expert: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = c.qualification;
  const sourceChangee = q !== null && q.extractionId !== c.extractionId;
  const perimee =
    !!q &&
    (sourceChangee ||
      q.profilVersionId !== c.profilVersionId ||
      q.documentKind !== c.documentKind ||
      (c.dateLue !== null && q.dateOperation !== c.dateLue));
  const [edition, setEdition] = useState(!q || perimee);
  const [date, setDate] = useState(c.dateLue ?? q?.dateOperation ?? "");
  const [contexte, setContexte] = useState<QualificationFiscale["contexte"]>(
    q?.contexte ?? "interieur",
  );
  const [qualite, setQualite] = useState<QualificationFiscale["qualiteOperateur"] | "">(
    q?.qualiteOperateur ?? "",
  );
  const [justification, setJustification] = useState(q?.justification ?? "");
  const nouveau = (i: number): Affectation => ({
    index: i,
    baseHt: c.lignes[i]?.baseProposee ?? "",
    compteCout: "",
    deduction:
      c.documentKind === "facture_vente"
        ? "deductible"
        : c.regimeTva === "non_assujetti"
          ? "non_deductible"
          : "",
    droits: c.droits.map((d) => ({
      code: d.code,
      assiette: "",
      referenceLegale: d.referenceLegale,
    })),
  });
  const [lignes, setLignes] = useState<Affectation[]>(
    !sourceChangee && q ? q.lignes : c.lignes.map((l) => nouveau(l.index)),
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);
  const candidat = {
    pieceId,
    extractionId: c.extractionId,
    profilVersionId: c.profilVersionId,
    precedentId: q?.id ?? null,
    documentKind: c.documentKind,
    dateOperation: date,
    contexte,
    qualiteOperateur: qualite,
    justification,
    lignes,
  };
  const valide = QualificationFiscaleSchema.safeParse(candidat);
  const sauver = useMutation({
    mutationFn: () =>
      office().office.qualifierFiscalite(QualificationFiscaleSchema.parse(candidat)),
    onSuccess: async () => {
      setErreur(null);
      setSucces(true);
      setEdition(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["qualification-fiscale", pieceId] }),
        qc.invalidateQueries({ queryKey: ["proposition", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece", pieceId] }),
        qc.invalidateQueries({ queryKey: ["piece-audit", pieceId] }),
      ]);
    },
    onError: (e) => {
      setErreur(texteDeLErreur(e, "qualification.fiscale", t("fx.error")));
      setSucces(false);
    },
  });
  const modifier = (i: number, p: Partial<Affectation>) =>
    setLignes((ls) => ls.map((l, n) => (n === i ? { ...l, ...p } : l)));
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted-foreground">{t("fq.hint")}</p>
      {perimee ? (
        <p role="alert" className="text-sm text-signal-warn">
          {t("fq.stale")}
        </p>
      ) : null}
      {expert && !edition ? (
        <button type="button" className={BOUTON} onClick={() => setEdition(true)}>
          {t("relation.modifier")}
        </button>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valide.success && !sauver.isPending) sauver.mutate();
        }}
      >
        <fieldset disabled={!expert || !edition || sauver.isPending} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <TexteFiscal
              type="date"
              label={t("fq.date")}
              value={date}
              onChange={setDate}
              required
            />
            <ChoixFiscal
              label={t("fq.context")}
              value={contexte}
              onChange={(v) => setContexte(v as typeof contexte)}
              options={[
                { value: "interieur", label: t("fq.interior") },
                { value: "importation", label: t("fq.import") },
                { value: "exportation", label: t("fq.export") },
              ]}
            />
            <ChoixFiscal
              label={t("fq.operator")}
              value={qualite}
              onChange={(v) => setQualite(v as typeof qualite)}
              required
              options={[
                { value: "", label: t("fx.unknown") },
                { value: "fabricant", label: t("fq.manufacturer") },
                { value: "importateur", label: t("fq.importer") },
                { value: "revendeur", label: t("fq.reseller") },
                { value: "prestataire", label: t("fq.service") },
                { value: "autre", label: t("fq.other") },
              ]}
            />
          </div>
          {lignes.map((l, n) => (
            <div key={n} className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {c.lignes[l.index]?.libelle} · {c.lignes[l.index]?.codeTva}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("fq.printed")} : {c.lignes[l.index]?.htLu ?? t("fx.unknown")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TexteFiscal
                  label={t("fq.base")}
                  value={l.baseHt}
                  onChange={(v) => modifier(n, { baseHt: v.replace(",", ".") })}
                  required
                />
                <ChoixFiscal
                  label={t("fq.account")}
                  value={l.compteCout}
                  onChange={(v) => modifier(n, { compteCout: v })}
                  required
                  options={[
                    { value: "", label: t("fx.unknown") },
                    ...c.comptes.map((p) => ({ value: p.code, label: `${p.code} · ${p.libelle}` })),
                  ]}
                />
                {c.documentKind === "facture_achat" ? (
                  <ChoixFiscal
                    label={t("fq.deduction")}
                    value={l.deduction}
                    required
                    onChange={(v) => modifier(n, { deduction: v as Affectation["deduction"] })}
                    options={[
                      { value: "", label: t("fx.unknown") },
                      { value: "deductible", label: t("fq.directYes") },
                      { value: "non_deductible", label: t("fq.directNo") },
                      ...(c.regimeTva === "partiel" && c.prorata !== null
                        ? [{ value: "prorata", label: `${t("fq.common")} · ${c.prorata} %` }]
                        : []),
                    ]}
                  />
                ) : null}
              </div>
              {l.droits.map((d, i) => (
                <div key={d.code} className="grid gap-3 sm:grid-cols-2">
                  <TexteFiscal
                    label={`${d.code} · ${t("fq.taxBase")}`}
                    value={d.assiette}
                    required
                    onChange={(v) =>
                      modifier(n, {
                        droits: l.droits.map((x, j) =>
                          j === i ? { ...x, assiette: v.replace(",", ".") } : x,
                        ),
                      })
                    }
                  />
                  <TexteFiscal
                    label={`${d.code} · ${t("fx.source")}`}
                    value={d.referenceLegale}
                    required
                    onChange={(v) =>
                      modifier(n, {
                        droits: l.droits.map((x, j) =>
                          j === i ? { ...x, referenceLegale: v } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={BOUTON}
                  onClick={() => setLignes((ls) => [...ls, { ...nouveau(l.index), baseHt: "" }])}
                >
                  {t("fq.split")}
                </button>
                {lignes.filter((x) => x.index === l.index).length > 1 ? (
                  <button
                    type="button"
                    className={BOUTON}
                    onClick={() => setLignes((ls) => ls.filter((_, i) => i !== n))}
                  >
                    {t("fq.remove")}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <TexteFiscal
            label={t("fq.justification")}
            value={justification}
            onChange={setJustification}
            required
          />
          {expert && edition ? (
            <button
              type="submit"
              className={`${BOUTON} bg-foreground text-background`}
              disabled={!valide.success}
            >
              {t("fq.save")}
            </button>
          ) : null}
        </fieldset>
      </form>
      {succes ? (
        <p role="status" className="text-sm text-signal-ok">
          {t("fq.saved")}
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-sm text-signal-stop">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
