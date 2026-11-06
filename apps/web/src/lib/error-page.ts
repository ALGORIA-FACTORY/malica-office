/**
 * La page que le serveur rend quand l'écran n'a pas pu se construire.
 *
 * ================================================== LE DÉFAUT QUI L'A FAIT NAÎTRE
 *
 * Audit du 6 novembre 2026 (web, constat 2) : cette page était en anglais
 * seul, en `system-ui`, grise et arrondie — un gabarit générique, hors de la
 * marque, devant un dirigeant qui lit le français ou l'arabe.
 *
 * Elle dit désormais les trois phrases de l'écran de secours (`SECOURS`, la
 * même source que la frontière d'erreur de `__root.tsx`), aux couleurs de la
 * marque — Ink et Paper —, en Inter. Elle ne charge rien : c'est la page qui
 * s'affiche quand le reste a échoué, elle ne peut dépendre d'aucun paquet.
 *
 * La langue est celle que la personne a rangée (`malica.locale`), lue par un
 * script de trois lignes ; sans script, le français. La référence est celle
 * que le serveur a inscrite à son journal avec l'erreur : la personne la
 * cite, l'exploitant retrouve la ligne. Aucun détail technique n'y figure.
 */

/** Les phrases de secours, dans les trois langues. Une seule source pour les deux écrans. */
export const SECOURS = {
  fr: {
    titre: "Cet écran n'a pas pu s'afficher.",
    corps: "Ce n'est pas votre faute. Réessayez, ou revenez à l'accueil.",
    reessayer: "Réessayer",
    accueil: "Revenir à l'accueil",
    reference: "réf.",
  },
  en: {
    titre: "This screen could not be displayed.",
    corps: "It is not your fault. Try again, or go back home.",
    reessayer: "Try again",
    accueil: "Back home",
    reference: "ref.",
  },
  ar: {
    titre: "تعذّر عرض هذه الشاشة.",
    corps: "ليس خطأك. أعد المحاولة أو عد إلى الصفحة الرئيسية.",
    reessayer: "أعد المحاولة",
    accueil: "العودة إلى الرئيسية",
    reference: "المرجع",
  },
} as const;

export type LangueDeSecours = keyof typeof SECOURS;

/** Une référence courte, à citer : huit chiffres hexadécimaux. */
export function referenceDePanne(): string {
  const octets = new Uint8Array(4);
  globalThis.crypto.getRandomValues(octets);
  return Array.from(octets, (o) => o.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

const echapper = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function bloc(langue: LangueDeSecours, ref: string): string {
  const m = SECOURS[langue];
  const sens = langue === "ar" ? "rtl" : "ltr";
  return `<main class="carte" lang="${langue}" dir="${sens}" data-langue="${langue}"${
    langue === "fr" ? "" : " hidden"
  }>
      <h1>${echapper(m.titre)}</h1>
      <p>${echapper(m.corps)}</p>
      <div class="gestes">
        <button type="button" class="principal" onclick="location.reload()">${echapper(m.reessayer)}</button>
        <a class="second" href="/">${echapper(m.accueil)}</a>
      </div>
      <p class="ref">${echapper(m.reference)} ${echapper(ref)}</p>
    </main>`;
}

/** La page, dans les trois langues ; seule celle de la personne s'affiche. */
export function renderErrorPage(ref: string = referenceDePanne()): string {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Malica Office</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>
      :root { --ink: #0A0A0A; --paper: #FAFAFA; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.5rem;
        background: var(--paper); color: var(--ink);
        font: 400 15px/1.55 Inter, sans-serif; }
      .carte { max-width: 28rem; width: 100%; text-align: center; }
      .carte[hidden] { display: none; }
      h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.5rem; }
      p { margin: 0 0 1.5rem; opacity: 0.72; }
      .gestes { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 44px; padding: 0.625rem 1.25rem; border-radius: 0; font: inherit;
        font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid var(--ink); }
      .principal { background: var(--ink); color: var(--paper); }
      .second { background: var(--paper); color: var(--ink); display: inline-flex; align-items: center; }
      .ref { margin: 1.5rem 0 0; font: 400 12px/1.4 "IBM Plex Mono", monospace; opacity: 0.6; }
      @media (prefers-color-scheme: dark) {
        :root { --ink: #FAFAFA; --paper: #0A0A0A; }
      }
    </style>
  </head>
  <body>
    ${(Object.keys(SECOURS) as LangueDeSecours[]).map((l) => bloc(l, ref)).join("\n    ")}
    <script>
      try {
        var l = localStorage.getItem("malica.locale");
        if (l === "en" || l === "ar") {
          document.querySelectorAll("[data-langue]").forEach(function (b) {
            b.hidden = b.getAttribute("data-langue") !== l;
          });
          document.documentElement.lang = l;
        }
      } catch (e) {}
    </script>
  </body>
</html>`;
}
