/**
 * Le journal des pannes, dans la tour — pour tous les utilisateurs (le dirigeant, 23 novembre
 * 2026 : « sur la tour uniquement je dois voir ces problèmes et ce journal »).
 *
 * « Ce qui n'a pas marché » a quitté les Réglages de l'application : le client garde
 * « Signaler un problème », et ses refus lui sont dits au moment du geste. Ici, l'opérateur
 * lit tout, du plus récent : les pannes consignées dans un dossier, et les traces hors
 * dossier (panne d'écran, plantage, signalement d'une personne). Un dossier se marque
 * « tout est réglé » : rien n'est effacé (R7), la liste ne montre plus que ce qui suit.
 * La base ne rend ce journal qu'à l'opérateur (`tour.pannes`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

import { BOUTON, CARTE, TEXTE, TITRE, useRetour } from "./commun";

const CLE = ["tour-pannes"] as const;

export function LeJournalDesPannes() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const { retour, setRetour, echec } = useRetour();
  const pannes = useQuery({ queryKey: CLE, queryFn: () => office().tour.pannes() });
  const regler = useMutation({
    mutationFn: (tenantId: string) => office().tour.reglerLesPannes(tenantId),
    onSuccess: async () => {
      setRetour(t("tour.fait"));
      await qc.invalidateQueries({ queryKey: CLE });
    },
    onError: echec,
  });
  const quand = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  const lignes = pannes.data ?? [];
  // Un seul « tout est réglé » par dossier : sur sa panne la plus récente.
  const premieres = new Set(
    lignes
      .filter((p) => p.source === "dossier" && p.tenant_id)
      .map((p) => p.tenant_id)
      .map((id) => lignes.find((p) => p.tenant_id === id && p.source === "dossier")!.id),
  );

  return (
    <div className={CARTE}>
      <h2 className={TITRE}>{t("tour.pannes")}</h2>
      <p className={TEXTE}>{t("tour.pannes.sous")}</p>
      {pannes.isSuccess && lignes.length === 0 ? (
        <p className={TEXTE}>{t("tour.pannes.aucune")}</p>
      ) : null}
      {lignes.map((p) => (
        <div key={`${p.source}-${p.id}`} className="border-t border-border pt-2" data-panne={p.id}>
          {/* Le message technique tel quel : la tour est l'outil des opérateurs, pas du client. */}
          <p className="break-words text-[13px] font-medium">{p.message}</p>
          <p className={TEXTE}>
            {t(`tour.pannes.source.${p.source}`)} · {p.societe ?? t("tour.pannes.horsDossier")}
            {" · "}
            {quand.format(new Date(p.at))}
          </p>
          <p className={`${TEXTE} break-all`}>
            {p.ou}
            {p.version ? ` · ${p.version}` : ""}
            {p.plateforme ? ` · ${p.plateforme}` : ""}
          </p>
          {premieres.has(p.id) && p.tenant_id ? (
            <button
              type="button"
              className={`${BOUTON} mt-1`}
              disabled={regler.isPending}
              onClick={() => regler.mutate(p.tenant_id!)}
            >
              {t("tour.pannes.regler", { societe: p.societe ?? "—" })}
            </button>
          ) : null}
        </div>
      ))}
      {retour ? (
        <p className={TEXTE} aria-live="polite">
          {retour}
        </p>
      ) : null}
    </div>
  );
}
