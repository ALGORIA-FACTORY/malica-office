/**
 * Malica rédige le procès-verbal — le texte, jamais un chiffre.
 *
 * ============================================================== POURQUOI
 *
 * R3 : le procès-verbal est le seul artefact qu'un modèle produit, et il ne
 * porte aucun chiffre liant. Ce module tient cette frontière en trois temps :
 *
 *   1. Les CHIFFRES sortent des moteurs du Socle — `computePnl`, `computeTva`
 *      — nourris par ce que l'API rend pour ce client, exactement comme le
 *      dossier du cabinet les affiche. Les comptages viennent de la file et
 *      du calendrier. Aucun n'est calculé ici.
 *   2. Le modèle reçoit ces chiffres, avec leurs libellés et le ton du
 *      cabinet, et rend le TEXTE des sections. Il lui est interdit d'écrire
 *      un nombre qui ne figure pas dans la liste.
 *   3. On vérifie après coup, mécaniquement, qu'aucun nombre étranger
 *      n'apparaît. S'il y en a un, on rejette et on redemande — trois fois,
 *      puis on renonce : le PV est enregistré avec ses chiffres, sans texte.
 *
 * La garde est celle de toutes les rédactions de Malica
 * (`redaction.server.ts`) : les chiffres deviennent des FAITS, la liste que
 * le modèle lit est celle que la relecture autorise, et une seule fonction
 * dit ce qui est étranger. Le PV ne passe pas par `redigerDepuisLesFaits`
 * parce qu'il n'est pas un paragraphe : il a des sections nommées, rendues
 * en JSON, et une reprise de plus quand la forme n'est pas tenue.
 *
 * Ce que l'écran reçoit ne contient aucun texte technique : un résultat, ou
 * une raison codée qu'il traduit.
 */
import { MESSAGES, type Locale } from "@malica/socle/messages";
import type { AppelApi } from "../appel-local.ts";
import { debutDExercice, finDuMois } from "@malica/socle/exercice";
import { lireSections, texteDesSections } from "./redaction.ts";
import { callDeepSeek, DeepSeekError, type DeepSeekMessage } from "../conseil/deepseek.ts";
import { nombresEtrangers } from "../conseil/redaction.ts";
import type {
  ClientSummary,
  Echeance,
  JurisdictionPack,
  LigneDePeriode,
  PvChiffre,
  PvReunion,
  QueueItem,
  ReglagesCabinet,
  TaxRate,
} from "@malica/socle/ports/repositories";
import { ExtractV1 } from "@malica/socle/contracts/extract.v1";
import { computePnl } from "@malica/socle/engines/pnl/snapshot";
import { computeTva } from "@malica/socle/engines/tva/compute";
import { currencyDecimals } from "@malica/socle/use-cases/propose-ecriture";
import type { Fait, RaisonDEchec, ResultatRedaction } from "@malica/socle/ports/malica";

/** Trente jours : l'horizon des « échéances à venir », le même que le dossier. */
const JOUR_MS = 86_400_000;
const HORIZON_JOURS = 30;
const DELAI_REDACTION_MS = 90_000;
const TENTATIVES = 3;

const LANGUES: Record<string, string> = {
  fr: "français",
  en: "anglais",
  ar: "arabe",
};

interface FicheCourante {
  clotureExercice: string | null;
}

/* ----------------------------------------------------------- les chiffres */

/**
 * Les chiffres du client à la date du PV, chacun avec le moteur qui l'a
 * produit. Le mois est celui de la réunion ; le cumul court depuis le début
 * de l'exercice que la fiche fiscale dit — sans fiche, l'année civile.
 */
async function rassemblerLesChiffres(
  api: AppelApi,
  cabinetTenantId: string,
  client: ClientSummary,
  jourDuPv: string,
): Promise<PvChiffre[]> {
  const periode = jourDuPv.slice(0, 7);
  const fin = finDuMois(periode);
  const devise = client.currency;
  const decimales = currencyDecimals(devise);

  const [fiche, pack, plan, extraits, file, echeances] = await Promise.all([
    api.rpc<FicheCourante | null>("identite", "ficheCourante", [client.tenantId]),
    api.rpc<JurisdictionPack | null>("referentiel", "activePack", [client.jurisdiction]),
    api.rpc<Array<{ code: string; libelle: string; parent: string | null }>>(
      "parametrage",
      "plan",
      [client.tenantId, [6, 7]],
    ),
    api.rpc<Array<{ pieceId: string; extract: unknown }>>("office", "bookedExtracts", [
      client.tenantId,
      `${periode}-01`,
      fin,
    ]),
    api.rpc<QueueItem[]>("supervision", "queue", [cabinetTenantId, client.tenantId]),
    api.rpc<Echeance[]>("collab", "echeances", [[client.tenantId]]),
  ]);

  const debut = debutDExercice(fiche?.clotureExercice ?? null, periode);
  const [lignes, taux] = await Promise.all([
    api.rpc<LigneDePeriode[]>("office", "periodeLignes", [client.tenantId, debut, fin]),
    pack
      ? api.rpc<TaxRate[]>("referentiel", "taxRates", [pack.id, client.jurisdiction])
      : Promise.resolve([] as TaxRate[]),
  ]);

  const chiffres: PvChiffre[] = [];
  const montant = (label: string, valeur: string, source: string): PvChiffre => ({
    label,
    valeur,
    source,
    genre: "montant",
    devise,
  });
  const nombre = (label: string, valeur: number, source: string): PvChiffre => ({
    label,
    valeur: String(valeur),
    source,
    genre: "nombre",
    devise: null,
  });

  if (lignes.length > 0) {
    const pnl = computePnl({
      period: periode,
      currency: { code: devise, decimals: decimales },
      entries: lignes.map((l) => ({
        account_code: l.accountCode,
        debit: l.debit,
        credit: l.credit,
      })),
      coa: plan.map((c) => ({ account_code: c.code, label: c.libelle, parent_code: c.parent })),
    });
    chiffres.push(
      montant("ca", pnl.produits, "pnl"),
      montant("charges", pnl.charges, "pnl"),
      montant("resultat", pnl.resultat, "pnl"),
    );
  }

  if (extraits.length > 0 && taux.length > 0) {
    const dedans = extraits
      .map((e) => ({ item_id: e.pieceId, lu: ExtractV1.safeParse(e.extract) }))
      .filter((e) => e.lu.success)
      .map((e) => ({ item_id: e.item_id, extract: (e.lu as { data: ExtractV1 }).data }));
    if (dedans.length > 0) {
      const tva = computeTva({
        period: periode,
        currency: { code: devise, decimals: decimales },
        tax_rates: taux.map((r) => ({
          code: r.code,
          label: r.label,
          rate: r.rate,
          valid_from: r.validFrom,
          valid_to: r.validTo,
          jurisdiction: r.jurisdiction,
        })),
        achats: dedans.filter((e) => e.extract.document_kind !== "facture_vente"),
        ventes: dedans.filter((e) => e.extract.document_kind === "facture_vente"),
      });
      chiffres.push(
        montant("tvaCollectee", tva.totals.collectee, "tva"),
        montant("tvaDeductible", tva.totals.deductible, "tva"),
        montant("tva", tva.totals.solde, "tva"),
      );
    }
  }

  const duMois = file.filter((p) => p.createdAt.slice(0, 7) === periode).length;
  const aSuperviser = file.filter((p) => p.status === "comptabilisee").length;
  chiffres.push(
    nombre("pieces", duMois, "file"),
    nombre("aSuperviser", aSuperviser, "file"),
    nombre("retournees", client.counts.retournee ?? 0, "file"),
  );

  const jour = new Date(`${jourDuPv}T00:00:00Z`).getTime();
  const aVenir = echeances.filter((e) => {
    const d = new Date(`${e.dueDate}T00:00:00Z`).getTime();
    return e.status !== "fait" && d >= jour && d <= jour + HORIZON_JOURS * JOUR_MS;
  }).length;
  chiffres.push(nombre("echeances", aVenir, "calendrier"));

  return chiffres;
}

/* ------------------------------------------------------------- le texte */

function libelle(locale: Locale, cle: string): string {
  const dict = MESSAGES[locale] as Record<string, string>;
  return dict[cle] ?? (MESSAGES.fr as Record<string, string>)[cle] ?? cle;
}

/**
 * Les chiffres en FAITS : le libellé dans la langue du PV, la valeur brute du
 * Socle, le moteur qui l'a produite. C'est cette liste — et elle seule — que
 * le modèle lit, et que la relecture autorise.
 */
function chiffresEnFaits(chiffres: readonly PvChiffre[], locale: Locale): Fait[] {
  return chiffres.map((c) => ({
    label: libelle(locale, `cab.pv.chiffre.${c.label}`),
    valeur: c.genre === "montant" ? `${c.valeur} ${c.devise ?? ""}`.trim() : c.valeur,
    source: libelle(locale, `cab.pv.source.${c.source}`),
  }));
}

/** Une ligne par fait, telle que le modèle la lit. */
function faitsEnTexte(faits: readonly Fait[]): string {
  return faits.map((f) => `- ${f.label} : ${f.valeur} (${f.source})`).join("\n");
}

function consigne(input: {
  locale: Locale;
  ton: string;
  cabinet: string;
  client: string;
  jour: string;
  finDuMois: string;
  presents: string | null;
  chiffres: string;
}): DeepSeekMessage[] {
  const langue = LANGUES[input.locale] ?? LANGUES["fr"];
  const registre =
    input.ton === "chaleureux"
      ? "Ton chaleureux : tu t'adresses au dirigeant avec cordialité, sans familiarité, et tu dis ce qui va bien avant ce qui reste à faire."
      : "Ton sobre : phrases courtes, factuelles, sans adjectif inutile ; tu constates, tu ne commentes pas.";
  return [
    {
      role: "system",
      content: [
        `Tu es Malica, l'assistante du cabinet d'expertise comptable « ${input.cabinet} ». Tu rédiges en ${langue} le procès-verbal d'une réunion de restitution avec le client « ${input.client} ».`,
        registre,
        "RÈGLE ABSOLUE — LES CHIFFRES : tu n'écris JAMAIS un nombre qui ne figure pas dans la liste CHIFFRES ci-dessous. Aucune somme, aucune différence, aucun pourcentage, aucun ratio, aucune moyenne, aucun « environ ». Tu ne fais aucun calcul. Si un chiffre manque, tu le dis en mots, sans l'inventer.",
        "Quand tu cites un chiffre de la liste, tu le recopies exactement tel qu'il est écrit, avec sa devise. Les seuls nombres admis en dehors de la liste sont les dates et l'année.",
        "Tu ne cites aucun article de loi, aucun taux, aucun seuil réglementaire.",
        'FORME : tu réponds UNIQUEMENT par un objet JSON, sans commentaire, de la forme {"sections":[{"kicker":"…","corps":"…"}]}. Entre trois et cinq sections. Chaque « kicker » est un intitulé de deux à cinq mots (situation, pièces, TVA, échéances, suite…). Chaque « corps » est un paragraphe de trois à six phrases.',
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Réunion du ${input.jour}. Point d'étape comptable, cumul au ${input.finDuMois}.`,
        input.presents ? `Présents : ${input.presents}.` : "Présents : non renseignés.",
        "",
        "CHIFFRES (seule source, à recopier tels quels) :",
        input.chiffres.length > 0
          ? input.chiffres
          : "(aucun chiffre : rien n'est comptabilisé sur la période — dis-le, sans en inventer)",
      ].join("\n"),
    },
  ];
}

async function demander(apiKey: string, messages: DeepSeekMessage[]): Promise<string> {
  let derniere: unknown = null;
  for (let essai = 0; essai < 2; essai += 1) {
    try {
      const r = await callDeepSeek({
        apiKey,
        role: "chat",
        temperature: 0.4,
        messages,
        signal: AbortSignal.timeout(DELAI_REDACTION_MS),
      });
      return r.answer;
    } catch (e) {
      derniere = e;
      const reessayable = e instanceof DeepSeekError ? e.retryable : true;
      if (!reessayable || essai === 1) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw derniere instanceof Error ? derniere : new Error("malica.indisponible");
}

/* ------------------------------------------------------------ l'ensemble */

export async function redigerLePv(
  api: AppelApi,
  input: { pvId: string; locale: Locale },
): Promise<ResultatRedaction> {
  const pv = await api.rpc<PvReunion | null>("collab", "pvOuvrir", [input.pvId]);
  if (!pv) return { ok: false, raison: "introuvable", pv: null };
  if (pv.statut === "envoye") return { ok: false, raison: "envoye", pv };
  if (!pv.clientTenantId) return { ok: false, raison: "sans_client", pv };

  const [clients, reglages, cabinets] = await Promise.all([
    api.rpc<ClientSummary[]>("supervision", "listClients", [pv.cabinetTenantId]),
    api.rpc<ReglagesCabinet>("parametrage", "reglagesCabinet", [pv.cabinetTenantId]),
    api.rpc<Array<{ id: string; name: string }>>("supervision", "listMyCabinets", []),
  ]);
  const client = clients.find((c) => c.tenantId === pv.clientTenantId);
  if (!client) return { ok: false, raison: "sans_client", pv };
  const cabinet = cabinets.find((c) => c.id === pv.cabinetTenantId)?.name ?? "";

  // Les chiffres d'abord, et ils sont enregistrés quoi qu'il arrive au texte :
  // ils viennent des moteurs, ils ne dépendent pas du modèle.
  const chiffres = await rassemblerLesChiffres(api, pv.cabinetTenantId, client, pv.at);
  const ton = reglages.ton;

  const apiKey = process.env["DEEPSEEK_API_KEY"];
  if (!apiKey) {
    const sansTexte = await api.rpc<PvReunion>("collab", "pvEnregistrer", [
      { id: pv.id, chiffres, ton, sections: [], redigeParMalica: false },
    ]);
    return { ok: false, raison: "indisponible", pv: sansTexte };
  }

  const faits = chiffresEnFaits(chiffres, input.locale);
  const messages = consigne({
    locale: input.locale,
    ton,
    cabinet,
    client: client.name,
    jour: pv.at,
    finDuMois: finDuMois(pv.at.slice(0, 7)),
    presents: pv.participants,
    chiffres: faitsEnTexte(faits),
  });

  let sections: Array<{ kicker: string; corps: string }> | null = null;
  let raison: RaisonDEchec = "refuse";
  for (let tentative = 0; tentative < TENTATIVES && !sections; tentative += 1) {
    let reponse: string;
    try {
      reponse = await demander(apiKey, messages);
    } catch {
      raison = "indisponible";
      break;
    }
    const lues = lireSections(reponse);
    if (!lues) {
      messages.push(
        { role: "assistant", content: reponse },
        {
          role: "user",
          content:
            "Ta réponse n'est pas l'objet JSON attendu. Réponds uniquement par {\"sections\":[…]}, entre trois et cinq sections.",
        },
      );
      continue;
    }
    const etrangers = nombresEtrangers(texteDesSections(lues), faits);
    if (etrangers.length === 0) {
      sections = lues;
      break;
    }
    messages.push(
      { role: "assistant", content: reponse },
      {
        role: "user",
        content:
          `Ton texte contient des nombres qui ne figurent pas dans la liste CHIFFRES : ${etrangers.join(", ")}. ` +
          "Retire-les ou remplace-les par des mots. Aucun calcul, aucun pourcentage, aucune somme. Réponds à nouveau par l'objet JSON complet.",
      },
    );
  }

  const enregistre = await api.rpc<PvReunion>("collab", "pvEnregistrer", [
    sections
      ? { id: pv.id, chiffres, ton, sections, redigeParMalica: true }
      : { id: pv.id, chiffres, ton, sections: [], redigeParMalica: false },
  ]);
  return sections ? { ok: true, pv: enregistre } : { ok: false, raison, pv: enregistre };
}
