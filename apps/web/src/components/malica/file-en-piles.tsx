/**
 * La file du cabinet en piles (maquette « Malica Comptabilité », approuvée le
 * 8 novembre 2026). Relevé sur staging : 109 lignes à plat, 41,6 écrans à
 * faire défiler sur un téléphone de 320 px. Une pile dit ce qu'il y a à faire,
 * et s'ouvre par client et fournisseur. Le détail d'un groupe se déplie.
 */
import type { QueueItem } from "@malica/socle/ports/repositories";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n, type MessageKey } from "@/i18n";
import { groupesDeLaPile, pileDe, PILES, type PileDeLaFile } from "@/lib/file-cabinet";
import { montant } from "@/lib/lisible";

const TITRE: Record<PileDeLaFile, MessageKey> = {
  pretes: "cab.pile.pretes",
  a_completer: "cab.pile.a_completer",
  retournees: "cab.pile.retournees",
  lecture: "cab.pile.lecture",
  prises: "cab.pile.prises",
};
const AIDE: Record<PileDeLaFile, MessageKey> = {
  pretes: "cab.pile.pretes.aide",
  a_completer: "cab.pile.a_completer.aide",
  retournees: "cab.pile.retournees.aide",
  lecture: "cab.pile.lecture.aide",
  prises: "cab.pile.prises.aide",
};

export function FileEnPiles({ rows }: { rows: QueueItem[] }) {
  const { t, locale } = useI18n();
  const piles = useMemo(
    () =>
      PILES.map((code) => ({ code, pieces: rows.filter((r) => pileDe(r) === code) })).filter(
        (p) => p.pieces.length > 0,
      ),
    [rows],
  );
  // La première pile utile s'ouvre : c'est le travail du moment.
  const [ouverte, setOuverte] = useState<PileDeLaFile | null | undefined>(undefined);
  const active = ouverte === undefined ? (piles[0]?.code ?? null) : ouverte;
  const [groupe, setGroupe] = useState<string | null>(null);

  return (
    <div className="space-y-2.5">
      {piles.map(({ code, pieces }, i) => {
        const estOuverte = active === code;
        const doublons = pieces.filter((p) => p.doublonDe !== null).length;
        return (
          <section
            key={code}
            className="cab-monte overflow-hidden rounded-[14px] border border-border bg-card"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="relative flex min-h-[64px] items-center gap-3 px-4 py-2.5">
              <button
                type="button"
                aria-expanded={estOuverte}
                onClick={() => setOuverte(estOuverte ? null : code)}
                className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3.5 text-start"
              >
                <span className="num min-w-[46px] text-[26px] font-medium" data-pile={code}>
                  {pieces.length}
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-semibold">{t(TITRE[code])}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {code === "a_completer" && doublons > 0
                      ? t("cab.pile.dont_doublons", { count: doublons })
                      : t(AIDE[code])}
                  </span>
                </span>
              </button>
              {code === "pretes" ? (
                <Link
                  to="/cabinet/propositions"
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-foreground px-4 text-[14px] font-semibold text-background"
                >
                  {t("cab.pile.valider")}
                </Link>
              ) : (
                <ChevronDown
                  aria-hidden
                  className={
                    estOuverte
                      ? "h-5 w-5 shrink-0 rotate-180 text-muted-foreground transition-transform"
                      : "h-5 w-5 shrink-0 text-muted-foreground transition-transform"
                  }
                />
              )}
              {code === "lecture" ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
                  <span className="cab-lit block h-0.5 w-[30%] bg-foreground" />
                </span>
              ) : null}
            </div>
            {estOuverte ? (
              <ul className="cab-monte border-t border-border">
                {groupesDeLaPile(pieces).map((g) => {
                  const cle = `${code}|${g.cle}`;
                  const plie = g.pieces.length > 1 && groupe !== cle;
                  return (
                    <li key={g.cle} className="border-b border-border last:border-b-0">
                      {g.pieces.length > 1 ? (
                        <button
                          type="button"
                          aria-expanded={!plie}
                          onClick={() => setGroupe(plie ? cle : null)}
                          className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-start hover:bg-accent"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[14px] [overflow-wrap:anywhere]">
                              {g.tiers ?? t("cab.pile.sans_tiers")}
                            </span>
                            <span className="block text-[12px] text-muted-foreground">
                              {g.client}
                            </span>
                          </span>
                          <span className="num text-[13px] text-muted-foreground">
                            {g.pieces.length}
                          </span>
                        </button>
                      ) : null}
                      {plie
                        ? null
                        : g.pieces.map((p) => {
                            const m = p.montant ?? p.montantLu;
                            return (
                              <Link
                                key={p.pieceId}
                                to="/cabinet/piece/$pieceId"
                                params={{ pieceId: p.pieceId }}
                                className="flex min-h-[52px] items-center gap-3 px-4 py-2 hover:bg-accent"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[14px] [overflow-wrap:anywhere]">
                                    {g.pieces.length > 1
                                      ? (p.libelle ?? t("cab.queue.sansEcriture"))
                                      : (g.tiers ?? p.libelle ?? t("cab.pile.sans_tiers"))}
                                  </span>
                                  <span className="block text-[12px] text-muted-foreground">
                                    {g.client}
                                  </span>
                                </span>
                                {p.doublonDe ? (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[12px]">
                                    {t("cab.pile.doublon")}
                                  </span>
                                ) : null}
                                <span className="num text-[13px]" dir="ltr">
                                  {m ? montant(m, locale) : ""}
                                </span>
                              </Link>
                            );
                          })}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
