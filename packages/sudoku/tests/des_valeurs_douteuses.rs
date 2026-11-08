//! Une valeur que l'OCR a pu mal lire est signalée, jamais affirmée. Les entrées sont
//! celles du banc (`banc-sans-ia.ts --entrees`) sur l'OCR frais du staging du 8 novembre
//! 2026, pièces fictives du jeu du dirigeant.

use serde_json::Value;

fn sortie(id: &str) -> Value {
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/des_valeurs_douteuses.json"))
        .expect("jeu lisible");
    let c = cas.iter().find(|c| c["id"] == id).expect("cas présent");
    serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible")
}

/// « 01122338/A/M/014 » : le motif du matricule se trouve au milieu du jeton
/// (« 1122338/A/M/014 », bordé du 0 de tête). Ce n'est pas ce que la page imprime : le
/// champ se signale, sans valeur affirmée.
#[test]
fn un_matricule_trouve_au_milieu_d_un_jeton_n_est_pas_affirme() {
    let o = sortie("dirigeant-50/05");
    let c = &o["champs"]["matricule_fiscal_emetteur"];
    assert_ne!(c["valeur"], "1122338/A/M/014", "{c}");
    assert!(
        !matches!(c["statut"].as_str(), Some("prouve" | "conforme")),
        "{c}"
    );
}

fn designations(o: &Value) -> Vec<(Option<String>, Option<String>)> {
    o["lignes"]["instances"]
        .as_array()
        .map(|v| {
            v.iter()
                .map(|l| {
                    (
                        l["designation"]["valeur"].as_str().map(str::to_string),
                        l["designation"]["statut"].as_str().map(str::to_string),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Une désignation dont la tête est restée sur la ligne au-dessus, que personne ne cite
/// (« Abonnement RegTrack — palier » / « Compliance, 12 mois ») : elle n'est pas prouvée
/// entière, elle se montre « incertain ».
#[test]
fn une_designation_collee_a_un_texte_orphelin_est_incertaine() {
    let o = sortie("algoria-113");
    for coupee in ["Compliance, 12 mois", "jour", "mensuel"] {
        let d = designations(&o);
        let (_, statut) = d
            .iter()
            .find(|(v, _)| v.as_deref() == Some(coupee))
            .unwrap_or_else(|| panic!("{coupee} absente : {d:?}"));
        assert_eq!(statut.as_deref(), Some("incertain"), "{coupee}");
    }
    // la désignation entière et isolée reste lue
    assert!(designations(&o).iter().any(|(v, s)| {
        v.as_deref() == Some("Clé de sécurité matérielle FIDO2, boite") && s.is_none()
    }));
}

/// Des mots laissés hors de la désignation sur sa propre ligne (« de réunion, demi- ») :
/// la ligne continue à côté, la désignation est incertaine.
#[test]
fn une_designation_dont_la_ligne_continue_est_incertaine() {
    let o = sortie("algoria-069");
    let d = designations(&o);
    for coupee in ["Location de salle journée", "bureaux"] {
        let (_, statut) = d
            .iter()
            .find(|(v, _)| v.as_deref() == Some(coupee))
            .unwrap_or_else(|| panic!("{coupee} absente : {d:?}"));
        assert_eq!(statut.as_deref(), Some("incertain"), "{coupee}");
    }
}

/// Le nom du dossier collé à son libellé par l'OCR (« Client :/JI:ALGORIA FACTORY SARL »)
/// n'est pas le nom du fournisseur, et l'adresse imprimée dessous n'est pas la sienne.
#[test]
fn le_nom_du_dossier_colle_a_son_libelle_n_est_pas_le_fournisseur() {
    let o = sortie("algoria-066");
    let nom = &o["parties"]["emetteur"]["nom"];
    assert!(
        !nom["valeur"].as_str().unwrap_or("").contains("ALGORIA"),
        "{nom}"
    );
    let a = &o["champs"]["adresse_emetteur"];
    assert_ne!(
        a["valeur"], "14, rue des Cyprès, 1053 Les Berges du Lac, Tunis",
        "{a}"
    );
}

/// Un nom arabe lu à gauche de son libellé se rend dans son ordre de lecture, de droite à
/// gauche.
#[test]
fn un_nom_arabe_se_lit_de_droite_a_gauche() {
    let o = sortie("algoria-107");
    assert_eq!(o["champs"]["nom_client"]["valeur"], "مكتب غرفان للتدقيق");
}

/// « n°354642/6 » sous le libellé « Quittance » : la valeur porte un libellé collé, elle
/// n'est pas affirmée.
#[test]
fn une_valeur_qui_porte_un_libelle_colle_n_est_pas_affirmee() {
    let o = sortie("algoria-148");
    let c = &o["champs"]["reference_quittance"];
    assert!(
        !matches!(c["statut"].as_str(), Some("prouve" | "conforme")),
        "{c}"
    );
}

/// Un lecteur génératif répète la même erreur de chiffre dans le HT, la TVA et le TTC : les
/// sommes ferment sur des valeurs fausses (« 12 492,611 » pour « 12 492,811 »). Sans le
/// montant en lettres qui vérifie le total, rien n'est affirmé ; la même entrée lue par un
/// OCR se prouve.
#[test]
fn les_sommes_d_un_lecteur_generatif_ne_se_prouvent_pas_seules() {
    let o = sortie("algoria-073-qwen");
    assert_ne!(o["issue"], "prouvee", "{}", o["raison"]);
    for (code, c) in o["champs"].as_object().expect("champs") {
        assert!(
            !matches!(c["statut"].as_str(), Some("prouve" | "conforme")),
            "{code} : {c}"
        );
    }
    let cas: Vec<Value> = serde_json::from_str(include_str!("donnees/des_valeurs_douteuses.json"))
        .expect("jeu lisible");
    let mut e = cas
        .into_iter()
        .find(|c| c["id"] == "algoria-073-qwen")
        .expect("cas présent")["entree"]
        .clone();
    e["lecteur_generatif"] = Value::Bool(false);
    let ocr: Value =
        serde_json::from_str(&malica_sudoku::solve(&e.to_string())).expect("sortie lisible");
    assert_eq!(ocr["issue"], "prouvee");
}
