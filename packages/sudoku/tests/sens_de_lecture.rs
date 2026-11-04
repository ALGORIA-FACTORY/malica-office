//! Le sens de lecture : un libellé désigne sa valeur du côté où il se LIT, quelle que soit
//! l'écriture de la page — et le nom du dossier ne sort jamais pour l'autre partie.
//!
//! Banc sans IA du 4 novembre 2026 (412 pièces fictives) : sur les pièces arabes, le
//! moteur ouvrait le bloc « الحريف » (client) vers la droite, sur la colonne du
//! fournisseur, et sortait « vente » pour six achats ; sur les pièces bilingues
//! (« Client : الحريف : … »), écrites de gauche à droite, un libellé arabe désigne au
//! contraire vers la droite. Le côté se décide par vote (deux-points propre, séparateur
//! vers une valeur, valeur la plus proche, puis l'écriture) : `entete::vers_la_gauche`.
//!
//! Les entrées sont celles du banc (`banc-sans-ia.ts --entrees`), sur des pièces du jeu
//! d'ALGORIA et du jeu synthétique : tout y est inventé, sauf la raison sociale et le
//! matricule d'ALGORIA FACTORY SARL (à la demande du dirigeant).

use serde_json::Value;

fn cas() -> Vec<Value> {
    serde_json::from_str(include_str!("donnees/sens_de_lecture.json")).expect("jeu lisible")
}

fn sortie(c: &Value) -> Value {
    serde_json::from_str(&malica_sudoku::solve(&c["entree"].to_string())).expect("sortie lisible")
}

fn cas_nomme(id: &str) -> Value {
    cas().into_iter().find(|c| c["id"] == id).expect("cas présent")
}

fn parties(id: &str) -> (Value, Value) {
    let c = cas_nomme(id);
    let s = sortie(&c);
    (s["parties"].clone(), c["attendu"].clone())
}

#[test]
fn une_piece_arabe_se_lit_de_droite_a_gauche() {
    let (p, a) = parties("algoria-051");
    assert_eq!(p["sens"], a["sens"], "{}", p);
    assert_eq!(p["emetteur"]["matricule"]["valeur"], a["emetteur"]);
    assert_eq!(p["client"]["matricule"]["valeur"], a["client"]);
}

#[test]
fn une_piece_bilingue_garde_le_sens_de_ses_lignes() {
    let (p, a) = parties("synthetique-086");
    assert_eq!(p["sens"], a["sens"], "{}", p);
    assert_eq!(p["emetteur"]["matricule"]["valeur"], a["emetteur"]);
    assert_eq!(p["client"]["matricule"]["valeur"], a["client"]);
}

#[test]
fn le_nom_du_dossier_n_est_jamais_celui_de_l_autre_partie() {
    for id in ["algoria-051", "algoria-036"] {
        let (p, _) = parties(id);
        let nom = p["emetteur"]["nom"]["valeur"].as_str().unwrap_or_default().to_uppercase();
        assert!(!nom.contains("ALGORIA"), "{id} : le fournisseur porte le nom du dossier : {p}");
    }
}

#[test]
fn un_deux_points_seul_dit_le_cote_du_libelle() {
    let c = cas_nomme("algoria-076");
    let s = sortie(&c);
    let rc = &s["champs"]["registre_commerce_emetteur"]["valeur"];
    assert!(rc.is_null() || *rc == c["attendu"]["rc"], "RC lu de travers : {rc}");
}

#[test]
fn la_grappe_legale_dit_l_emetteur_sans_libelle_de_partie() {
    let (p, a) = parties("dirigeant-50_08");
    assert_eq!(p["sens"], a["sens"], "{}", p);
    assert_eq!(p["emetteur"]["matricule"]["valeur"], a["emetteur"]);
}

#[test]
fn un_proclitique_arabe_ne_cache_pas_la_partie() {
    let (p, a) = parties("synthetique-050");
    assert_eq!(p["sens"], a["sens"], "{}", p);
    assert_eq!(p["client"]["matricule"]["valeur"], a["client"]);
}
