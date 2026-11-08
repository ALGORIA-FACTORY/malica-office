//! L'anneau 2 — l'en-tête prouvé par ses relations avec la base du client — sur les
//! deux jeux de factures FICTIVES du dirigeant. La grille et le pack sont ceux que la
//! base livre ; les preuves `lignes` (L01), `parties` (E01) et `ordre` (E02) y sont
//! ajoutées ICI, en attendant la migration.
//!
//! Le dossier est ALGORIA FACTORY (le client de chaque jeu, tiré de la vérité) ; ses
//! tiers sont la moitié des fournisseurs (par ordre de matricule, un sur deux), pour
//! éprouver le tiers connu et le tiers inconnu.
//!
//! Exigences : 0 sens faux prouvé, 0 matricule faux prouvé, 0 tiers faux prouvé, un nom
//! prouvé est celui de la partie connue ; le centre et les lignes sont inchangés ; un
//! dossier dont le matricule n'est pas sur la pièce ne prouve plus aucun sens.

mod commun;

use commun::jeux::{self, jeton, jeu, la_piece, par_variante_avec};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

const PREUVE_LIGNES: &str = "L01";
const PREUVE_PARTIES: &str = "E01";
const PREUVE_ORDRE: &str = "E02";

/// Les formes juridiques que la comparaison des noms ignore : des mots du catalogue,
/// fournis en entrée (ici, par le test).
const FORMES: [&str; 6] = ["SARL", "SUARL", "SA", "SAS", "SNC", "EURL"];

/// Les champs d'en-tête que l'anneau 2 établit (et les preuves qui les lisent).
const CHAMPS_ENTETE: [&str; 7] = [
    "matricule_fiscal_emetteur",
    "matricule_fiscal_client",
    "raison_sociale_emetteur",
    "nom_client",
    "date_emission",
    "date_echeance",
    "numero_facture",
];
const PREUVES_ENTETE: [&str; 4] = [PREUVE_PARTIES, PREUVE_ORDRE, "P05", "P05b"];

#[derive(Deserialize, Clone, Default)]
struct Entete {
    mf_fournisseur: Option<String>,
    mf_client: Option<String>,
    fournisseur: Option<String>,
    client: Option<String>,
    numero: Option<String>,
    date: Option<String>,
    echeance: Option<String>,
}

#[derive(Deserialize, Clone)]
struct Verite {
    #[serde(default)]
    entete: Entete,
}

type Piece = jeux::Piece<Verite>;

fn preuves_entete() -> [Value; 2] {
    [
        json!({"code": PREUVE_PARTIES, "regle": "émetteur, client et sens par les matricules du dossier et de ses tiers",
               "genre": "relation", "statut": "defaut_a_valider", "variante": null,
               "expression": {"op": "parties", "emetteur": "matricule_fiscal_emetteur", "client": "matricule_fiscal_client",
                              "nom_emetteur": "raison_sociale_emetteur", "nom_client": "nom_client", "numero": "numero_facture"}}),
        json!({"code": PREUVE_ORDRE, "regle": "émission avant échéance", "genre": "format", "statut": "defaut_a_valider",
               "variante": null, "expression": {"op": "ordre", "avant": "date_emission", "apres": "date_echeance"}}),
    ]
}

/// Les repères qu'un expert pourrait ajouter à la grille (ESSAI, pas en base) : ceux
/// que les jeux impriment et que la grille ne porte pas.
const REPERES_ESSAI: [(&str, &[&str]); 2] = [
    ("date_emission", &["Date"]),
    (
        "nom_client",
        &[
            "Adressé à",
            "Adressée à",
            "Acheteur",
            "Acquéreur",
            "Bill to",
            "Titulaire",
        ],
    ),
];

/// La grille en base, avec L01 ; `entete` ajoute E01 et E02 ; `essai` ajoute les repères
/// d'essai.
fn grille(entete: bool, essai: bool) -> Value {
    let (mut g, _) = jeux::en_base();
    let preuves = g["preuves"].as_array_mut().unwrap();
    preuves.push(jeux::preuve_lignes(PREUVE_LIGNES));
    if entete {
        preuves.extend(preuves_entete());
    }
    if essai {
        for c in g["champs"].as_array_mut().unwrap() {
            for (code, reperes) in REPERES_ESSAI {
                if c["code"] == code {
                    c["reperes_fr"]
                        .as_array_mut()
                        .unwrap()
                        .extend(reperes.iter().map(|r| json!(r)));
                }
            }
        }
    }
    g
}

/// Le pack en base ; `format_large` remplace le motif du matricule par un motif d'essai
/// dont la lettre de clé est facultative (les matricules du jeu 100 n'en ont pas).
fn pack(format_large: bool) -> Value {
    let (_, mut p) = jeux::en_base();
    if format_large {
        p["formats"]["matricule_fiscal"] = json!("[0-9]{7}[A-Za-z]?/[A-Za-z]/[A-Za-z]/[0-9]{3}");
    }
    p
}

fn norme_mf(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

/// Un nom comparable : sans casse, sans accents, sans ponctuation, sans forme juridique.
fn norme_nom(s: &str) -> String {
    let formes: BTreeSet<String> = FORMES.iter().map(|f| f.to_lowercase()).collect();
    s.split_whitespace()
        .map(|m| {
            m.to_lowercase()
                .chars()
                .map(|c| match c {
                    'é' | 'è' | 'ê' | 'ë' => 'e',
                    'à' | 'â' | 'ä' => 'a',
                    'î' | 'ï' => 'i',
                    'ô' | 'ö' => 'o',
                    'û' | 'ù' | 'ü' => 'u',
                    'ç' => 'c',
                    c => c,
                })
                .filter(|c| c.is_alphanumeric())
                .collect::<String>()
        })
        .filter(|m| !m.is_empty() && !formes.contains(m))
        .collect::<Vec<_>>()
        .join(" ")
}

fn norme_numero(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(|c| c.to_uppercase())
        .collect()
}

/// La date de la vérité en ISO (elle est parfois écrite jj/mm/aaaa).
fn iso(s: &str) -> String {
    let p: Vec<&str> = s.split('/').collect();
    if p.len() == 3 {
        format!("{}-{}-{}", p[2], p[1], p[0])
    } else {
        s.to_string()
    }
}

/// Le dossier et ses tiers, par jeu, fabriqués depuis la vérité.
fn connus(pieces: &[Piece]) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    let jeux_: BTreeSet<&str> = pieces.iter().map(|p| jeu(&p.id)).collect();
    for j in jeux_ {
        let du_jeu: Vec<&Entete> = pieces
            .iter()
            .filter(|p| jeu(&p.id) == j)
            .map(|p| &p.verite.entete)
            .collect();
        // le dossier : le client le plus fréquent du jeu
        let mut compte: BTreeMap<(String, String), u32> = BTreeMap::new();
        for e in &du_jeu {
            if let (Some(m), Some(c)) = (&e.mf_client, &e.client) {
                *compte.entry((norme_mf(m), c.clone())).or_default() += 1;
            }
        }
        let ((mf_dossier, rs_dossier), _) = compte.into_iter().max_by_key(|(_, n)| *n).unwrap();
        // les fournisseurs, par ordre de matricule, un sur deux
        let mut fournisseurs: BTreeMap<String, String> = BTreeMap::new();
        for e in &du_jeu {
            if let (Some(m), Some(f)) = (&e.mf_fournisseur, &e.fournisseur) {
                let m = norme_mf(m);
                if m != mf_dossier {
                    fournisseurs.entry(m).or_insert_with(|| f.clone());
                }
            }
        }
        let tiers: Vec<Value> = fournisseurs
            .iter()
            .enumerate()
            .filter(|(k, _)| k % 2 == 0)
            .map(|(k, (m, f))| json!({"code": format!("401{:03}", k + 1), "matricule": m, "raison_sociale": f}))
            .collect();
        out.insert(
            j.to_string(),
            json!({"dossier": {"matricule": mf_dossier, "raison_sociale": rs_dossier}, "tiers": tiers, "formes_juridiques": FORMES}),
        );
    }
    out
}

/// La sortie de la pièce : l'anneau 2 ne dépend pas de la variante ; il doit être le même dans toutes.
fn jouer(p: &Piece, grille: &Value, pack: &Value, connus: Option<&Value>) -> Value {
    let jetons: Vec<Value> = p.jetons.iter().map(jeton).collect();
    let (jouees, _) = par_variante_avec(&jetons, grille, pack, connus);
    for (v, o) in &jouees[1..] {
        assert_eq!(
            o["parties"], jouees[0].1["parties"],
            "{} : parties différentes selon la variante {v}",
            p.id
        );
        for c in CHAMPS_ENTETE {
            assert_eq!(
                o["champs"][c], jouees[0].1["champs"][c],
                "{} : {c} différent selon la variante {v}",
                p.id
            );
        }
    }
    la_piece(&jouees)
}

/// La pièce sans ce que l'anneau 2 établit : ce qui reste doit être identique.
fn sans_entete(o: &Value) -> Value {
    let mut o = o.clone();
    o.as_object_mut().unwrap().remove("parties");
    for c in CHAMPS_ENTETE {
        o["champs"].as_object_mut().unwrap().remove(c);
    }
    for p in PREUVES_ENTETE {
        o["preuves"].as_object_mut().unwrap().remove(p);
    }
    o
}

#[derive(Default)]
struct Bilan {
    pieces: u32,
    sens_prouve: u32,
    sens_signale: u32,
    sens_absent: u32,
    sens_attendu: u32,
    mf_emetteur: u32,
    mf_client: u32,
    tiers_prouve: u32,
    tiers_attendu: u32,
    nom_emetteur_juste: u32,
    nom_emetteur_emis: u32,
    nom_emetteur_prouve: u32,
    nom_client_juste: u32,
    date_juste: u32,
    date_emise: u32,
    date_attendue: u32,
    echeance_juste: u32,
    echeance_emise: u32,
    echeance_attendue: u32,
    numero_juste: u32,
    numero_emis: u32,
    numero_attendu: u32,
}

/// Mesure un essai ; rend les fautes (toute faute fait échouer le test).
fn mesurer(
    titre: &str,
    pieces: &[Piece],
    grille_: &Value,
    pack_: &Value,
    connus_: &BTreeMap<String, Value>,
) -> Vec<String> {
    let mut fautes = Vec::new();
    let mut bilans: BTreeMap<&str, Bilan> = BTreeMap::new();
    let mut raisons: BTreeMap<String, u32> = BTreeMap::new();
    for p in pieces {
        let c = &connus_[jeu(&p.id)];
        let d = c["dossier"]["matricule"].as_str().unwrap().to_string();
        let tiers: BTreeMap<String, (String, String)> = c["tiers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| {
                (
                    t["matricule"].as_str().unwrap().to_string(),
                    (
                        t["code"].as_str().unwrap().to_string(),
                        t["raison_sociale"].as_str().unwrap().to_string(),
                    ),
                )
            })
            .collect();
        let v = &p.verite.entete;
        let o = jouer(p, grille_, pack_, Some(c));
        let b = bilans.entry(jeu(&p.id)).or_default();
        b.pieces += 1;
        let (mf_f, mf_c) = (
            v.mf_fournisseur.as_deref().map(norme_mf),
            v.mf_client.as_deref().map(norme_mf),
        );
        let attendu = if mf_c.as_deref() == Some(d.as_str()) {
            Some("achat")
        } else if mf_f.as_deref() == Some(d.as_str()) {
            Some("vente")
        } else {
            None
        };
        if attendu.is_some() {
            b.sens_attendu += 1;
        }
        let pa = &o["parties"];
        match pa["statut"].as_str().unwrap_or("") {
            "prouve" => {
                if pa["sens"].as_str() != attendu {
                    fautes.push(format!(
                        "{titre} {} : sens {} prouvé, attendu {attendu:?}",
                        p.id, pa["sens"]
                    ));
                    continue;
                }
                b.sens_prouve += 1;
                for (cote, vrai, champ) in [
                    ("emetteur", &mf_f, "matricule_fiscal_emetteur"),
                    ("client", &mf_c, "matricule_fiscal_client"),
                ] {
                    let lu = pa[cote]["matricule"]["valeur"].as_str();
                    if lu != vrai.as_deref() || o["champs"][champ]["valeur"].as_str() != lu {
                        fautes.push(format!(
                            "{titre} {} : matricule {cote} {lu:?} prouvé, vrai {vrai:?}",
                            p.id
                        ));
                    } else if cote == "emetteur" {
                        b.mf_emetteur += 1;
                    } else {
                        b.mf_client += 1;
                    }
                }
                // le tiers : celui du matricule de la contrepartie, s'il est connu
                let contrepartie = if attendu == Some("achat") {
                    &mf_f
                } else {
                    &mf_c
                };
                let tiers_vrai = contrepartie.as_ref().and_then(|m| tiers.get(m));
                if tiers_vrai.is_some() {
                    b.tiers_attendu += 1;
                }
                match (&pa["tiers"], tiers_vrai) {
                    (Value::Null, None) => {}
                    (t, Some((code, _)))
                        if t["code"] == code.as_str() && t["statut"] == "prouve" =>
                    {
                        b.tiers_prouve += 1
                    }
                    (t, _) => fautes.push(format!(
                        "{titre} {} : tiers {t} prouvé, vrai {tiers_vrai:?}",
                        p.id
                    )),
                }
                // un nom prouvé est celui de la partie connue (tiers ou dossier)
                for cote in ["emetteur", "client"] {
                    let nom = &pa[cote]["nom"];
                    if nom["statut"] != "prouve" {
                        continue;
                    }
                    let est_dossier = (cote == "client") == (attendu == Some("achat"));
                    let connu = if est_dossier {
                        c["dossier"]["raison_sociale"].as_str().unwrap().to_string()
                    } else {
                        tiers_vrai.map(|t| t.1.clone()).unwrap_or_default()
                    };
                    if norme_nom(nom["valeur"].as_str().unwrap()) != norme_nom(&connu) {
                        fautes.push(format!(
                            "{titre} {} : nom {cote} {} prouvé, connu {connu:?}",
                            p.id, nom["valeur"]
                        ));
                    }
                    if cote == "emetteur" {
                        b.nom_emetteur_prouve += 1;
                    }
                }
                let juste = |cote: &str, vrai: &Option<String>| {
                    pa[cote]["nom"]["valeur"].as_str().is_some_and(|n| {
                        vrai.as_deref()
                            .is_some_and(|v| norme_nom(n) == norme_nom(v))
                    })
                };
                if pa["emetteur"]["nom"].is_object() {
                    b.nom_emetteur_emis += 1;
                }
                if juste("emetteur", &v.fournisseur) {
                    b.nom_emetteur_juste += 1;
                }
                if juste("client", &v.client) {
                    b.nom_client_juste += 1;
                }
            }
            "signale" => {
                b.sens_signale += 1;
                *raisons
                    .entry(format!(
                        "{} ({})",
                        pa["raison"].as_str().unwrap_or(""),
                        if attendu.is_some() {
                            "attendu"
                        } else {
                            "hors dossier"
                        }
                    ))
                    .or_default() += 1;
            }
            _ => {
                b.sens_absent += 1;
                *raisons
                    .entry(format!(
                        "{} ({})",
                        pa["raison"].as_str().unwrap_or("pas de sortie"),
                        if attendu.is_some() {
                            "attendu"
                        } else {
                            "hors dossier"
                        }
                    ))
                    .or_default() += 1;
            }
        }
        // dates et numéro (statut conforme : mesurés, pas exigés)
        let champ = |c: &str| o["champs"][c]["valeur"].as_str().map(String::from);
        if let Some(vd) = v.date.as_deref() {
            b.date_attendue += 1;
            if let Some(lu) = champ("date_emission") {
                b.date_emise += 1;
                if lu == iso(vd) {
                    b.date_juste += 1;
                }
            }
        }
        if let Some(ve) = v.echeance.as_deref() {
            b.echeance_attendue += 1;
            if let Some(lu) = champ("date_echeance") {
                b.echeance_emise += 1;
                if lu == iso(ve) {
                    b.echeance_juste += 1;
                }
            }
        }
        if let Some(vn) = v.numero.as_deref() {
            b.numero_attendu += 1;
            if let Some(lu) = champ("numero_facture") {
                b.numero_emis += 1;
                if norme_numero(&lu) == norme_numero(vn) {
                    b.numero_juste += 1;
                }
            }
        }
    }
    println!("== {titre}");
    for (j, b) in &bilans {
        println!(
            "  JEU {j:>3} : {} pièces ({} au dossier) — sens prouvé {} / signalé {} / absent {} ; matricules justes émetteur {} client {} ; \
             tiers prouvé {}/{} ; nom émetteur juste {}/{} émis (prouvés {}), nom client juste {} ; date d'émission juste {}/{} (émise {}) ; \
             échéance juste {}/{} (émise {}) ; numéro juste {}/{} (émis {})",
            b.pieces,
            b.sens_attendu,
            b.sens_prouve,
            b.sens_signale,
            b.sens_absent,
            b.mf_emetteur,
            b.mf_client,
            b.tiers_prouve,
            b.tiers_attendu,
            b.nom_emetteur_juste,
            b.nom_emetteur_emis,
            b.nom_emetteur_prouve,
            b.nom_client_juste,
            b.date_juste,
            b.date_attendue,
            b.date_emise,
            b.echeance_juste,
            b.echeance_attendue,
            b.echeance_emise,
            b.numero_juste,
            b.numero_attendu,
            b.numero_emis
        );
    }
    for (r, n) in &raisons {
        println!("    non prouvé — {r} : {n}");
    }
    fautes
}

#[test]
fn anneau2_parties_prouvees_sans_faux() {
    let pieces: Vec<Piece> = jeux::pieces();
    assert_eq!(pieces.len(), 134);
    let connus_ = connus(&pieces);
    for (j, c) in &connus_ {
        println!(
            "dossier du jeu {j} : {} ; {} tiers connus",
            c["dossier"],
            c["tiers"].as_array().unwrap().len()
        );
    }
    let mut fautes = Vec::new();
    fautes.extend(mesurer(
        "grille et pack en base",
        &pieces,
        &grille(true, false),
        &pack(false),
        &connus_,
    ));
    fautes.extend(mesurer(
        "ESSAI — matricule sans lettre de clé admis, repères d'essai ajoutés à la grille",
        &pieces,
        &grille(true, true),
        &pack(true),
        &connus_,
    ));
    assert!(fautes.is_empty(), "fautes de l'anneau 2 : {fautes:#?}");
}

/// Le centre et les lignes sont identiques avec et sans l'anneau 2, sur les 134 pièces,
/// avec et sans `connus`.
#[test]
fn anneau2_ne_touche_ni_le_centre_ni_les_lignes() {
    let pieces: Vec<Piece> = jeux::pieces();
    let connus_ = connus(&pieces);
    let (g0, g2) = (grille(false, false), grille(true, false));
    let mut changes = Vec::new();
    for pk in [pack(false), pack(true)] {
        for p in &pieces {
            let sans = jouer(p, &g0, &pk, None);
            for c in [None, Some(&connus_[jeu(&p.id)])] {
                let avec = jouer(p, &g2, &pk, c);
                if sans_entete(&avec) != sans_entete(&sans) {
                    changes.push(p.id.clone());
                }
            }
            // sans connus : pas de sortie `parties`, la preuve n'est pas évaluable
            let o = jouer(p, &g2, &pk, None);
            assert!(o.get("parties").is_none(), "{} : parties sans connus", p.id);
            assert_eq!(o["preuves"][PREUVE_PARTIES], "non_evaluable");
        }
    }
    assert!(
        changes.is_empty(),
        "centre ou lignes modifiés par l'anneau 2 : {changes:?}"
    );
}

/// Mutations du dossier : un matricule absent de la pièce ne prouve plus aucun sens ; le
/// dossier remplacé par le fournisseur lui-même renverse le sens (vente), sans faute.
#[test]
fn anneau2_mutations_du_dossier() {
    let pieces: Vec<Piece> = jeux::pieces();
    let connus_ = connus(&pieces);
    let (g, pk) = (grille(true, true), pack(true));
    let dossiers: Vec<String> = connus_
        .values()
        .map(|c| c["dossier"]["matricule"].as_str().unwrap().to_string())
        .collect();
    let (mut prouves_avant, mut encore, mut ventes, mut ventes_justes, mut fautes) =
        (0, 0, 0, 0, Vec::new());
    for p in &pieces {
        let c = &connus_[jeu(&p.id)];
        if jouer(p, &g, &pk, Some(c))["parties"]["statut"] != "prouve" {
            continue;
        }
        prouves_avant += 1;
        // 1. le matricule d'un autre dossier, absent de la pièce
        let texte: String = p.jetons.iter().map(|j| norme_mf(&j.2)).collect();
        let autre = dossiers
            .iter()
            .find(|d| **d != c["dossier"]["matricule"] && !texte.contains(d.as_str()))
            .unwrap();
        let mut m = c.clone();
        m["dossier"]["matricule"] = json!(autre);
        let o = jouer(p, &g, &pk, Some(&m));
        if o["parties"]["statut"] == "prouve" {
            encore += 1;
            fautes.push(format!(
                "{} : sens {} prouvé avec un dossier absent de la pièce",
                p.id, o["parties"]["sens"]
            ));
        }
        // 2. le dossier est le fournisseur : c'est une vente, au client ALGORIA FACTORY
        let v = &p.verite.entete;
        let (Some(mf_f), Some(f)) = (&v.mf_fournisseur, &v.fournisseur) else {
            continue;
        };
        let mut m = c.clone();
        m["dossier"] = json!({"matricule": norme_mf(mf_f), "raison_sociale": f});
        m["tiers"] = json!([{"code": "411001", "matricule": c["dossier"]["matricule"], "raison_sociale": c["dossier"]["raison_sociale"]}]);
        let o = jouer(p, &g, &pk, Some(&m));
        let pa = &o["parties"];
        if pa["statut"] == "prouve" {
            ventes += 1;
            let juste = pa["sens"] == "vente"
                && pa["emetteur"]["matricule"]["valeur"] == norme_mf(mf_f).as_str()
                && pa["client"]["matricule"]["valeur"] == c["dossier"]["matricule"]
                && pa["tiers"]["code"] == "411001";
            if juste {
                ventes_justes += 1;
            } else {
                fautes.push(format!("{} : dossier = fournisseur, prouvé {pa}", p.id));
            }
        }
    }
    println!(
        "MUTATIONS (essai) sur {prouves_avant} pièces au sens prouvé — dossier absent de la pièce : encore prouvé {encore} ; \
         dossier = fournisseur : vente prouvée {ventes} (justes {ventes_justes})"
    );
    assert!(prouves_avant > 0);
    assert!(fautes.is_empty(), "{fautes:#?}");
}

/// La forme de la sortie, sur une pièce synthétique : un achat à un tiers connu.
#[test]
fn anneau2_forme_de_la_sortie() {
    let j = |o: u32, t: &str, x: f64, y: f64, w: f64| json!({"page": 1, "ordinal": o, "texte": t, "x0": x, "y0": y, "x1": x + w, "y1": y + 0.01, "montants": [], "date": null});
    let mut jetons = vec![
        j(0, "INFOTECH", 0.10, 0.05, 0.10),
        j(1, "SOLUTIONS", 0.21, 0.05, 0.10),
        j(2, "SARL", 0.32, 0.05, 0.05),
        j(3, "MF", 0.10, 0.07, 0.02),
        j(4, ":", 0.125, 0.07, 0.005),
        j(5, "1245789K/A/M/000", 0.14, 0.07, 0.12),
        j(6, "Facture", 0.60, 0.05, 0.07),
        j(7, "N°", 0.68, 0.05, 0.02),
        j(8, "FA-2026-00412", 0.71, 0.05, 0.12),
        j(9, "Date", 0.60, 0.07, 0.04),
        j(10, ":", 0.645, 0.07, 0.005),
        j(11, "12/01/2026", 0.66, 0.07, 0.08),
        j(12, "Échéance", 0.60, 0.09, 0.07),
        j(13, ":", 0.675, 0.09, 0.005),
        j(14, "11/02/2026", 0.69, 0.09, 0.08),
        j(15, "Client", 0.10, 0.15, 0.05),
        j(16, ":", 0.155, 0.15, 0.005),
        j(17, "ALGORIA", 0.17, 0.15, 0.07),
        j(18, "FACTORY", 0.25, 0.15, 0.07),
        j(19, "SUARL", 0.33, 0.15, 0.05),
        j(20, "MF", 0.17, 0.17, 0.02),
        j(21, ":", 0.195, 0.17, 0.005),
        j(22, "1876543W/A/M/000", 0.21, 0.17, 0.12),
    ];
    jetons[11]["date"] = json!("2026-01-12");
    jetons[14]["date"] = json!("2026-02-11");
    let connus_ = json!({
        "dossier": {"matricule": "1876543W/A/M/000", "raison_sociale": "ALGORIA FACTORY"},
        "tiers": [{"code": "401002", "matricule": "1245789K/A/M/000", "raison_sociale": "Infotech Solutions"}],
        "formes_juridiques": FORMES
    });
    let (jouees, _) = par_variante_avec(&jetons, &grille(true, true), &pack(false), Some(&connus_));
    let o = la_piece(&jouees);
    let pa = &o["parties"];
    assert_eq!(pa["sens"], "achat", "{pa}");
    assert_eq!(pa["statut"], "prouve");
    assert_eq!(
        pa["emetteur"]["matricule"],
        json!({"valeur": "1245789K/A/M/000", "refs": [{"page": 1, "ordinal": 5}], "statut": "prouve"})
    );
    assert_eq!(
        pa["emetteur"]["nom"],
        json!({"valeur": "INFOTECH SOLUTIONS SARL", "refs": [{"page": 1, "ordinal": 0}, {"page": 1, "ordinal": 1}, {"page": 1, "ordinal": 2}], "statut": "prouve"})
    );
    assert_eq!(pa["client"]["matricule"]["valeur"], "1876543W/A/M/000");
    assert_eq!(pa["client"]["nom"]["valeur"], "ALGORIA FACTORY SUARL");
    assert_eq!(pa["tiers"], json!({"code": "401002", "statut": "prouve"}));
    assert_eq!(o["preuves"][PREUVE_PARTIES], "verifiee");
    assert_eq!(o["preuves"][PREUVE_ORDRE], "verifiee");
    assert_eq!(o["preuves"]["P05"], "verifiee");
    assert_eq!(o["champs"]["date_emission"]["valeur"], "2026-01-12");
    assert_eq!(o["champs"]["date_echeance"]["valeur"], "2026-02-11");
    assert_eq!(
        o["champs"]["numero_facture"],
        json!({"valeur": "FA-2026-00412", "refs": [{"page": 1, "ordinal": 8}], "statut": "conforme"})
    );
    assert_eq!(o["champs"]["raison_sociale_emetteur"]["statut"], "prouve");
    println!("{}", serde_json::to_string(&json!({"parties": pa, "preuves": {PREUVE_PARTIES: o["preuves"][PREUVE_PARTIES], PREUVE_ORDRE: o["preuves"][PREUVE_ORDRE]}})).unwrap());

    // Tiers inconnu : le nom est la rangée au-dessus du matricule qui porte une forme, `conforme`.
    let mut inconnu = connus_.clone();
    inconnu["tiers"] = json!([]);
    let o =
        la_piece(&par_variante_avec(&jetons, &grille(true, true), &pack(false), Some(&inconnu)).0);
    assert_eq!(o["parties"]["tiers"], Value::Null);
    assert_eq!(
        o["parties"]["emetteur"]["nom"]["valeur"],
        "INFOTECH SOLUTIONS SARL"
    );
    assert_eq!(o["parties"]["emetteur"]["nom"]["statut"], "conforme");

    // Le dossier des deux côtés (dans l'en-tête de l'émetteur et dans le bloc du client),
    // la contrepartie en pied de page : indices contraires, signalé.
    let mut deux = jetons.clone();
    deux[5]["texte"] = json!("1876543W/A/M/000");
    deux.push(j(23, "1245789K/A/M/000", 0.40, 0.90, 0.12));
    let o =
        la_piece(&par_variante_avec(&deux, &grille(true, true), &pack(false), Some(&connus_)).0);
    assert_eq!(o["parties"]["statut"], "signale", "{}", o["parties"]);
    assert_eq!(o["parties"]["raison"], "indices de sens contradictoires");
    assert_eq!(o["parties"]["sens"], Value::Null);
    assert_eq!(
        o["champs"]["matricule_fiscal_emetteur"]["statut"],
        "signale"
    );
}
