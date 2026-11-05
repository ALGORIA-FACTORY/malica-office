//! Le sens d'une pièce déclaré par la personne (à la capture, ou corrigé après la lecture)
//! place le dossier : client d'un achat, émetteur d'une vente ; l'autre matricule est le
//! tiers. Le matricule du tiers n'est affirmé que corroboré. Banc sans IA du 5 novembre
//! 2026, sur des pièces fictives du jeu d'ALGORIA ; les entrées sont celles du banc
//! (`banc-sans-ia.ts --entrees --sens-declare`).

use serde_json::{json, Value};

fn entree(id: &str) -> Value {
    let tous: Vec<Value> = serde_json::from_str(include_str!("donnees/des_parties_declarees.json"))
        .expect("jeu lisible");
    tous.into_iter()
        .find(|c| c["id"] == id)
        .unwrap_or_else(|| panic!("{id} absent du jeu"))["entree"]
        .clone()
}

fn parties(e: &Value) -> Value {
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    o["parties"].clone()
}

#[test]
fn le_sens_declare_place_le_dossier_et_l_autre_matricule_est_le_tiers() {
    // algoria-001 : deux matricules lus, aucun indice de sens sur la pièce
    let mut e = entree("algoria-001");
    let p = parties(&e);
    assert_eq!(
        (
            p["sens"].as_str(),
            p["statut"].as_str(),
            p["declare"].as_bool()
        ),
        (Some("achat"), Some("prouve"), Some(true)),
        "{p}"
    );
    assert_eq!(p["client"]["matricule"]["valeur"], "1958330V/A/M/000");
    assert_eq!(p["emetteur"]["matricule"]["valeur"], "2815004Q/A/M/000");
    // la couche de texte d'un PDF corrobore le matricule du tiers
    assert_eq!(p["emetteur"]["matricule"]["statut"], "prouve");
    // sans déclaration, la pièce ne dit pas son sens : rien n'est rendu
    e["connus"].as_object_mut().expect("connus").remove("sens");
    assert_ne!(parties(&e)["statut"], "prouve");
    // la personne corrige : les rôles s'échangent, sans relire la pièce
    e["connus"]["sens"] = json!("vente");
    let p = parties(&e);
    assert_eq!(
        p["emetteur"]["matricule"]["valeur"], "1958330V/A/M/000",
        "{p}"
    );
    assert_eq!(p["client"]["matricule"]["valeur"], "2815004Q/A/M/000");
}

#[test]
fn une_declaration_que_la_piece_dement_se_signale() {
    // synthetique-055 : l'étiquette du client place le dossier ; la pièce dit « achat »
    let cas: Vec<Value> =
        serde_json::from_str(include_str!("donnees/des_silences_aux_preuves.json"))
            .expect("jeu lisible");
    let mut e = cas
        .iter()
        .find(|c| c["id"] == "synthetique-055")
        .expect("cas")["entree"]
        .clone();
    e["connus"]["sens"] = json!("achat");
    assert_eq!(parties(&e)["statut"], "prouve");
    e["connus"]["sens"] = json!("vente");
    let p = parties(&e);
    assert_eq!(
        (p["statut"].as_str(), p["raison"].as_str()),
        (Some("signale"), Some("le sens déclaré contredit la pièce")),
        "{p}"
    );
    assert!(p["emetteur"]["matricule"].is_null() && p["client"]["matricule"].is_null());
}

#[test]
fn un_matricule_du_tiers_lu_une_seule_fois_sans_assurance_est_a_verifier() {
    // dirigeant-50/02 : « 0567321M » lu « 0557321M », une seule fois, sans confiance
    let p = parties(&entree("dirigeant-50/02"));
    assert_eq!(
        p["emetteur"]["matricule"]["valeur"], "0557321M/A/M/000",
        "{p}"
    );
    assert_eq!(p["emetteur"]["matricule"]["statut"], "signale");
    assert_eq!(
        p["client"]["matricule"]["statut"], "prouve",
        "le dossier est corroboré par sa fiche"
    );
}

#[test]
fn deux_lectures_d_un_matricule_a_un_chiffre_pres_se_contredisent() {
    // dirigeant-50/31 : « 0765612B » lu en pied ; la même écriture, lue « 0745612B » en tête
    let mut e = entree("dirigeant-50/31");
    let jetons = e["jetons"].as_array_mut().expect("jetons");
    let mut double = jetons
        .iter()
        .find(|j| j["texte"] == "0765612B/A/M/000")
        .expect("le matricule lu")
        .clone();
    double["ordinal"] = json!(9000);
    double["y0"] = json!(0.02);
    double["y1"] = json!(0.03);
    double["texte"] = json!("0745612B/A/M/000");
    jetons.push(double);
    let p = parties(&e);
    assert_eq!(
        p["raison"], "deux lectures d'un matricule se contredisent",
        "{p}"
    );
    assert!(p["emetteur"]["matricule"].is_null());
}

#[test]
fn une_civilite_n_est_pas_le_nom_du_client() {
    // algoria-115 : « M. » annonce le client ; seul, il n'est pas son nom
    let p = parties(&entree("algoria-115"));
    assert_eq!(p["sens"], "vente");
    assert_ne!(p["client"]["nom"]["valeur"], "M.", "{p}");
}

#[test]
fn un_sens_declare_rend_ce_qui_est_lu_meme_sans_le_matricule_du_dossier() {
    // algoria-002 : l'OCR n'a pas lu le matricule du dossier ; le seul matricule lu est le
    // tiers, et le nom du dossier se trouve sur la page sans aucun matricule
    let mut e = entree("algoria-002");
    let p = parties(&e);
    assert_eq!(
        (p["statut"].as_str(), p["sens"].as_str()),
        (Some("prouve"), Some("achat")),
        "{p}"
    );
    assert_eq!(p["client"]["nom"]["valeur"], "ALGORIA FACTORY SARL");
    assert!(
        p["client"]["matricule"].is_null(),
        "le matricule non lu n'est pas recopié de la fiche"
    );
    assert_eq!(p["emetteur"]["matricule"]["valeur"], "2815004Q/A/M/000");
    // sans déclaration, rien : le sens ne se lit pas sans le matricule du dossier
    e["connus"].as_object_mut().expect("connus").remove("sens");
    assert_eq!(
        parties(&e)["raison"],
        "le matricule du dossier n'est pas lu"
    );
}

#[test]
fn un_nom_connu_lu_avec_un_accent_qu_il_n_a_pas_ne_se_rend_pas() {
    // algoria-065 : « ALGORIA FAÇTORY SARL » — la cédille est une lecture fausse
    let p = parties(&entree("algoria-065"));
    assert_eq!(p["statut"], "prouve", "{p}");
    assert!(p["client"]["nom"].is_null(), "{p}");
}
