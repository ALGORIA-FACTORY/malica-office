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
