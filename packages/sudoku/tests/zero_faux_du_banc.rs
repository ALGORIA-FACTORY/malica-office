//! Les dernières valeurs fausses ou inventées du banc sans IA du 4 novembre 2026, et la
//! cause exacte de chacune, corrigée. Les entrées sont celles du banc
//! (`banc-sans-ia.ts --entrees`), une par variante de la grille, sur des pièces fictives
//! (jeu d'ALGORIA, jeu du dirigeant). Une valeur affirmée — `prouve` ou `conforme` — l'est
//! juste, ou elle se tait.

use serde_json::Value;

fn sorties(id: &str) -> Vec<Value> {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/zero_faux_du_banc.json")).expect("jeu lisible");
    let v: Vec<Value> = cas
        .into_iter()
        .filter(|c| c["id"] == id)
        .map(|c| serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible"))
        .collect();
    assert!(!v.is_empty(), "{id} absent du jeu");
    v
}

fn affirme(o: &Value, champ: &str) -> bool {
    matches!(o["champs"][champ]["statut"].as_str(), Some("prouve" | "conforme"))
}

fn instances(o: &Value, champ: &str) -> Vec<(String, String)> {
    o["champs"][champ]["instances"]
        .as_array()
        .map(|v| v.iter().map(|i| (i["taux"].as_str().unwrap_or("").into(), i["valeur"].as_str().unwrap_or("").into())).collect())
        .unwrap_or_default()
}

fn designations(o: &Value) -> Vec<Option<String>> {
    o["lignes"]["instances"]
        .as_array()
        .map(|v| v.iter().map(|l| l["designation"]["valeur"].as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// « Total 304,000 », seul : net à rembourser = total − avance (absente) fermait sur ce même
/// jeton. Une valeur imprimée une fois n'est lue que pour un champ.
#[test]
fn une_valeur_imprimee_une_fois_n_est_pas_deux_champs() {
    for o in sorties("algoria-135") {
        assert!(!affirme(&o, "net_a_rembourser"), "{o}");
        assert_ne!(o["issue"], "prouvee", "une preuve qui ne compare un jeton qu'à lui-même : {o}");
    }
}

/// L'exonération partielle prouvée par les lignes : la part exonérée est une instance de la
/// ventilation, nommée par le taux nul que la grille désigne.
#[test]
fn la_part_exoneree_est_dans_la_ventilation() {
    let prouvees: Vec<Value> = sorties("algoria-102").into_iter().filter(|o| o["issue"] == "prouvee").collect();
    assert_eq!(prouvees.len(), 1);
    let o = &prouvees[0];
    let paire = |a: &str, b: &str| (a.to_string(), b.to_string());
    assert_eq!(instances(o, "base_tva_par_taux"), vec![paire("TVA19", "33545000"), paire("EXO", "4032000")]);
    assert_eq!(instances(o, "montant_tva_par_taux"), vec![paire("TVA19", "6373550"), paire("EXO", "0")]);
    assert_eq!(o["lignes"]["taux_par_base"], "verifiee");
}

/// Deux « RC: » sur la page : le libellé ne dit pas de quelle partie est la valeur.
#[test]
fn le_registre_d_une_partie_ne_se_prend_pas_au_voisin() {
    for o in sorties("algoria-034") {
        let c = &o["champs"]["registre_commerce_emetteur"];
        assert!(!affirme(&o, "registre_commerce_emetteur") || c["valeur"] == "B494067962022", "{c}");
    }
}

/// Sans en-tête reconnu, la seconde ligne d'une désignation (« (Android) selon devis … de
/// 28 000,000 DT HT ») ne se distingue pas d'un autre texte : la désignation se tait.
#[test]
fn une_designation_peut_etre_coupee_se_tait() {
    for o in sorties("dirigeant-50_32") {
        for d in designations(&o).into_iter().flatten() {
            assert!(d.contains("Android"), "désignation tronquée affirmée : {d}");
        }
    }
}

/// Une désignation sur trois lignes, les chiffres sur celle du milieu : la tête compte.
#[test]
fn une_designation_sur_trois_lignes_reste_entiere() {
    let lues: Vec<Vec<Option<String>>> =
        sorties("dirigeant-50_08").iter().filter(|o| o["issue"] == "prouvee").map(designations).collect();
    assert_eq!(lues.len(), 1);
    assert_eq!(
        lues[0][0].as_deref(),
        Some("Loyer mensuel local a usage de bureaux - Immeuble Le Prestige, 3e étage (Sept. 2026)")
    );
}
