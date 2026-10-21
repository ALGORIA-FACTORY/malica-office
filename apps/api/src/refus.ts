/**
 * Distinguer un refus délibéré d'une panne.
 *
 * Le produit met ses règles métier dans la base, sous forme de déclencheurs :
 * « un compte collectif reçoit des tiers, pas des sous-comptes », « le rôle
 * n'admet que la classe 4 », « ce compte existe déjà dans le plan livré ». Ces
 * messages sont écrits POUR l'utilisateur, et ils sont souvent meilleurs que ce
 * qu'un écran saurait dire — ils nomment le compte, proposent la sortie.
 *
 * Les renvoyer tous serait pourtant une faute : le message d'une contrainte
 * PostgreSQL non interceptée dit « rompt la contrainte unique
 * « auxiliaires_tenant_id_nature_code_key » », ce qui livre un nom de table et
 * un nom d'index à qui n'a rien demandé.
 *
 * La frontière est nette et vérifiable. Un `raise exception ... using errcode`
 * écrit par nous ne renseigne NI `constraint`, NI `table`, NI `column` — ces
 * champs ne sont peuplés que par les violations que PostgreSQL détecte
 * lui-même. Un message sans eux est donc un message que quelqu'un a rédigé ;
 * un message avec eux est une fuite en puissance.
 */

/** Les codes que nos déclencheurs emploient pour refuser. */
const CODES_DE_REFUS = new Set([
  "23505", // unique_violation        — « ce compte existe déjà »
  "23503", // foreign_key_violation   — « ce rattachement n'existe pas »
  "23514", // check_violation         — « ce rôle n'admet que la classe 4 »
  "22023", // invalid_parameter_value — « juridiction requise »
  "P0002", // no_data_found           — « aucun compte relié à ce rôle »
  "42501", // insufficient_privilege  — « ce compte est officiel »
]);

/** Les règles de la base qui se nomment dans leur message, et ce qu'elles disent. */
const REGLES_NOMMEES: Readonly<Record<string, string>> = {
  chk_ecr_4eyes:
    "la supervision exige un second regard : celui qui a inscrit l'écriture ne la valide pas lui-même",
};

interface ErreurPostgres {
  code?: string;
  message?: string;
  constraint?: string;
  table?: string;
  column?: string;
}

/**
 * Les refus que PostgreSQL rédige lui-même — et que nous réécrivons.
 *
 * Deux erreurs sont de vrais refus adressés à l'appelant, mais aucun de nos
 * déclencheurs ne les lève : c'est le moteur qui parle, dans SA langue et avec
 * SES noms. « valeur en entrée invalide pour le enum app.validation_mode_t »
 * livre un schéma et un type ; « rompt la contrainte d'exclusion
 * "fiches_sans_chevauchement" » livre un nom de contrainte. Les taire rendait
 * `500 « erreur interne »` pour une faute de saisie (famille D29) ; les répéter
 * serait la fuite que ce fichier existe pour empêcher.
 *
 * Alors on les traduit : notre phrase, et d'elles on ne retient que ce qui
 * vient déjà de l'appelant — la valeur qu'il a proposée.
 *
 * La langue des messages de PostgreSQL suit la locale du serveur : français
 * sur le poste, anglais sur le staging. L'extraction accepte donc les deux
 * ponctuations, et se replie sur une phrase sans valeur plutôt que d'en
 * inventer une.
 */
const TRADUCTIONS: Record<string, (e: ErreurPostgres) => string> = {
  // invalid_text_representation — un mode de validation qui n'existe pas, une
  // date illisible, un identifiant tronqué.
  "22P02": (e) => {
    const m = /(?:«\s*(.*?)\s*»|"(.*?)")\s*$/.exec(e.message ?? "");
    const valeur = (m?.[1] ?? m?.[2])?.trim();
    return valeur
      ? `cette valeur n'est pas admise : « ${valeur} »`
      : "une des valeurs envoyées n'est pas admise";
  },
  // exclusion_violation — deux versions datées se chevauchent : une fiche
  // fiscale réécrite à la date où commence déjà la précédente, par exemple.
  "23P01": () =>
    "une version couvre déjà cette période : faites commencer la nouvelle à une autre date",
  // Campagne du 21 octobre 2026 (ANO-036) : ces refus du moteur sortaient en 500.
  // not_null_violation — un champ requis manque.
  "23502": () => "une valeur obligatoire manque",
  // string_data_right_truncation — un texte plus long que la colonne.
  "22001": () => "un des textes envoyés est trop long",
  // numeric_value_out_of_range — un montant ou une quantité hors limites.
  "22003": () => "un des nombres envoyés est hors limites",
  // invalid_datetime_format, datetime_field_overflow — une date illisible.
  "22007": () => "une des dates envoyées n'est pas lisible",
  "22008": () => "une des dates envoyées n'existe pas",
  // character_not_in_repertoire, untranslatable_character — un octet nul.
  "22021": () => "un des textes envoyés contient un caractère illisible",
  "22P05": () => "un des textes envoyés contient un caractère illisible",
};

/**
 * Rend le message si l'erreur est un refus rédigé, `null` sinon.
 *
 * `null` ne veut pas dire « tout va bien » : il veut dire « cette erreur n'a pas
 * été écrite pour être lue par un utilisateur », et l'appelant doit alors
 * répondre comme pour n'importe quelle panne.
 */
export function refusLisible(erreur: unknown): string | null {
  if (typeof erreur !== "object" || erreur === null) return null;
  const e = erreur as ErreurPostgres;

  if (!e.code) return null;

  // Traduit avant tout filtre : on ne répète jamais la phrase du moteur, donc
  // les champs qu'il a peuplés ne menacent rien ici.
  const traduire = TRADUCTIONS[e.code];
  if (traduire) return traduire(e);

  if (!CODES_DE_REFUS.has(e.code)) return null;

  /*
   * Recette du 20 octobre 2026 : « new row violates row-level security policy
   * for table … » s'affichait tel quel (invitations, écritures). C'est un
   * refus — la personne n'a pas ce droit sur ce dossier —, mais la phrase est
   * celle du moteur et nomme une table. On dit le refus, pas la table.
   */
  if (e.code === "42501" && /row-level security|sécurité au niveau ligne/i.test(e.message ?? ""))
    return "ce geste ne vous est pas permis sur ce dossier";

  // Peuplés par PostgreSQL, jamais par un `raise` : c'est la signature d'une
  // violation détectée par le moteur, dont le message porte des noms internes.
  if (e.constraint || e.table || e.column) {
    // Un doublon détecté par un index unique reste un refus lisible — sans
    // le nom de l'index (recette : « ce compte existe déjà » rendait un 500).
    if (e.code === "23505") return "cet élément existe déjà";
    // Campagne du 21 octobre 2026 (ANO-036) : une famille, une catégorie ou
    // un compte inconnus, une valeur hors de la liste admise, une valeur
    // obligatoire absente sortaient en 500. Ce sont des fautes de saisie :
    // notre phrase, jamais le nom de la contrainte.
    if (e.code === "23503") return "ce rattachement n'existe pas, ou n'est plus disponible";
    if (e.code === "23514") return "une des valeurs envoyées n'est pas admise";
    return null;
  }

  const message = e.message?.trim();
  if (!message) return null;
  // Une règle de la base qui se nomme en tête de son message (« chk_… : »)
  // se dit par sa phrase, jamais par son nom (recette du cabinet, ANO-CAB-005).
  const regle = /^(\w+) :/.exec(message)?.[1];
  return (regle && REGLES_NOMMEES[regle]) ?? message;
}

/**
 * L'objet demandé n'existe pas — ou n'est pas visible pour l'appelant.
 *
 * Les dépôts lèvent `piece.not_found`, `organisation.introuvable`… : des
 * codes, pas des phrases. Ils sortaient en 500 « erreur interne » (recette du
 * 20 octobre 2026, pièce d'un autre dossier ou inexistante). Ce n'est pas
 * une panne : c'est un 404, et l'on ne distingue pas « n'existe pas » de
 * « pas pour vous » — distinguer les deux renseignerait un curieux.
 */
export function introuvableLisible(erreur: unknown): string | null {
  if (!(erreur instanceof Error)) return null;
  return /^[a-z_]+\.(not_found|introuvable)$/.test(erreur.message)
    ? "introuvable, ou vous n'y avez pas accès"
    : null;
}
