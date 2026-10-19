/**
 * Exécuter une GÉNÉRATION prise dans la file — le travail que personne ne
 * déclenchait.
 *
 * ================================================================= POURQUOI
 *
 * `02-ce-qui-est-livre.md`, limite 6 : « Rien ne déclenche une génération en
 * production. La forme juste est un travail de la file, à côté de la
 * lecture. » Le générateur existait, éprouvé, et ne s'appelait que depuis
 * `tests/real/fabriquer-une-recette.ts`, à la main, par un humain qui pose
 * cinq variables d'environnement. La fabrique entière en était inerte.
 *
 * Ce fichier est l'autre moitié : ce que le coureur fait quand le travail
 * qu'il vient de prendre est une génération. Il ne décide RIEN — ni quand
 * générer (c'est `fabrique.generation_proposer`), ni si la recette est bonne
 * (c'est le validateur, puis l'évaluation). Il enchaîne, dans le même ordre
 * que l'épreuve manuelle, et par les MÊMES fonctions : le chemin automatique
 * n'est pas une seconde implémentation du chemin éprouvé.
 *
 * ============================================= TROIS TRANSACTIONS, ET C'EST LE POINT
 *
 * L'appel au modèle dure des dizaines de secondes. La base coupe une
 * transaction inactive bien avant. On lit l'amont, on referme ; on appelle le
 * modèle hors transaction ; on écrit l'aval. C'est la même raison qui fait
 * que la prise d'un travail est commise avant son exécution.
 *
 * ================================================== R8 — LE JOURNAL PART TOUJOURS
 *
 * Une génération est un appel PAYANT, et son coût entre dans le coût total
 * par document. La ligne de journal part donc dans tous les cas, réussite ou
 * refus : un appel refusé a coûté autant qu'un appel retenu.
 * `public.agents_run_log` LÈVE s'il ne trouve pas de tarif pour le couple
 * (modèle, rôle) — on ne rattrape pas cette levée. Une dépense qui ne se
 * journalise pas est une dépense qui disparaît, et ce défaut s'est manifesté
 * quatre fois dans ce dépôt.
 *
 * ============================================ CE QU'UN REFUS N'EST PAS
 *
 * Un refus du générateur — ossature vide, ancre hors vocabulaire, recette
 * invalide, ne reproduit pas ses exemples — est un REFUS MÉTIER, pas une
 * panne. Le rejouer redemanderait la même chose au même modèle sur les mêmes
 * exemples, et paierait deux fois pour la même réponse. Le travail se ferme,
 * avec le code du refus pour motif. Un transport qui tombe, lui, est une
 * panne fournisseur : celle-là se rejoue.
 */

import { fabrique } from "../depots/fabrique.ts";

import { proposerUneRecette, type AppelDeGenerateur } from "./generateur.ts";
import { PanneFournisseur, RefusMetier, type AvecBase } from "./travaux-execution.ts";

/** Ce qu'une génération aboutie a écrit. Un refus ne rend rien : il lève. */
export interface GenerationInscrite {
  readonly recetteId: string;
  readonly versionId: string;
  readonly rang: number;
  readonly agentRunId: string | null;
}

/**
 * Prend un travail de génération et le mène jusqu'à la candidate inscrite.
 *
 * Lève `RefusMetier` quand le générateur refuse, `PanneFournisseur` quand le
 * transport tombe : c'est `executerUnTravail` qui traduit les deux en faits,
 * et c'est la base qui décide ce qu'on rejoue.
 */
export async function executerUneGeneration(
  avecBase: AvecBase,
  travail: { readonly tenantId: string; readonly signatureCle: string },
  appeler: AppelDeGenerateur,
): Promise<GenerationInscrite> {
  const amont = await avecBase(async (db) => {
    const contexte = await fabrique.contexteDeDesignation(db, travail.tenantId);
    const exemples = await fabrique.exemplesDApprentissage(
      db,
      travail.tenantId,
      travail.signatureCle,
    );
    /*
     * Les codes du pack, dans la MÊME transaction que le reste de l'amont.
     *
     * Ils entrent dans l'invite comme la liste des codes de droit et de taux
     * autorisés, exactement comme l'invite du désignateur le fait déjà. Rien
     * n'y est écrit en TypeScript (R4), et une organisation sans juridiction
     * LÈVE au lieu de se voir attribuer un pack par défaut.
     */
    const codes = await fabrique.codesDuReferentiel(db, travail.tenantId);
    return { signature: contexte.signature, bornes: contexte.bornes, exemples, codes };
  });

  /*
   * Le seuil a été atteint quand la génération a été proposée ; il peut ne
   * plus l'être quand elle s'exécute — une pièce supprimée emporte ses
   * exemples. On ne refait pas le compte ici (R3 : la règle est en base) :
   * `proposerUneRecette` refuse de lui-même sous le plancher technique, et ce
   * refus est le bon, avec son propre code.
   */
  const generation = await proposerUneRecette(
    amont.exemples.map((e) => {
      /*
       * L'enveloppe d'un `attendu` stocké porte trois sections, et une
       * seulement est obligatoire. `champs` existait ; `droits` et
       * `codes_de_taux` sont entrés le 20 octobre, sans migration — un `jsonb`
       * accepte une clé de plus, et un exemple écrit avant n'en porte pas, ce
       * qui se lit « cet exemple n'affirme rien là-dessus ». Ce n'est pas un
       * défaut implicite : rien ne l'ayant dit, rien ne sera proposé.
       */
      const enveloppe = e.attendu as {
        champs?: Record<string, never>;
        droits?: Record<string, never>;
        codes_de_taux?: string[];
      };
      return {
        pieceId: e.pieceId,
        plan: e.plan,
        attendu: enveloppe.champs ?? {},
        droitsAttendus: enveloppe.droits ?? {},
        codesDeTaux: enveloppe.codes_de_taux ?? [],
      };
    }),
    amont.bornes,
    amont.signature,
    amont.codes,
    async (invite) => {
      try {
        return await appeler(invite);
      } catch (erreur) {
        // Le transport est tombé : c'est la SEULE chose qu'on rejoue.
        throw new PanneFournisseur(
          `le générateur n'a pas répondu : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    },
  );

  const journal = generation.ok
    ? {
        modele: generation.provenance.modele,
        role: generation.provenance.role,
        latenceMs: generation.provenance.latenceMs,
        tokensIn: generation.provenance.tokensIn,
        tokensOut: generation.provenance.tokensOut,
        statut: "ok",
        erreur: null as string | null,
      }
    : generation.journal === null
      ? null
      : {
          modele: generation.journal.modele,
          role: generation.journal.role,
          latenceMs: generation.journal.latenceMs,
          tokensIn: generation.journal.tokensIn,
          tokensOut: generation.journal.tokensOut,
          /*
           * « error », et pas « refus » : `agents.agent_runs` porte un
           * `check` sur ok / degraded / error. L'epreuve manuelle ecrivait
           * « refus » — elle n'avait jamais rencontre un refus avec journal,
           * et la ligne aurait ete REFUSEE par la base, donc la depense
           * perdue. C'est la cinquieme fois que ce depot perd une mesure de
           * cette facon.
           */
          statut: "error",
          erreur: generation.refus.code as string | null,
        };

  /*
   * Le journal d'abord, et sans condition. Il n'y a de `null` que lorsque le
   * modèle n'a PAS été appelé — refus en amont de l'invite —, et il n'y a
   * alors rien à facturer.
   */
  const agentRunId = journal
    ? await avecBase(async (db) =>
        fabrique.journaliserUneGeneration(db, { tenantId: travail.tenantId, ...journal }),
      )
    : null;

  if (!generation.ok) {
    throw new RefusMetier(`${generation.refus.code} : ${generation.refus.detail}`);
  }

  const inscrite = await avecBase(async (db) =>
    fabrique.inscrireUneCandidate(db, {
      tenantId: travail.tenantId,
      libelle: travail.signatureCle,
      signatureCle: travail.signatureCle,
      portee: "organisation",
      definition: generation.recette,
      empreinte: generation.empreinte,
      provenance: { ...generation.provenance, agentRunId },
      exemples: amont.exemples.map((e) => e.exempleId),
      motif: "proposée par le générateur, au seuil du référentiel",
    }),
  );

  return { ...inscrite, agentRunId };
}
