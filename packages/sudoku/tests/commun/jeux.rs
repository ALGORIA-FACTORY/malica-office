//! Les deux jeux de factures FICTIVES du dirigeant (« 100/… » et « 50/… »), au format
//! d'entrée du moteur, et le jeu des variantes de la grille comme l'adaptateur
//! (`resoudreLaPiece`, apps/api/src/malica/lecture/sudoku.ts).

use super::donnees;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Instant;

/// Jeton compact : [page, ordinal, texte, x0, y0, x1, y1, [[v, forte]…], date].
pub type JetonCompact = (
    u32,
    u32,
    String,
    f64,
    f64,
    f64,
    f64,
    Vec<(i64, u8)>,
    Option<String>,
);

#[derive(Deserialize)]
pub struct Piece<V> {
    pub id: String,
    pub verite: V,
    pub jetons: Vec<JetonCompact>,
}

pub fn jeton(j: &JetonCompact) -> Value {
    let ms: Vec<Value> =
        j.7.iter()
            .map(|(v, f)| json!({"v": v, "forte": *f == 1}))
            .collect();
    json!({"page": j.0, "ordinal": j.1, "texte": j.2, "x0": j.3, "y0": j.4, "x1": j.5, "y1": j.6,
           "montants": ms, "date": j.8})
}

pub fn pieces<V: DeserializeOwned>() -> Vec<Piece<V>> {
    serde_json::from_str(&donnees("jeux_dirigeant_jetons.json")).unwrap()
}

/// Le jeu d'une pièce : « 100 » ou « 50 ».
pub fn jeu(id: &str) -> &str {
    id.split('/').next().unwrap()
}

/// La grille facture et le pack livrés par la base.
pub fn en_base() -> (Value, Value) {
    let c: Value = serde_json::from_str(&donnees("grille_facture_en_base.json")).unwrap();
    (c["grille"].clone(), c["pack"].clone())
}

/// La preuve des lignes (anneau 1), ajoutée à la grille en attendant sa migration.
pub fn preuve_lignes(code: &str) -> Value {
    json!({
        "code": code,
        "regle": "Σ montants des lignes (q × PU × (1 − remise)) = total HT",
        "genre": "arithmetique",
        "statut": "defaut_a_valider",
        "variante": null,
        "expression": {"op": "lignes", "designation": "designation", "quantite": "quantite",
                       "prix": "prix_unitaire_ht", "remise": "remise_ligne?", "montant": "montant_ligne_ht",
                       "taux": "taux_tva_ligne?", "total": "total_ht", "total_brut": "total_brut_ht?",
                       "remise_globale": "remise_globale?"}
    })
}

/// Chaque variante jouée seule.
pub fn par_variante(jetons: &[Value], grille: &Value, pack: &Value) -> Vec<(String, Value)> {
    par_variante_avec(jetons, grille, pack, None).0
}

/// Les variantes, avec les `connus` de l'entrée, et le temps passé dans le moteur seul (µs).
pub fn par_variante_avec(
    jetons: &[Value],
    grille: &Value,
    pack: &Value,
    connus: Option<&Value>,
) -> (Vec<(String, Value)>, u128) {
    par_variante_selon(jetons, grille, pack, connus, false)
}

/// Les variantes, les jetons étant, ou non, le texte exact de la pièce (`texte_exact` : la
/// couche de texte d'un PDF).
pub fn par_variante_selon(
    jetons: &[Value],
    grille: &Value,
    pack: &Value,
    connus: Option<&Value>,
    texte_exact: bool,
) -> (Vec<(String, Value)>, u128) {
    let mut moteur = 0;
    let preuves = grille["preuves"].as_array().unwrap();
    let mut noms: Vec<String> = preuves
        .iter()
        .filter_map(|p| p["variante"].as_str().map(String::from))
        .collect();
    noms.sort();
    noms.dedup();
    let jouees = noms
        .into_iter()
        .map(|v| {
            let mut g = grille.clone();
            g["preuves"] = Value::Array(
                preuves
                    .iter()
                    .filter(|p| p["variante"].is_null() || p["variante"] == v.as_str())
                    .cloned()
                    .collect(),
            );
            let mut e = json!({"jetons": jetons, "grille": g, "pack": pack});
            if let Some(c) = connus {
                e["connus"] = c.clone();
            }
            if texte_exact {
                e["texte_exact"] = Value::Bool(true);
            }
            let e = e.to_string();
            let t0 = Instant::now();
            let s = malica_sudoku::solve(&e);
            moteur += t0.elapsed().as_micros();
            (v, serde_json::from_str(&s).unwrap())
        })
        .collect();
    (jouees, moteur)
}

/// La combinaison des variantes, comme l'adaptateur : prouvée si toutes celles qui
/// prouvent s'accordent sur HT et TVA par taux, ambiguë sinon.
pub fn la_piece(jouees: &[(String, Value)]) -> Value {
    let prouvees: Vec<&Value> = jouees
        .iter()
        .map(|(_, o)| o)
        .filter(|o| o["issue"] == "prouvee")
        .collect();
    if prouvees.is_empty() {
        return jouees
            .iter()
            .map(|(_, o)| o)
            .find(|o| o["issue"] == "ambigue")
            .unwrap_or(&jouees[0].1)
            .clone();
    }
    let empreinte = |o: &Value| {
        let tva: Vec<(Value, Value)> = o["champs"]["montant_tva_par_taux"]["instances"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|i| (i["taux"].clone(), i["valeur"].clone()))
                    .collect()
            })
            .unwrap_or_default();
        (o["champs"]["total_ht"]["valeur"].clone(), tva)
    };
    let mut p = prouvees[0].clone();
    if prouvees
        .iter()
        .any(|o| empreinte(o) != empreinte(prouvees[0]))
    {
        p["issue"] = json!("ambigue");
    }
    p
}
