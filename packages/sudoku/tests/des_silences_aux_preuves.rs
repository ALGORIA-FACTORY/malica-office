//! Des pièces que le banc sans IA du 4 novembre 2026 laissait muettes, et qui se prouvent
//! désormais justes (`reperes::colonnes_de_libelles`, les charges annoncées par leur taux).
//! Les entrées sont celles du banc (`banc-sans-ia.ts --entrees`), une par variante de la
//! grille, sur des factures fictives du jeu d'ALGORIA ; la vérité est celle du jeu.

use serde_json::Value;

/// Les sorties de chaque variante, et la vérité de la pièce.
fn jouer(id: &str) -> (Vec<Value>, Value) {
    let cas: Vec<Value> =
        serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json"))
            .expect("jeu lisible");
    let cas: Vec<Value> = cas.into_iter().filter(|c| c["id"] == id).collect();
    assert!(!cas.is_empty(), "{id} absent du jeu");
    let sorties = cas
        .iter()
        .map(|c| {
            serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string()))
                .expect("sortie lisible")
        })
        .collect();
    (sorties, cas[0]["verite"].clone())
}

/// « 1203.360 » en millimes.
fn millimes(v: &Value) -> String {
    let (e, d) = v
        .as_str()
        .expect("vérité textuelle")
        .split_once('.')
        .expect("décimales");
    format!("{}{d:0<3}", e).trim_start_matches('0').to_string()
}

/// Une variante prouve la pièce, et chacun des champs de la vérité y est rendu juste.
fn prouvee_juste(id: &str) {
    let (sorties, verite) = jouer(id);
    let prouvees: Vec<&Value> = sorties.iter().filter(|o| o["issue"] == "prouvee").collect();
    assert_eq!(prouvees.len(), 1, "{id} : {sorties:?}");
    for (champ, v) in verite.as_object().expect("vérité") {
        assert_eq!(
            prouvees[0]["champs"][champ]["valeur"].as_str(),
            Some(millimes(v).as_str()),
            "{id} : {champ}"
        );
        assert_eq!(
            prouvees[0]["champs"][champ]["statut"], "prouve",
            "{id} : {champ}"
        );
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
    let o = sorties
        .iter()
        .find(|o| o["issue"] == "prouvee")
        .expect("prouvée");
    let base = &o["champs"]["base_tva_par_taux"]["instances"][0];
    assert_eq!(
        (base["taux"].as_str(), base["valeur"].as_str()),
        (Some("EXO"), Some("2184765"))
    );
}

#[test]
fn une_solution_qui_partage_un_jeton_n_est_pas_une_seconde_lecture() {
    prouvee_juste("algoria-036");
}

/// La valeur conforme d'un champ, dans une variante au moins.
fn conforme(id: &str, champ: &str) -> Vec<String> {
    jouer(id)
        .0
        .iter()
        .filter(|o| o["champs"][champ]["statut"] == "conforme")
        .filter_map(|o| o["champs"][champ]["valeur"].as_str().map(str::to_string))
        .collect()
}

#[test]
fn un_deux_points_colle_a_la_date_dit_le_sens_du_libelle() {
    assert!(conforme("synthetique-087", "date_emission")
        .iter()
        .all(|d| d == "2026-09-11"));
    assert!(!conforme("synthetique-087", "date_emission").is_empty());
    assert!(!conforme("synthetique-087", "date_operation").is_empty());
}

#[test]
fn un_repere_court_colle_en_tete_de_la_valeur_l_ancre() {
    let (sorties, _) = jouer("dirigeant-50_16");
    assert!(
        sorties
            .iter()
            .any(|o| o["champs"]["matricule_fiscal_emetteur"]["valeur"] == "0458213A/A/C/000"),
        "{sorties:?}"
    );
}

/// Le cachet vu sans modèle se lit pour le seul champ qui l'attend ; sans marque, ou quand
/// deux champs l'attendent, il ne s'affirme pas.
#[test]
fn le_cachet_vu_sans_modele_se_lit_pour_le_seul_champ_qui_l_attend() {
    let cas: Vec<Value> =
        serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json"))
            .expect("jeu lisible");
    let entree = cas.iter().find(|c| c["id"] == "algoria-014").expect("cas")["entree"].clone();
    let lire = |e: &Value| -> Value {
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie")
    };
    let o = lire(&entree);
    assert_eq!(
        o["champs"]["cachet_emetteur"]["valeur"], "true",
        "{}",
        o["champs"]["cachet_emetteur"]
    );
    assert_eq!(o["champs"]["cachet_emetteur"]["statut"], "conforme");
    // sans marque relevée : rien n'est affirmé
    let mut sans = entree.clone();
    sans["marques"] = serde_json::json!([]);
    assert_ne!(
        lire(&sans)["champs"]["cachet_emetteur"]["statut"],
        "conforme"
    );
    // deux champs qui attendent un cachet : il ne dit pas de qui il est
    let mut deux = entree.clone();
    for c in deux["grille"]["champs"].as_array_mut().expect("champs") {
        if c["code"] == "visa_client" {
            c["marque"] = serde_json::json!("cachet");
        }
    }
    assert_ne!(
        lire(&deux)["champs"]["cachet_emetteur"]["statut"],
        "conforme"
    );
}

/// Le bloc qui porte une étiquette du client (« الحريف », le client), quand l'autre n'en
/// porte aucune, est le client : la pièce est un achat. Sans cette étiquette, le sens se
/// tait — il n'est jamais deviné.
#[test]
fn l_etiquette_du_client_dit_le_sens_de_la_piece() {
    let cas: Vec<Value> =
        serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json"))
            .expect("jeu lisible");
    let entree = cas
        .iter()
        .find(|c| c["id"] == "synthetique-055")
        .expect("cas")["entree"]
        .clone();
    let lire = |e: &Value| -> Value {
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie")
    };
    let o = lire(&entree);
    assert_eq!(o["parties"]["sens"], "achat", "{}", o["parties"]);
    assert_eq!(
        o["parties"]["emetteur"]["matricule"]["valeur"],
        "1381012E/A/M/000"
    );
    assert_eq!(
        o["parties"]["client"]["matricule"]["valeur"],
        "6443013U/A/M/000"
    );
    let mut sans = entree.clone();
    for j in sans["jetons"].as_array_mut().expect("jetons") {
        let t = j["texte"].as_str().unwrap_or_default().to_string();
        if t.contains("حريف") {
            j["texte"] = Value::from(
                t.replace("الحريف", "")
                    .replace("للحريف", "")
                    .replace("حريف", ""),
            );
        }
    }
    assert_ne!(
        lire(&sans)["parties"]["statut"],
        "prouve",
        "{}",
        lire(&sans)["parties"]
    );
}

#[test]
fn une_piece_sans_devise_imprimee_est_dans_la_devise_du_dossier() {
    // algoria-051 : ni « DT », ni « TND », ni « dinars ». Décision du dirigeant (5 novembre
    // 2026) : la devise du dossier, DÉDUITE, sans référence de jeton.
    let (sorties, _) = jouer("algoria-051");
    let devise = &sorties[0]["champs"]["devise"];
    assert_eq!(
        (devise["valeur"].as_str(), devise["statut"].as_str()),
        (Some("TND"), Some("deduit")),
        "{devise}"
    );
    assert!(devise["refs"].as_array().is_some_and(|r| r.is_empty()));
    // la donnée vient du dossier : sans elle, le champ se tait
    let cas: Vec<Value> =
        serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json"))
            .expect("jeu lisible");
    let mut e = cas
        .into_iter()
        .find(|c| c["id"] == "algoria-051")
        .expect("cas")["entree"]
        .clone();
    e["connus"]
        .as_object_mut()
        .expect("connus")
        .remove("devise");
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    assert_eq!(o["champs"]["devise"]["statut"], "absent");
    // une devise imprimée l'emporte toujours
    e["connus"]["devise"] = serde_json::json!("TND");
    let j = e["jetons"].as_array_mut().expect("jetons");
    let mut usd = j[0].clone();
    usd["ordinal"] = serde_json::json!(9001);
    usd["texte"] = serde_json::json!("USD");
    usd["y0"] = serde_json::json!(0.97);
    usd["y1"] = serde_json::json!(0.98);
    j.push(usd);
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    assert_ne!(
        o["champs"]["devise"]["statut"], "deduit",
        "{}",
        o["champs"]["devise"]
    );
}

#[test]
fn un_taux_nul_imprime_sans_mention_prouve_la_piece_et_tait_le_code() {
    // synthetique-002 : « TVA 0 % — Base 1.988,009 0,000 », 7 % et 19 %, aucune mention ;
    // synthetique-011 : deux lignes à « 0 % », « Total TVA 0,000 ». Décision du dirigeant
    // (5 novembre 2026) : sans mention, le code du taux nul (EXO ou EXPORT) n'est pas
    // affirmé ; la pièce, elle, se prouve.
    let (s, _) = jouer("synthetique-002");
    let o = &s[0];
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["champs"]["total_ht"]["valeur"], "4832708");
    assert_eq!(o["champs"]["total_ttc"]["valeur"], "5230538");
    assert_eq!(o["champs"]["base_tva_par_taux"]["statut"], "signale");
    let (s, _) = jouer("synthetique-011");
    let o = &s[0];
    assert_eq!(o["issue"], "prouvee", "{o}");
    assert_eq!(o["champs"]["total_ht"]["valeur"], "3008708");
    assert_eq!(o["champs"]["total_ttc"]["valeur"], "3009708");
    assert_ne!(o["champs"]["base_tva_par_taux"]["statut"], "prouve");
}
