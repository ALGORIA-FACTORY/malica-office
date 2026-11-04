//! Les colonnes de texte d'un tableau se déduisent de son en-tête et des rangées prouvées
//! (`lignes::colonnes`) : la désignation ne prend que SA colonne.
//!
//! Banc sans IA du 4 novembre 2026 : 307 désignations avalaient la référence, le
//! code-barres ou l'unité imprimés à côté. Les entrées sont celles du banc
//! (`banc-sans-ia.ts --entrees`) sur des factures fictives du jeu d'ALGORIA.

use serde_json::Value;

fn designations(id: &str) -> (Vec<String>, Vec<String>) {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/colonnes_du_tableau.json")).expect("jeu lisible");
    let c = cas.into_iter().find(|c| c["id"] == id).expect("cas présent");
    let s: Value = serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible");
    let lues = s["lignes"]["instances"]
        .as_array()
        .expect("lignes prouvées")
        .iter()
        .map(|l| l["designation"]["valeur"].as_str().unwrap_or_default().to_string())
        .collect();
    let vraies = c["designations"].as_array().expect("vérité").iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect();
    (lues, vraies)
}

#[test]
fn la_reference_et_le_code_barres_restent_dans_leurs_colonnes() {
    let (lues, vraies) = designations("algoria-001");
    assert_eq!(lues, vraies);
}

#[test]
fn le_couloir_blanc_borne_la_colonne() {
    let (lues, _) = designations("algoria-039");
    assert!(lues.iter().any(|d| d == "Prestation de déménagement de bureaux"), "{lues:?}");
}

#[test]
fn une_designation_arabe_se_lit_depuis_sa_droite() {
    let (lues, vraies) = designations("algoria-093");
    for (l, v) in lues.iter().zip(&vraies) {
        assert_eq!(l.split_whitespace().next(), v.split_whitespace().next(), "{lues:?}");
    }
}
