/**
 * Le gabarit commun du courriel, sans base ni réseau : il rend le même habillage
 * dans les trois langues, se colore selon le ton, passe en sombre et sur téléphone,
 * n'exécute jamais une valeur, et refuse ce qu'il ne sait pas dire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { corpsBrevo } from "../courriel/brevo.ts";
import { courrielDeNotification, routeDuBouton, TONS } from "./courriel-de-notification.ts";
import { libellesDEssai } from "../courriel/libelles-d-essai.ts";

/** Le courriel, avec les textes que les migrations écrivent pour sa langue. */
const rendre = (n: Omit<Parameters<typeof courrielDeNotification>[0], "libelles">) =>
  courrielDeNotification({ ...n, libelles: libellesDEssai(n.locale) });

const BASE = {
  code: "piece.retournee",
  organisation: "Société Démo SARL",
  urlPublique: "https://app.essai.local",
  titre: "Une pièce vous a été retournée",
  corps: "La comptabilité a retourné une pièce.",
  action: { libelle: "Ouvrir dans Malica", url: "https://app.essai.local/pme/notifications" },
};

// Le signal de l'étiquette, dans le clair écrit en ligne (charte du 13 novembre 2026).
const FRISE = [
  { code: "impaye.rappel", signal: "attend", jour: 1, repondre: false },
  { code: "impaye.relance", signal: "attend", jour: 15, repondre: true },
  { code: "impaye.avis_de_suspension", signal: "retard", jour: 25, repondre: false },
  { code: "impaye.suspension", signal: "retard", jour: 30, repondre: false },
] as const;

const COULEUR: Record<string, string> = {
  succes: "#235340",
  erreur: "#B23A1C",
  alerte: "#8A5B00",
  en_cours: "#1F6FB2",
  neutre: "#5F6673",
};

describe("le gabarit commun du courriel", () => {
  it("rend dans les trois langues, avec le sens de lecture de la langue", () => {
    const fr = rendre({ ...BASE, locale: "fr", ton: "alerte" });
    const en = rendre({ ...BASE, locale: "en", ton: "alerte" });
    const ar = rendre({ ...BASE, locale: "ar", ton: "alerte" });
    assert.match(fr.html, /<html lang="fr" dir="ltr">/);
    assert.match(en.html, /<html lang="en" dir="ltr">/);
    assert.match(ar.html, /<html lang="ar" dir="rtl">/);
    assert.match(ar.html, /Noto Naskh Arabic/);
    assert.match(ar.html, /text-align:right/);
  });

  it("chaque ton colore l'étiquette : le point et le mot", () => {
    for (const ton of TONS) {
      const { html } = rendre({ ...BASE, locale: "fr", ton });
      assert.ok(html.includes(`background:${COULEUR[ton]};"></span>`), `ton ${ton} : point absent`);
      assert.ok(html.includes(`color:${COULEUR[ton]};">Pièce</td>`), `ton ${ton} : mot absent`);
    }
  });

  it("l'étiquette dit la famille du genre, la pastille la société", () => {
    const mandat = rendre({
      ...BASE,
      locale: "fr",
      ton: "succes",
      code: "mandat.accepte",
    });
    assert.match(mandat.html, />Mandat<\/td>/);
    assert.match(mandat.html, />Société Démo SARL<\/td>/);
    const inconnu = rendre({
      ...BASE,
      locale: "fr",
      ton: "neutre",
      code: "autre.chose",
      organisation: null,
    });
    assert.match(inconnu.html, />Malica<\/td>/);
    assert.ok(!inconnu.html.includes('class="m-pastille"'), "sans société, pas de pastille");
  });

  it("Malica signe les relances d'impayé, où elle parle en « je »", () => {
    const relance = rendre({
      ...BASE,
      locale: "fr",
      ton: "alerte",
      code: "impaye.rappel",
      frise: FRISE,
    });
    const mandat = rendre({
      ...BASE,
      locale: "fr",
      ton: "succes",
      code: "mandat.accepte",
    });
    assert.match(relance.html, /— Malica</);
    assert.ok(!mandat.html.includes("— Malica<"));
  });

  it("la relance dessine sa frise, chaque palier dans sa couleur, et propose de répondre", () => {
    const c = rendre({
      ...BASE,
      locale: "fr",
      ton: "alerte",
      code: "impaye.relance",
      frise: FRISE,
      donnees: { numero: "F-1", reste: "41,460", devise: "TND" },
      repondreA: "support@essai.local",
    });
    assert.match(c.html, /F-1 · reste dû/);
    assert.match(c.html, /J\+15/);
    assert.match(c.html, /mailto:support@essai\.local/);
    assert.match(c.html, /class="m-s-attend"/);
    assert.doesNotMatch(c.html, /class="m-s-retard"/, "l'avis n'est pas encore atteint");
  });

  it("la montée d'offre : le passage, rien à payer, les droits, les noms en gras (E23)", () => {
    const c = rendre({
      ...BASE,
      locale: "fr",
      ton: "succes",
      code: "acces.monte",
      corps: "Cabinet Essai a monté votre offre. Elle reste à sa charge.",
      donnees: {
        cabinet: "Cabinet Essai",
        offre: "Premium",
        avant: "Team",
        offre_lectures: 140,
        offre_places: 4,
        offre_societes: 2,
        offre_devise: "TND",
      },
      carte: [
        { genre: "passage", libelle: "carte.passage.avant", valeur: "carte.passage.offre" },
        { genre: "montant", libelle: "unite.pourVous", valeur: "valeur.zeroPourVous" },
        { genre: "ligne", libelle: "donnee.lectures", valeur: "valeur.lecturesParSociete" },
        { genre: "ligne", libelle: "donnee.places", valeur: "valeur.placesEnPlus" },
      ],
    });
    assert.match(c.html, />Team</);
    assert.match(c.html, />Premium</);
    assert.match(c.html, /TND pour vous/);
    assert.match(c.html, /140 par mois et par société/);
    assert.match(c.html, /4 en plus de vous/);
    assert.match(c.html, /<strong[^>]*>Cabinet Essai<\/strong> a monté/);
    assert.match(c.html, /Votre abonnement est pris en charge par Cabinet Essai\./);
  });

  it("une ligne dont un jeton manque ne s'affiche pas", () => {
    const c = rendre({
      ...BASE,
      locale: "fr",
      ton: "succes",
      code: "acces.monte",
      donnees: { offre: "Premium" },
      carte: [{ genre: "montant", libelle: "unite.pourVous", valeur: "valeur.zeroPourVous" }],
    });
    assert.doesNotMatch(c.html, /pour vous/);
  });

  it("l'objet vient du gabarit, ses jetons remplis ; troué, il redevient le titre", () => {
    const plein = rendre({
      ...BASE,
      locale: "fr",
      ton: "alerte",
      sujet: "Relance — facture {{numero}}",
      donnees: { numero: "F-2026-0042" },
    });
    assert.equal(plein.sujet, "Relance — facture F-2026-0042");
    const troue = rendre({
      ...BASE,
      locale: "fr",
      ton: "alerte",
      sujet: "Facture {{numero}}",
    });
    assert.equal(troue.sujet, BASE.titre);
    assert.equal(rendre({ ...BASE, locale: "fr", ton: "alerte" }).sujet, BASE.titre);
  });

  it("le pied dit pourquoi : la raison propre aux impayés, sinon la générale", () => {
    const impaye = rendre({
      ...BASE,
      code: "impaye.relance",
      locale: "fr",
      ton: "alerte",
    });
    assert.match(impaye.html, /Une facture de votre abonnement reste due\./);
    const autre = rendre({ ...BASE, locale: "fr", ton: "alerte" });
    assert.doesNotMatch(autre.html, /reste due/);
  });

  it("refuse un ton inconnu plutôt que de le deviner", () => {
    assert.throws(
      () => rendre({ ...BASE, locale: "fr", ton: "joyeux" }),
      /ton de courriel inconnu/,
    );
  });

  it("est responsive et prévu pour le mode sombre", () => {
    const { html } = rendre({ ...BASE, locale: "fr", ton: "neutre" });
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /@media only screen and \(max-width: 620px\)/);
    assert.match(html, /courriel\/rg-noir\.png/, "le repère vient de l'appli elle-même");
    assert.match(html, /@media \(prefers-color-scheme: dark\)/);
    assert.match(html, /max-width:600px/);
  });

  it("échappe titre, corps et lien : rien n'est exécuté", () => {
    const { html } = rendre({
      ...BASE,
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
        rendre({
          ...BASE,
          locale: "fr",
          ton: "neutre",
          action: { libelle: "x", url: "javascript:alert(1)" },
        }),
      /lien d'action invalide/,
    );
  });

  it("une langue inconnue prend le français, sans écraser le ton", () => {
    const { html } = rendre({ ...BASE, locale: "de", ton: "succes" });
    assert.match(html, /<html lang="fr" dir="ltr">/);
    assert.ok(html.includes(`background:${COULEUR["succes"]};"></span>`));
  });

  it("le corps Brevo porte le rendu tel quel, sans réseau", () => {
    const message = rendre({ ...BASE, locale: "ar", ton: "succes" });
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

describe("l'adresse du bouton", () => {
  it("prend ses jetons dans les données, encodés pour l'URL", () => {
    assert.equal(
      routeDuBouton("/cabinet/regler/{{facture_id}}", { facture_id: "a b/c" }),
      "/cabinet/regler/a%20b%2Fc",
    );
    assert.equal(
      routeDuBouton("/pme/reglages?page=abonnement", null),
      "/pme/reglages?page=abonnement",
    );
  });

  it("un jeton sans valeur ne laisse pas de lien cassé", () => {
    assert.equal(routeDuBouton("/cabinet/regler/{{facture_id}}", {}), null);
  });
});
