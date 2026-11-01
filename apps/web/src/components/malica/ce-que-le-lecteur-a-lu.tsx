/**
 * « Ce que le lecteur a lu » — le lecteur prouvé, vu par le cabinet.
 *
 * Le moteur de lecture prouvée tourne en OBSERVATION : il inscrit ce qu'il lit
 * (`capture.champs_lus`) sans rien changer à la lecture retenue. Personne ne
 * pouvait le voir ; le dirigeant doit pouvoir le juger avant de l'allumer.
 *
 * La section ne dit rien d'autre que la base : l'issue de la dernière
 * inscription, puis ses champs triés par rang, chacun avec son statut et son
 * rôle, l'avertissement de l'expert sous le champ qu'il concerne. Elle ne
 * paraît pas pour une pièce que le lecteur n'a pas lue.
 *
 * La couleur est fonctionnelle et portée par le seul point du statut : vert
 * prouvé, ambre signalé, azur déduit. Le texte reste à l'encre.
 */
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import type { ChampObserve, LectureObservee } from "@malica/socle/ports/repositories";

import {
  InkCell,
  InkTable,
  InkTableRow,
  SectionRepliable,
  SignalLight,
  type Tone,
} from "@/components/malica/office-ui";
import { useI18n, type MessageKey } from "@/i18n";
import { office } from "@/verticals/malica-office/composition";

const TON_DU_STATUT: Record<ChampObserve["statut"], Tone> = {
  prouve: "ok",
  conforme: "neutral",
  signale: "warn",
  absent: "neutral",
  deduit: "info",
  coupe: "info",
};

const TON_DE_L_ISSUE: Record<LectureObservee["issue"], Tone> = {
  prouvee: "ok",
  signalee: "warn",
  ambigue: "neutral",
  aucune: "neutral",
};

export function CeQueLeLecteurALu({ pieceId }: { pieceId: string }) {
  const { t, locale } = useI18n();
  const [ouvert, setOuvert] = useState(false);
  const lecture = useQuery({
    queryKey: ["lecture-observee", pieceId, locale],
    queryFn: () => office().capture.lectureObservee(pieceId, locale),
  });
  const l = lecture.data;
  if (!l) return null;

  const statut = (s: ChampObserve["statut"]) => t(`cab.lecteur.statut.${s}` as MessageKey);
  const issue = t(`cab.lecteur.issue.${l.issue}` as MessageKey);
  const colValeur = t("cab.lecteur.valeur");
  const colStatut = t("cab.lecteur.statut");
  const colRole = t("cab.lecteur.role");
  const colonnes = [t("cab.lecteur.champ"), colValeur, colStatut, colRole];

  return (
    <div className="cab-lecteur" data-issue={l.issue}>
      <SectionRepliable
        titre={t("cab.lecteur.titre")}
        ouvert={ouvert}
        onBascule={() => setOuvert((o) => !o)}
        resume={
          <SignalLight
            tone={TON_DE_L_ISSUE[l.issue]}
            label={`${issue} · ${t("cab.lecteur.champs", { count: l.champs.length })}`}
          />
        }
      >
        <p className="cab-lecteur-observation">{t("cab.lecteur.observation")}</p>

        <div className="cab-lecteur-issue">
          <span className="cab-lecteur-kicker">{t("cab.lecteur.issue")}</span>
          <SignalLight tone={TON_DE_L_ISSUE[l.issue]} label={issue} />
          <span className="cab-lecteur-meta">
            {l.grille ? <span>{t("cab.lecteur.grille", { grille: l.grille.libelle })}</span> : null}
            <span>
              {t("cab.lecteur.le", {
                date: new Intl.DateTimeFormat(locale, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(l.le)),
              })}
            </span>
          </span>
        </div>

        {l.champs.length === 0 ? (
          <p className="cab-lecteur-observation">{t("cab.lecteur.aucunChamp")}</p>
        ) : (
          <InkTable head={colonnes} caption={t("cab.lecteur.titre")} empile>
            {l.champs.map((c, i) => (
              <Fragment key={`${c.code}|${c.rang ?? ""}|${c.instance ?? ""}|${i}`}>
                <InkTableRow>
                  <InkCell>
                    <span className="cab-lecteur-champ">
                      {c.rang !== null ? (
                        <span className="num cab-lecteur-rang">
                          {t("cab.lecteur.ligne", { rang: c.rang })}
                        </span>
                      ) : null}
                      <span>{c.libelle}</span>
                      {c.instance ? (
                        <span className="num cab-lecteur-meta">{c.instance}</span>
                      ) : null}
                    </span>
                    {c.expert ? (
                      <span className="cab-lecteur-meta">
                        {t("cab.lecteur.expert", { expert: c.expert.libelle })}
                      </span>
                    ) : null}
                  </InkCell>
                  <InkCell label={colValeur}>
                    {c.valeur !== null ? (
                      <bdi className="num cab-lecteur-valeur">{c.valeur}</bdi>
                    ) : (
                      <span className="cab-lecteur-meta">{t("cab.lecteur.nonCitee")}</span>
                    )}
                  </InkCell>
                  <InkCell label={colStatut}>
                    <SignalLight tone={TON_DU_STATUT[c.statut]} label={statut(c.statut)} />
                  </InkCell>
                  <InkCell label={colRole}>{c.role ? c.role.libelle : "—"}</InkCell>
                </InkTableRow>
                {c.avertissement ? (
                  <tr className="cab-lecteur-avertissement">
                    <td colSpan={colonnes.length}>
                      <strong>{t("cab.lecteur.avertissement")}</strong> {c.avertissement.libelle}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </InkTable>
        )}
      </SectionRepliable>
    </div>
  );
}
