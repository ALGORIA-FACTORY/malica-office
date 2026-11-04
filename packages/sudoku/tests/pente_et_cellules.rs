//! Une ligne d'articles suit la pente de sa page, et une cellule sur deux lignes reste une
//! cellule (`lignes::pentes`, `lignes::rangees`, `lignes::en_lignes`).
//!
//! Banc sans IA du 4 novembre 2026 : sur une page photographiée de travers, le montant
//! d'une ligne ne recouvrait plus sa référence, la ligne se coupait en deux et le tableau
//! n'était pas lu (MyTek, 5 articles sur 5 perdus) ; une désignation sur deux lignes, les
//! chiffres centrés entre elles, perdait sa première ligne au profit de l'article
//! précédent. Les entrées sont celles du banc (`banc-sans-ia.ts --entrees`) sur des
//! factures fictives du jeu d'ALGORIA.

use serde_json::Value;

fn lues(id: &str) -> (Vec<Option<String>>, Vec<String>) {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/pente_et_cellules.json")).expect("jeu lisible");
    let c = cas.into_iter().find(|c| c["id"] == id).expect("cas présent");
    let s: Value = serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible");
    assert_eq!(s["lignes"]["statut"], "prouve", "{id} : lignes non prouvées");
    let lues = s["lignes"]["instances"]
        .as_array()
        .expect("lignes")
        .iter()
        .map(|l| l["designation"]["valeur"].as_str().map(str::to_string))
        .collect();
    let vraies = c["designations"].as_array().expect("vérité").iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect();
    (lues, vraies)
}

#[test]
fn une_page_inclinee_garde_ses_lignes_entieres() {
    let (lues, vraies) = lues("algoria-016");
    assert_eq!(lues, vraies.into_iter().map(Some).collect::<Vec<_>>());
}

#[test]
fn une_designation_sur_deux_lignes_aux_chiffres_centres_reste_entiere() {
    let (lues, vraies) = lues("algoria-114");
    assert_eq!(lues, vraies.into_iter().map(Some).collect::<Vec<_>>());
}

#[test]
fn une_designation_lue_sans_assurance_est_tue_et_la_ligne_reste() {
    let (lues, vraies) = lues("algoria-087");
    assert_eq!(lues.len(), vraies.len());
    assert!(lues.iter().all(Option::is_none), "{lues:?}");
}
