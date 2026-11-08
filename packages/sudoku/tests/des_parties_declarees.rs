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

#[test]
fn un_matricule_imprime_sans_sa_lettre_se_compare_par_la_lettre_calculee() {
    // dirigeant-100/A-01 : « 1856324/A/M/000 » et « 1247856/A/M/000 », imprimés sans la
    // lettre de contrôle ; la fiche du dossier non plus. La valeur rendue est l'imprimée.
    let mut e = entree("dirigeant-100/A-01");
    let p = parties(&e);
    assert_eq!(p["statut"], "prouve", "{p}");
    assert_eq!(p["client"]["matricule"]["valeur"], "1856324/A/M/000");
    assert_eq!(p["emetteur"]["matricule"]["valeur"], "1247856/A/M/000");
    // la fiche porte la lettre que la règle calcule (1·7+8·6+5·5+6·4+3·3+2·2+4·1 = 121,
    // 121 mod 23 = 6, « G ») : l'écriture sans lettre est le dossier, rendue telle quelle
    e["connus"]["dossier"]["matricule"] = json!("1856324G/A/M/000");
    let p = parties(&e);
    assert_eq!(p["client"]["matricule"]["valeur"], "1856324/A/M/000", "{p}");
    // une autre lettre sur les mêmes chiffres : les lectures se contredisent, rien n'est placé
    e["connus"]["dossier"]["matricule"] = json!("1856324K/A/M/000");
    let p = parties(&e);
    assert_eq!(
        p["raison"], "deux lectures d'un matricule se contredisent",
        "{p}"
    );
    // sans la règle au pack, l'écriture sans lettre n'égale que son identique
    e["pack"]["controles"] = json!({});
    assert!(parties(&e)["client"]["matricule"].is_null());
}

#[test]
fn le_matricule_du_dossier_n_est_pas_celui_d_une_partie_que_rien_ne_designe() {
    // dirigeant-100/C-01 : un devis reçu ; « MF:1856324/A/M/000 » sous « Client : » ; celui
    // du fournisseur imprimé « 1105673/K/M/000 », hors du motif. La grille du devis n'a que
    // le matricule du fournisseur : le dossier ne s'y range pas.
    let e = entree("dirigeant-100/C-01");
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    let m = &o["champs"]["matricule_fiscal_emetteur"];
    assert_eq!(
        (m["valeur"].is_null(), m["statut"].as_str()),
        (true, Some("signale")),
        "{m}"
    );
}

#[test]
fn le_seul_autre_nom_a_forme_juridique_est_celui_du_tiers() {
    // synthetique-020 : « Kessira Bureautique SARL » en tête, « Client : Laboratoire Qirwane
    // d'Essai SA » (le dossier). Le nom trouvé près du matricule du tiers était celui du
    // dossier, écarté ; le seul autre nom à forme juridique de la page est le tiers.
    let mut e = entree("synthetique-020");
    let p = parties(&e);
    assert_eq!(
        p["emetteur"]["nom"]["valeur"], "Kessira Bureautique SARL",
        "{p}"
    );
    // une troisième société à forme juridique sur la page : rien
    let j = e["jetons"].as_array_mut().expect("jetons");
    for (k, t) in ["Transports", "Belkadra", "SA"].iter().enumerate() {
        let mut x = j[0].clone();
        x["ordinal"] = json!(9100 + k);
        x["texte"] = json!(t);
        x["x0"] = json!(0.1 + 0.06 * k as f64);
        x["x1"] = json!(0.158 + 0.06 * k as f64);
        x["y0"] = json!(0.95);
        x["y1"] = json!(0.96);
        j.push(x);
    }
    // La règle du seul autre nom se tait : deux autres noms. Mais l'en-tête de l'émetteur
    // (nom, adresse, puis lignes à libellé jusqu'à son matricule) prouve le nom par sa
    // structure (`tete_de_bloc`, 7 novembre 2026), et une société imprimée en pied de page
    // n'y entre pas.
    let p = parties(&e);
    assert_eq!(
        p["emetteur"]["nom"]["valeur"], "Kessira Bureautique SARL",
        "{p}"
    );
    // Sans adresse sous le nom, l'en-tête ne prouve plus rien : la page reste ambiguë.
    let j = e["jetons"].as_array_mut().expect("jetons");
    let y_nom = j
        .iter()
        .find(|t| t["texte"] == "Kessira")
        .and_then(|t| t["y1"].as_f64())
        .expect("le nom");
    j.retain(|t| {
        let y = t["y0"].as_f64().unwrap_or(0.0);
        let x = t["x0"].as_f64().unwrap_or(1.0);
        !(y > y_nom && y < y_nom + 0.03 && x < 0.45)
    });
    let p = parties(&e);
    assert!(p["emetteur"]["nom"].is_null(), "{p}");
}

#[test]
fn un_numero_colle_a_son_libelle_qui_a_la_forme_d_une_reference_est_conforme() {
    // dirigeant-100/A-01 : « N°293/2026 », un seul jeton
    let e = entree("dirigeant-100/A-01");
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    let n = &o["champs"]["numero_facture"];
    assert_eq!(
        (n["valeur"].as_str(), n["statut"].as_str()),
        (Some("293/2026"), Some("conforme")),
        "{n}"
    );
    // ce que l'OCR y colle de plus la garde signalée
    let mut e = e.clone();
    for j in e["jetons"].as_array_mut().expect("jetons") {
        if j["texte"] == "N°293/2026" {
            j["texte"] = json!("N°293/2026juin");
        }
    }
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    assert_eq!(o["champs"]["numero_facture"]["statut"], "signale");
}

/// L'entrée, sa preuve des parties complétée des clés de 20261201092100 et 20261201092200, et la
/// règle de la lettre du pack (20261201091700).
fn avec_groupes_et_adresses(id: &str) -> Value {
    let mut e = entree(id);
    e["pack"]["controles"] = json!({"matricule_fiscal": {
        "poids": [7, 6, 5, 4, 3, 2, 1], "modulo": 23, "alphabet": "ABCDEFGHJKLMNPQRSTVWXYZ"}});
    for p in e["grille"]["preuves"].as_array_mut().expect("preuves") {
        if p["expression"]["op"] == "parties" {
            p["expression"]["groupes_emetteur"] = json!("code_tva_categorie_etablissement");
            p["expression"]["adresse_emetteur"] = json!("adresse_emetteur");
            p["expression"]["adresse_client"] = json!("adresse_client");
        }
    }
    e
}

#[test]
fn le_code_tva_de_l_emetteur_se_lit_dans_son_matricule() {
    // algoria-001 : « 2815004Q/A/M/000 », le fournisseur
    let o: Value = serde_json::from_str(&malica_sudoku::solve(
        &avec_groupes_et_adresses("algoria-001").to_string(),
    ))
    .expect("sortie lisible");
    let c = &o["champs"]["code_tva_categorie_etablissement"];
    assert_eq!(
        (c["valeur"].as_str(), c["statut"].as_str()),
        (Some("A/M/000"), Some("prouve")),
        "{c}"
    );
}

#[test]
fn l_adresse_d_une_partie_est_la_ligne_sous_son_nom() {
    // algoria-001 : sous « Sirvane Store SARL », « Zone commerciale Ezzahra, bloc C, 2034
    // Ezzahra », puis « Tél: … » ; sous « ALGORIA FACTORY SARL », « 14, rue des Cyprès… »
    let o: Value = serde_json::from_str(&malica_sudoku::solve(
        &avec_groupes_et_adresses("algoria-001").to_string(),
    ))
    .expect("sortie lisible");
    assert_eq!(
        o["champs"]["adresse_emetteur"]["valeur"], "Zone commerciale Ezzahra, bloc C, 2034 Ezzahra",
        "{}",
        o["champs"]["adresse_emetteur"]
    );
    assert_eq!(
        o["champs"]["adresse_client"]["valeur"],
        "14, rue des Cyprès, 1053 Les Berges du Lac, Tunis"
    );
    // sans les clés, rien
    let o: Value = serde_json::from_str(&malica_sudoku::solve(&entree("algoria-001").to_string()))
        .expect("sortie lisible");
    assert!(o["champs"]["adresse_emetteur"]["valeur"].is_null());
}

#[test]
fn le_contact_de_l_emetteur_s_arrete_au_bloc_du_client() {
    // algoria-001, sens déclaré : sous « MF: 2815004Q/A/M/000 » (émetteur, x ≈ 0,805), on
    // empile à la même marge le téléphone de l'émetteur, puis le bloc du client avec le sien.
    // Revue Codex de #268 : le téléphone du client était pris pour celui de l'émetteur.
    let mut e = entree("algoria-001");
    e["connus"]["sens"] = json!("achat");
    for p in e["grille"]["preuves"].as_array_mut().expect("preuves") {
        if p["expression"]["op"] == "parties" {
            p["expression"]["contact_emetteur"] = json!("telephone_email_emetteur");
        }
    }
    let jetons = e["jetons"].as_array_mut().expect("jetons");
    let mf = jetons
        .iter()
        .find(|t| t["texte"] == "MF:")
        .expect("le libellé du matricule de l'émetteur")
        .clone();
    let (x, y) = (mf["x0"].as_f64().unwrap(), mf["y0"].as_f64().unwrap());
    let mut ordinal = jetons.len() as i64;
    let mut poser = |dy: f64, mots: &[&str]| {
        let mut x0 = x;
        for m in mots {
            let x1 = x0 + 0.012 * m.chars().count() as f64;
            jetons.push(json!({
                "page": 1, "ordinal": ordinal, "texte": m,
                "x0": x0, "y0": y + dy, "x1": x1, "y1": y + dy + 0.009,
                "montants": [], "date": null
            }));
            ordinal += 1;
            x0 = x1 + 0.004;
        }
    };
    poser(0.015, &["Tél", ":", "72", "111", "111"]);
    poser(0.03, &["Client", ":"]);
    poser(0.045, &["Tél", ":", "71", "000", "000"]);
    let o: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    let contact = o["champs"]["telephone_email_emetteur"]["valeur"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    assert!(
        contact.contains("72 111 111"),
        "{contact} / {}",
        o["parties"]
    );
    assert!(!contact.contains("71 000 000"), "{contact}");
}
