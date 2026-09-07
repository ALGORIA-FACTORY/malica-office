import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { usePme } from "@/components/regalica/pme-context";
import { MarqueRg } from "@/components/regalica/office-ui";
import { marquerBienvenueVue } from "@/components/regalica/bienvenue";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/pme/bienvenue")({
  head: () => ({
    meta: [
      { title: "Je m'appelle Regalica — Regalica Office" },
      {
        name: "description",
        content: "Vous photographiez. Je lis, je classe, je calcule. Votre comptable tranche.",
      },
      { property: "og:title", content: "Je m'appelle Regalica — Regalica Office" },
      {
        property: "og:description",
        content: "Vous photographiez. Je lis, je classe, je calcule. Votre comptable tranche.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Bienvenue,
});

/**
 * L'arrivée — elle se présente, et elle promet trois choses.
 *
 * ===================================================== TROIS PROMESSES, PAS QUATRE
 *
 * Le prototype en fait une troisième : « je vous préviens sept jours avant une
 * échéance, jamais la veille, jamais la nuit. » Rien n'envoie encore de
 * notification — c'est pour cette même raison que les trois interrupteurs des
 * réglages n'existent pas. La promettre ICI serait le même mensonge, mais dit
 * à la première seconde et retenu pour toujours.
 *
 * La troisième promesse dit donc ce qui est vrai aujourd'hui : les échéances
 * sont là avant d'arriver, et elles viennent du pack fiscal. Le jour où
 * l'envoi existera, la phrase changera — pas l'inverse.
 *
 * ================================================================ LE FOND NOIR
 *
 * Le seul écran du produit qui s'impose en pleine encre, quel que soit le
 * thème. C'est une présentation, pas une page : elle a lieu une fois, elle
 * n'appartient pas au rythme du reste.
 */
function Bienvenue() {
  const { t } = useI18n();
  const pme = usePme();
  const navigate = useNavigate();

  const plusTard = () => {
    marquerBienvenueVue();
    void navigate({ to: "/pme" });
  };

  const commencer = () => {
    marquerBienvenueVue();
    pme.ouvrirScanner();
    void navigate({ to: "/pme" });
  };

  const promesses = [t("pme.bienvenue.p1"), t("pme.bienvenue.p2"), t("pme.bienvenue.p3")];

  return (
    <div className="pt-safe fixed inset-0 z-40 mx-auto flex w-full max-w-md flex-col overflow-hidden bg-[#0A0A0A] text-[#FAFAFA]">
      {/* Le sigle en fond, énorme et presque invisible : la marque comme lieu. */}
      <MarqueRg
        aria-hidden
        className="pointer-events-none absolute -bottom-[90px] -start-[70px] h-[340px] w-[340px] opacity-[0.08]"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto px-[26px] pt-9">
        <MarqueRg aria-hidden className="h-[30px] w-[30px]" />

        <p className="mt-11 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em]">
          {t("pme.bienvenue.titre.1")}
          <br />
          {t("pme.bienvenue.titre.2")}
        </p>
        <p className="mt-4 max-w-[290px] text-[16px] leading-[1.6] text-[#C7C7CC]">
          {t("pme.bienvenue.lede")}
        </p>

        {promesses.map((p, i) => (
          <div
            key={i}
            className="mt-3.5 flex gap-3 border-t border-[#262628] pt-4 first-of-type:mt-[34px]"
          >
            <span className="num flex-none text-[12px] font-medium text-[#7C7C82]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className="text-[14.5px] leading-[1.55] text-[#C7C7CC]">{p}</p>
          </div>
        ))}
      </div>

      <div className="relative flex-none px-[26px] pb-5 pt-3">
        <button
          type="button"
          onClick={commencer}
          className="h-14 w-full bg-[#FAFAFA] text-[16px] font-semibold text-[#0A0A0A]"
        >
          {t("pme.bienvenue.commencer")}
        </button>
        <button
          type="button"
          onClick={plusTard}
          className="h-12 w-full text-[15px] font-medium text-[#C7C7CC]"
        >
          {t("pme.bienvenue.plusTard")}
        </button>
      </div>
    </div>
  );
}
