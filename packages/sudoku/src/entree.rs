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
    /// Date ISO rendue par `normalizeDate`, ou `null`.
    #[serde(default)]
    pub date: Option<String>,
    /// Pour un jeton chiffré sans espace dont la partie entière a au moins 4 chiffres : ses
    /// coupes possibles en deux cases collées, lues par le lecteur de production. Le moteur
    /// ne fait que choisir une coupe fournie ; il ne relit jamais le texte.
    #[serde(default)]
    pub decoupes: Vec<Decoupe>,
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
}

#[derive(Deserialize, Clone)]
pub struct TauxBareme {
    pub code: String,
    pub ppm: i64,
}

#[derive(Deserialize, Clone)]
pub struct ChargePack {
    pub code: String,
    #[serde(default)]
    pub montant_fixe: Option<i64>,
    #[serde(default)]
    pub taux_ppm: Option<i64>,
    #[serde(default)]
    pub assiette_tva: bool,
}
