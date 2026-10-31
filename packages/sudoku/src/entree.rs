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
