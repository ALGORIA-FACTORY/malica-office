/**
 * Le gabarit commun du courriel, sans base ni réseau : il rend le même habillage
 * dans les trois langues, se colore selon le ton, passe en sombre et sur téléphone,
 * n'exécute jamais une valeur, et refuse ce qu'il ne sait pas dire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corpsBrevo } from "../courriel/brevo.ts";
import { courrielDeNotification, TONS } from "./courriel-de-notification.ts";

const BASE = {
  titre: "Une pièce vous a été retournée",
  corps: "La comptabilité a retourné une pièce.",
  action: { libelle: "Ouvrir dans Malica", url: "https://app.essai.local/pme/notifications" },
};

const COULEUR: Record<string, string> = {
  succes: "#3A8F54",
  erreur: "#BF4424",
  alerte: "#B58614",
  en_cours: "#2968A5",
  neutre: "#555555",
};

describe("le gabarit commun du courriel", () => {
  it("rend dans les trois langues, avec le sens de lecture de la langue", () => {
    const fr = courrielDeNotification({ ...BASE, locale: "fr", ton: "alerte" });
    const en = courrielDeNotification({ ...BASE, locale: "en", ton: "alerte" });
    const ar = courrielDeNotification({ ...BASE, locale: "ar", ton: "alerte" });
    assert.match(fr.html, /<html lang="fr" dir="ltr">/);
    assert.match(en.html, /<html lang="en" dir="ltr">/);
    assert.match(ar.html, /<html lang="ar" dir="rtl">/);
    assert.match(ar.html, /Noto Naskh Arabic/);
    assert.match(ar.html, /text-align:right/);
  });

  it("chaque ton colore la barre, et seulement elle", () => {
    for (const ton of TONS) {
      const { html } = courrielDeNotification({ ...BASE, locale: "fr", ton });
      assert.ok(
        html.includes(`background:${COULEUR[ton]};font-size:0`),
        `ton ${ton} : barre absente`,
      );
    }
  });

  it("refuse un ton inconnu plutôt que de le deviner", () => {
    assert.throws(
      () => courrielDeNotification({ ...BASE, locale: "fr", ton: "joyeux" }),
      /ton de courriel inconnu/,
    );
  });

  it("est responsive et prévu pour le mode sombre", () => {
    const { html } = courrielDeNotification({ ...BASE, locale: "fr", ton: "neutre" });
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /@media only screen and \(max-width: 620px\)/);
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(html, /max-width:600px/);
  });

  it("échappe titre, corps et lien : rien n'est exécuté", () => {
    const { html } = courrielDeNotification({
      locale: "fr",
      ton: "erreur",
      titre: "<script>x</script>",
      corps: "a & b",
      action: null,
    });
    assert.ok(!html.includes("<script>x</script>"));
    assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"));
    assert.ok(html.includes("a &amp; b"));
  });

  it("refuse un lien d'action qui n'est pas http(s)", () => {
    assert.throws(
      () =>
        courrielDeNotification({
          ...BASE,
          locale: "fr",
          ton: "neutre",
          action: { libelle: "x", url: "javascript:alert(1)" },
        }),
      /lien d'action invalide/,
    );
  });

  it("une langue inconnue prend le français, sans écraser le ton", () => {
    const { html } = courrielDeNotification({ ...BASE, locale: "de", ton: "succes" });
    assert.match(html, /<html lang="fr" dir="ltr">/);
    assert.ok(html.includes(`background:${COULEUR["succes"]};font-size:0`));
  });

  it("le corps Brevo porte le rendu tel quel, sans réseau", () => {
    const message = courrielDeNotification({ ...BASE, locale: "ar", ton: "succes" });
    const corps = JSON.parse(
      corpsBrevo({
        cle: "cle-factice-non-envoyee",
        expediteur: { email: "noreply@essai.local", nom: "Malica Office" },
        destinataire: "destinataire@essai.local",
        ...message,
      }),
    ) as { subject: string; htmlContent: string; to: Array<{ email: string }> };
    assert.equal(corps.subject, BASE.titre);
    assert.equal(corps.to[0]!.email, "destinataire@essai.local");
    assert.equal(corps.htmlContent, message.html);
  });
});
