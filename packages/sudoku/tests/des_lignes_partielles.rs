//! Des tableaux que l'OCR d'une photo ou d'un scan rend incomplets, et qui se prouvent
//! sans rien inventer : la lecture du milieu lit les prix TTC, une rangée dont une
//! cellule est perdue reste une ligne (« partielle ») que la somme exacte confirme, et la
//! cellule perdue se TAIT. Banc sans IA du 4 novembre 2026, sur des pièces fictives du jeu
//! d'ALGORIA ; les entrées sont celles du banc (`banc-sans-ia.ts --entrees`), la vérité
//! celle du jeu.

use serde_json::Value;

struct Cas {
    sortie: Value,
    lignes: Vec<Value>,
    entree: Value,
}

fn cas(id: &str) -> Cas {
    let tous: Vec<Value> = serde_json::from_str(include_str!("donnees/des_lignes_partielles.json")).expect("jeu lisible");
    let c = tous.into_iter().find(|c| c["id"] == id).unwrap_or_else(|| panic!("{id} absent du jeu"));
    Cas {
        sortie: resoudre(&c["entree"]),
        lignes: c["lignes"].as_array().expect("lignes").clone(),
        entree: c["entree"].clone(),
    }
}

fn resoudre(entree: &Value) -> Value {
    serde_json::from_str(&malica_sudoku::solve(&entree.to_string())).expect("sortie lisible")
}

/// « 547.000 » (ou « 380 ») en unités mineures, à trois décimales.
fn mineures(v: &str) -> String {
    let (e, d) = v.split_once('.').unwrap_or((v, ""));
    format!("{e}{d:0<3}").trim_start_matches('0').to_string()
}

fn texte(v: &str) -> String {
    v.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect()
}

/// Chaque cellule rendue est juste ; rend le nombre de quantités et de prix tus.
fn rien_de_faux(c: &Cas) -> (usize, usize) {
    assert_eq!(c.sortie["lignes"]["statut"], "prouve", "{}", c.sortie["lignes"]);
    let lues = c.sortie["lignes"]["instances"].as_array().expect("instances");
    assert_eq!(lues.len(), c.lignes.len());
    let (mut q_tues, mut p_tus) = (0, 0);
    for (l, v) in lues.iter().zip(&c.lignes) {
        for (cle, vraie) in [("quantite", "quantite"), ("prix", "prix"), ("montant", "montant"), ("remise", "remise")] {
            let Some(lu) = l[cle]["valeur"].as_str() else {
                q_tues += usize::from(cle == "quantite");
                p_tus += usize::from(cle == "prix");
                continue;
            };
            assert_ne!(l[cle]["statut"], "deduit", "rien n'est déduit : {l}");
            let vraie = v[vraie].as_str().unwrap_or_else(|| panic!("{cle} rendu, absent de la vérité : {l}"));
            assert_eq!(lu, mineures(vraie), "{cle} : {l}");
        }
        if let Some(d) = l["designation"]["valeur"].as_str() {
            assert_eq!(texte(d), texte(v["designation"].as_str().expect("désignation")), "{l}");
        }
    }
    (q_tues, p_tus)
}

#[test]
fn un_tableau_aux_prix_ttc_et_a_remise_se_prouve_et_tait_ce_que_l_ocr_a_perdu() {
    let c = cas("algoria-018");
    let (q_tues, p_tus) = rien_de_faux(&c);
    // trois « 1 » isolés que l'OCR n'a pas vus, et deux quantités d'un tableau à remise qui
    // ne se déduisent pas ; un prix lu « *143,000 »
    assert!(q_tues > 0 && q_tues <= 6, "{q_tues}");
    assert_eq!(p_tus, 1);
    let lues = c.sortie["lignes"]["instances"].as_array().expect("instances");
    assert!(lues.iter().any(|l| l["prix_ttc"] == true), "les prix se lisent TTC");
}

#[test]
fn un_numero_de_serie_sous_l_article_n_est_pas_sa_designation() {
    for id in ["algoria-018", "algoria-025"] {
        let c = cas(id);
        rien_de_faux(&c);
        let lues = c.sortie["lignes"]["instances"].as_array().expect("instances");
        assert!(lues.iter().filter_map(|l| l["designation"]["valeur"].as_str()).all(|d| !d.contains("SN")), "{id}");
        assert!(lues.iter().filter(|l| l["designation"]["valeur"].is_string()).count() > 10, "{id}");
    }
    // la règle vient de la grille : sans le champ du numéro de série, la ligne « SN : … »
    // redevient la suite de la désignation
    let c = cas("algoria-018");
    let mut entree = c.entree.clone();
    entree["grille"]["champs"].as_array_mut().expect("champs").retain(|ch| ch["code"] != "numero_serie_ligne");
    let sortie = resoudre(&entree);
    let lues = sortie["lignes"]["instances"].as_array().expect("instances");
    assert!(lues.iter().filter_map(|l| l["designation"]["valeur"].as_str()).any(|d| d.contains("SN")));
}

#[test]
fn une_remise_lue_sur_une_rangee_partielle_se_prouve_et_interdit_toute_deduction() {
    let c = cas("dirigeant-100/A-07");
    let (q_tues, _) = rien_de_faux(&c);
    let lues = c.sortie["lignes"]["instances"].as_array().expect("instances");
    // la remise de 10 % fermée par une quantité entière, et sa mention ôtée de la désignation
    assert_eq!(lues[0]["remise"]["valeur"], "10000", "{}", lues[0]);
    assert_eq!(lues[0]["designation"]["valeur"], "Vitrerie trimestrielle");
    // les quantités perdues par l'OCR se taisent toutes : un tableau à remise ne déduit pas
    assert_eq!(q_tues, 3);
}

#[test]
fn un_caractere_lu_sans_assurance_tait_la_designation() {
    let c = cas("algoria-018");
    let premiere = c.sortie["lignes"]["instances"][0]["designation"]["refs"][0].clone();
    assert!(premiere.is_object(), "la première ligne a sa désignation");
    let mut entree = c.entree.clone();
    for j in entree["jetons"].as_array_mut().expect("jetons") {
        if j["page"] == premiere["page"] && j["ordinal"] == premiere["ordinal"] {
            j["faible"] = serde_json::json!(0.5);
        }
    }
    let designation = |e: &Value| resoudre(e)["lignes"]["instances"][0]["designation"].clone();
    // sans seuil au caractère, rien ne change
    entree["pack"]["confiance_du_caractere"] = Value::Null;
    assert!(designation(&entree).is_object());
    entree["pack"]["confiance_du_caractere"] = serde_json::json!(0.8);
    assert!(designation(&entree).is_null());
}
