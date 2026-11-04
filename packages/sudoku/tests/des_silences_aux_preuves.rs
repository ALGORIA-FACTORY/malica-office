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

#[test]
fn une_mention_d_exoneration_en_plusieurs_jetons_s_annonce() {
    prouvee_juste("algoria-055");
    let (sorties, _) = jouer("algoria-055");
    let o = sorties.iter().find(|o| o["issue"] == "prouvee").expect("prouvée");
    let base = &o["champs"]["base_tva_par_taux"]["instances"][0];
    assert_eq!((base["taux"].as_str(), base["valeur"].as_str()), (Some("EXO"), Some("2184765")));
}

#[test]
fn une_solution_qui_partage_un_jeton_n_est_pas_une_seconde_lecture() {
    prouvee_juste("algoria-036");
}

/// La valeur conforme d'un champ, dans une variante au moins.
fn conforme(id: &str, champ: &str) -> Vec<String> {
    jouer(id).0.iter().filter(|o| o["champs"][champ]["statut"] == "conforme").filter_map(|o| o["champs"][champ]["valeur"].as_str().map(str::to_string)).collect()
}

#[test]
fn un_deux_points_colle_a_la_date_dit_le_sens_du_libelle() {
    assert!(conforme("synthetique-087", "date_emission").iter().all(|d| d == "2026-09-11"));
    assert!(!conforme("synthetique-087", "date_emission").is_empty());
    assert!(!conforme("synthetique-087", "date_operation").is_empty());
}

#[test]
fn un_repere_court_colle_en_tete_de_la_valeur_l_ancre() {
    let (sorties, _) = jouer("dirigeant-50_16");
    assert!(sorties.iter().any(|o| o["champs"]["matricule_fiscal_emetteur"]["valeur"] == "0458213A/A/C/000"), "{sorties:?}");
}

/// Le cachet vu sans modèle se lit pour le seul champ qui l'attend ; sans marque, ou quand
/// deux champs l'attendent, il ne s'affirme pas.
#[test]
fn le_cachet_vu_sans_modele_se_lit_pour_le_seul_champ_qui_l_attend() {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json")).expect("jeu lisible");
    let entree = cas.iter().find(|c| c["id"] == "algoria-014").expect("cas")["entree"].clone();
    let lire = |e: &Value| -> Value { serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie") };
    let o = lire(&entree);
    assert_eq!(o["champs"]["cachet_emetteur"]["valeur"], "true", "{}", o["champs"]["cachet_emetteur"]);
    assert_eq!(o["champs"]["cachet_emetteur"]["statut"], "conforme");
    // sans marque relevée : rien n'est affirmé
    let mut sans = entree.clone();
    sans["marques"] = serde_json::json!([]);
    assert_ne!(lire(&sans)["champs"]["cachet_emetteur"]["statut"], "conforme");
    // deux champs qui attendent un cachet : il ne dit pas de qui il est
    let mut deux = entree.clone();
    for c in deux["grille"]["champs"].as_array_mut().expect("champs") {
        if c["code"] == "visa_client" {
            c["marque"] = serde_json::json!("cachet");
        }
    }
    assert_ne!(lire(&deux)["champs"]["cachet_emetteur"]["statut"], "conforme");
}
