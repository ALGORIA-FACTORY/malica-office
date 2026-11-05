//! L'entrée du moteur (contrat §3) : le plan de jetons déjà lu, la grille du
//! type de document et les paramètres du pack. Rien ici n'a de valeur par
//! défaut réglementaire : un champ absent de l'entrée reste absent (R4).

use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct Entree {
    pub jetons: Vec<Jeton>,
    pub grille: Grille,
    pub pack: Pack,
    /// Plafond de combinaisons explorées ; au-delà, l'issue est `aucune`.
    #[serde(default)]
    pub plafond: Option<u64>,
    /// Ce que la base sait du dossier et de ses tiers (anneau 2). Absent : l'en-tête
    /// se lit par le format et les repères seuls.
    #[serde(default)]
    pub connus: Option<Connus>,
    /// Les marques vues sans modèle sur la pièce (les cachets du second lecteur).
    #[serde(default)]
    pub marques: Vec<Marque>,
    /// Les jetons sont le texte EXACT de la pièce (la couche de texte d'un PDF), pas une
    /// lecture de l'image : un identifiant y est imprimé tel quel.
    #[serde(default)]
    pub texte_exact: bool,
}

/// Une marque de la page qui n'est pas un texte : un cachet d'encre. Sa page et sa boîte
/// sont dans l'entrée ; le moteur n'en lit que le genre.
#[derive(Deserialize)]
pub struct Marque {
    #[serde(rename = "type")]
    pub genre: String,
}

/// Les données du dossier et de ses tiers, lues en base par l'adaptateur.
#[derive(Deserialize, Default)]
pub struct Connus {
    #[serde(default)]
    pub dossier: Option<Partie>,
    #[serde(default)]
    pub tiers: Vec<Tiers>,
    /// Les formes juridiques (« SARL », « SA »…) que la comparaison des raisons
    /// sociales ignore : des mots du catalogue, fournis en entrée, jamais en dur.
    #[serde(default)]
    pub formes_juridiques: Vec<String>,
    /// Le sens de la pièce DÉCLARÉ par la personne (« achat », « vente ») : à la capture,
    /// ou corrigé après la lecture. Il place le dossier (client d'un achat, émetteur d'une
    /// vente) ; l'autre matricule est le tiers. Les indices de la pièce, unanimes contre
    /// lui, le font signaler — jamais recopier.
    #[serde(default)]
    pub sens: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Partie {
    pub matricule: String,
    #[serde(default)]
    pub raison_sociale: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Tiers {
    pub code: String,
    pub matricule: String,
    #[serde(default)]
    pub raison_sociale: Option<String>,
}

#[derive(Deserialize, Clone)]
pub struct Jeton {
    pub page: u32,
    pub ordinal: u32,
    #[serde(default)]
    pub texte: String,
    #[serde(default)]
    pub x0: f64,
    #[serde(default)]
    pub y0: f64,
    #[serde(default)]
    pub x1: f64,
    #[serde(default)]
    pub y1: f64,
    /// Lectures du treillis, en unités mineures. Le moteur ne relit jamais le texte.
    #[serde(default)]
    pub montants: Vec<Lecture>,
    /// La confiance de l'OCR dans ce jeton (0..1) ; absente, il est exact (couche de
    /// texte d'un PDF).
    #[serde(default)]
    pub confiance: Option<f64>,
    /// Le jeton porte un mot que l'OCR a pu mal lire (le lexique de l'adaptateur le dit).
    #[serde(default)]
    pub douteux: bool,
    /// La probabilité du caractère le MOINS sûr du mot (0..1), quand le lecteur la donne :
    /// la confiance d'une ligne en est la moyenne, où un mot sous une tache se noie.
    #[serde(default)]
    pub faible: Option<f64>,
    /// Date ISO rendue par `normalizeDate`, ou `null`.
    #[serde(default)]
    pub date: Option<String>,
    /// Quand la date s'écrit sur plusieurs jetons d'une rangée (« 13 mai 2026 ») : l'ordinal
    /// du dernier. La date est portée par le premier ; la citation couvre toute la plage.
    #[serde(default)]
    pub date_fin: Option<u32>,
    /// Les identifiants que le lecteur du pack lit dans ce jeton (jusqu'au jeton `fin`) :
    /// la valeur normalisée, sous le code de son format. Le moteur ne relit pas le texte.
    #[serde(default)]
    pub identifiants: Vec<IdentifiantLu>,
    /// Le montant écrit en toutes lettres qui commence à ce jeton, lu par l'adaptateur dans
    /// la devise de la pièce (unités mineures), jusqu'au jeton `fin`.
    #[serde(default)]
    pub lettres: Option<LettresLues>,
    /// Pour un jeton chiffré sans espace dont la partie entière a au moins 4 chiffres : ses
    /// coupes possibles en deux cases collées, lues par le lecteur de production. Le moteur
    /// ne fait que choisir une coupe fournie ; il ne relit jamais le texte.
    #[serde(default)]
    pub decoupes: Vec<Decoupe>,
}

impl Jeton {
    /// Un texte qu'aucun calcul ne prouve (une désignation, un nom) ne se rend pas lu par ce
    /// jeton : un mot que le lexique de l'adaptateur dit douteux, une ligne lue sous la
    /// confiance du texte, ou un caractère du mot lu sous la confiance du caractère.
    pub fn incertain(&self, pack: &Pack) -> bool {
        self.douteux
            || pack.confiance_du_texte.is_some_and(|s| self.confiance.is_some_and(|c| c < s))
            || pack.confiance_du_caractere.is_some_and(|s| self.faible.is_some_and(|f| f < s))
    }
}

/// Un identifiant lu par l'adaptateur (`normaliserMatricule`, forme du pack).
#[derive(Deserialize, Clone)]
pub struct IdentifiantLu {
    pub format: String,
    pub valeur: String,
    pub fin: u32,
}

/// Un montant en toutes lettres lu par l'adaptateur, en unités mineures.
#[derive(Deserialize, Clone, Copy)]
pub struct LettresLues {
    pub v: i64,
    pub fin: u32,
}

/// Une coupe d'un jeton : `coupe` caractères à gauche lus comme un entier (en unités
/// mineures), le reste lu comme un montant.
#[derive(Deserialize, Clone)]
pub struct Decoupe {
    pub coupe: usize,
    pub gauche: i64,
    #[serde(default)]
    pub droite: Vec<Lecture>,
}

#[derive(Deserialize, Clone, Copy)]
pub struct Lecture {
    pub v: i64,
    pub forte: bool,
}

#[derive(Deserialize)]
pub struct Grille {
    pub champs: Vec<Champ>,
    #[serde(default)]
    pub preuves: Vec<Preuve>,
}

#[derive(Deserialize)]
pub struct Champ {
    pub code: String,
    #[serde(rename = "type")]
    pub genre: String,
    #[serde(default)]
    pub reperes_fr: Vec<String>,
    #[serde(default)]
    pub reperes_ar: Vec<String>,
    #[serde(default)]
    pub format_code: Option<String>,
    /// La famille d'experts du concept du champ (`ref.concepts.expert`).
    #[serde(default)]
    pub expert: Option<String>,
    /// La parcelle de la grille où le champ s'imprime.
    #[serde(default)]
    pub parcelle: Option<String>,
    /// La partie que le champ décrit (`ref.grille_champs.role`), s'il en décrit une.
    #[serde(default)]
    pub role: Option<String>,
    /// Le champ appartient à une parcelle répétée (une occurrence par ligne) : il ne se lit
    /// pas comme un champ unique de la pièce.
    #[serde(default)]
    pub repetee: bool,
    /// La marque qu'un champ de présence attend (« cachet », `ref.grille_champs.marque`).
    #[serde(default)]
    pub marque: Option<String>,
    /// Le domaine d'un champ « liste » : chaque code et ses formes imprimables (le libellé du
    /// code dans les trois langues, ses marques). Présent, le champ ne se lit qu'en un code.
    #[serde(default)]
    pub valeurs: Vec<ValeurDuDomaine>,
}

#[derive(Deserialize, Clone)]
pub struct ValeurDuDomaine {
    pub code: String,
    #[serde(default)]
    pub formes: Vec<String>,
}

#[derive(Deserialize)]
pub struct Preuve {
    pub code: String,
    #[serde(default)]
    pub expression: Option<serde_json::Value>,
    #[serde(default)]
    pub statut: Option<String>,
}

#[derive(Deserialize)]
pub struct Pack {
    pub decimales: u32,
    pub tolerance: i64,
    #[serde(default)]
    pub baremes: HashMap<String, Vec<TauxBareme>>,
    #[serde(default)]
    pub charges: Vec<ChargePack>,
    #[serde(default)]
    pub formats: HashMap<String, String>,
    /// La confiance de lecture au-dessous de laquelle un TEXTE qu'aucun calcul ne prouve
    /// (une désignation) n'est pas rendu (`lecture.confiance_du_texte`) ; absente, tout
    /// texte lu est rendu.
    #[serde(default)]
    pub confiance_du_texte: Option<f64>,
    /// La probabilité au-dessous de laquelle le caractère le moins sûr d'un mot (`faible`)
    /// rend ce mot incertain (`lecture.confiance_du_caractere`) ; absente, rien n'est lu
    /// au caractère.
    #[serde(default)]
    pub confiance_du_caractere: Option<f64>,
    /// Les taux nuls de chaque barème (`EXO`, `EXPORT`), par leur code. Ils ne sont pas dans
    /// `baremes` : un zéro imprimé fermerait n'importe quelle instance « 0 % ». Ils ne servent
    /// qu'à NOMMER la part exonérée d'une exonération partielle prouvée par les lignes.
    #[serde(default)]
    pub taux_nuls: HashMap<String, Vec<String>>,
}

#[derive(Deserialize, Clone)]
pub struct TauxBareme {
    pub code: String,
    pub ppm: i64,
}

#[derive(Deserialize, Clone)]
pub struct ChargePack {
    pub code: String,
    /// Le montant standard (`ref.fiscal_charges`). Gardé pour compatibilité : il compte
    /// parmi les montants admis.
    #[serde(default)]
    pub montant_fixe: Option<i64>,
    /// Tout montant que le pack admet pour cette charge au jour de la pièce : le standard et
    /// les tranches de son barème, toutes catégories (`ref.baremes_des_droits`). Le lecteur
    /// ne juge pas la conformité — le Socle le fait ensuite : il reconnaît un montant admis.
    #[serde(default)]
    pub montants_admis: Vec<i64>,
    #[serde(default)]
    pub taux_ppm: Option<i64>,
    #[serde(default)]
    pub assiette_tva: bool,
}
