//! Des pièces que le banc sans IA du 4 novembre 2026 laissait muettes, et qui se prouvent
//! désormais justes (`reperes::colonnes_de_libelles`, les charges annoncées par leur taux).
//! Les entrées sont celles du banc (`banc-sans-ia.ts --entrees`), une par variante de la
//! grille, sur des factures fictives du jeu d'ALGORIA ; la vérité est celle du jeu.

use serde_json::Value;

/// Les sorties de chaque variante, et la vérité de la pièce.
fn jouer(id: &str) -> (Vec<Value>, Value) {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json")).expect("jeu lisible");
    let cas: Vec<Value> = cas.into_iter().filter(|c| c["id"] == id).collect();
    assert!(!cas.is_empty(), "{id} absent du jeu");
    let sorties = cas
        .iter()
        .map(|c| serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible"))
        .collect();
    (sorties, cas[0]["verite"].clone())
}

/// « 1203.360 » en millimes.
fn millimes(v: &Value) -> String {
    let (e, d) = v.as_str().expect("vérité textuelle").split_once('.').expect("décimales");
    format!("{}{d:0<3}", e).trim_start_matches('0').to_string()
}

/// Une variante prouve la pièce, et chacun des champs de la vérité y est rendu juste.
fn prouvee_juste(id: &str) {
    let (sorties, verite) = jouer(id);
    let prouvees: Vec<&Value> = sorties.iter().filter(|o| o["issue"] == "prouvee").collect();
    assert_eq!(prouvees.len(), 1, "{id} : {sorties:?}");
    for (champ, v) in verite.as_object().expect("vérité") {
        assert_eq!(prouvees[0]["champs"][champ]["valeur"].as_str(), Some(millimes(v).as_str()), "{id} : {champ}");
        assert_eq!(prouvees[0]["champs"][champ]["statut"], "prouve", "{id} : {champ}");
    }
}

#[test]
fn une_colonne_de_libelles_apparie_ses_valeurs_par_l_ordre() {
    prouvee_juste("algoria-013");
}

#[test]
fn un_deux_points_perdu_ne_rompt_pas_la_colonne() {
    prouvee_juste("algoria-029");
}

#[test]
fn une_valeur_de_trop_dans_la_hauteur_ne_rompt_pas_l_appariement() {
    prouvee_juste("algoria-035");
}

#[test]
fn une_charge_s_annonce_par_son_taux_imprime_sans_mot() {
    prouvee_juste("algoria-054");
}
