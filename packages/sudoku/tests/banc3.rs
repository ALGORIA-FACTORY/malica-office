//! Rejoue le banc 3 mesuré sur l'implémentation de référence : 60 factures et
//! 6 tickets FICTIFS (générés), lus par OCR, et 3 000 lectures corrompues.
//! Exigences : 0 fausse preuve, 6/6 tickets non prouvés, 0 fausse preuve sur les
//! mutations ; 55/60 factures prouvées justes. Le moteur ne retient plus un total HT qui
//! ne porte pas son libellé (décision du dirigeant, 2 novembre 2026 : zéro fausse preuve
//! l'emporte) : 60 avant elle, F008, F009, F024, F031 et F032 n'ont aucun libellé lu sur
//! la rangée de leur HT.

mod commun;

use commun::*;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

#[derive(Deserialize)]
struct Verite {
    id: String,
    #[serde(rename = "type")]
    genre: String,
    #[serde(default)]
    ht: i64,
    #[serde(default)]
    ttc: i64,
    #[serde(default)]
    timbre: Option<i64>,
    #[serde(default)]
    fodec_mt: Option<i64>,
    #[serde(default)]
    tva: BTreeMap<String, i64>,
}

impl Verite {
    fn tva(&self) -> Vec<(i64, i64)> {
        let mut v: Vec<(i64, i64)> = self
            .tva
            .iter()
            .map(|(t, m)| (t.parse().unwrap(), *m))
            .collect();
        v.sort();
        v
    }
    /// La facture rendue est-elle exactement la vraie ? (HT, TTC, timbre, FODEC, TVA par taux)
    fn juste(&self, o: &Value) -> bool {
        valeur(o, "total_ht") == self.ht
            && valeur(o, "total_ttc") == self.ttc
            && valeur(o, "droit_timbre") == self.timbre.unwrap_or(0)
            && valeur(o, "montant_fodec") == self.fodec_mt.unwrap_or(0)
            && tva(o) == self.tva()
    }
    /// Le critère des mutations de la référence (eval_mut.py) : HT, TTC et TVA par taux.
    fn juste_mutation(&self, o: &Value) -> bool {
        valeur(o, "total_ht") == self.ht
            && valeur(o, "total_ttc") == self.ttc
            && tva(o) == self.tva()
    }
}

fn verites() -> HashMap<String, Verite> {
    let v: Vec<Verite> = serde_json::from_str(&donnees("banc3_verite.json")).unwrap();
    v.into_iter().map(|x| (x.id.clone(), x)).collect()
}

#[test]
fn banc3_factures_et_tickets() {
    let lecteur = Lecteur::new();
    let releves = releves("banc3_releves.json");
    let verites = verites();
    let mut ids: Vec<&String> = releves.keys().collect();
    ids.sort();
    let (mut justes, mut fausses, mut tickets_signales, mut factures, mut tickets) =
        (0, 0, 0, 0, 0);
    let mut non_prouvees = Vec::new();
    let mut temps = Vec::new();
    for id in ids {
        let v = &verites[id];
        let jetons = lecteur.jetons(&releves[id].lignes);
        let e = entree(jetons, grille_facture(), pack_essai());
        let t0 = Instant::now();
        let s = malica_sudoku::solve(&e);
        let us = t0.elapsed().as_micros();
        let o: Value = serde_json::from_str(&s).unwrap();
        if v.genre == "facture" {
            factures += 1;
            temps.push(us);
            if o["issue"] == "prouvee" {
                if v.juste(&o) {
                    justes += 1;
                } else {
                    fausses += 1;
                    eprintln!("FAUSSE PREUVE {id} : {s}");
                }
            } else {
                non_prouvees.push(format!("{id} {} ({} sol.)", o["issue"], o["solutions"]));
            }
        } else {
            tickets += 1;
            if o["issue"] != "prouvee" {
                tickets_signales += 1;
            } else {
                eprintln!("TICKET PROUVÉ {id} : {s}");
            }
        }
    }
    temps.sort();
    let mediane = temps[temps.len() / 2];
    println!(
        "BANC 3 : factures prouvées justes {justes}/{factures}, fausses preuves {fausses}, tickets signalés {tickets_signales}/{tickets} ; \
         temps médian par facture {:.2} ms (max {:.2} ms)",
        mediane as f64 / 1000.0,
        *temps.last().unwrap() as f64 / 1000.0
    );
    for n in &non_prouvees {
        println!("  non prouvée : {n}");
    }
    assert_eq!(fausses, 0);
    assert_eq!((justes, factures), (55, 60));
    assert_eq!((tickets_signales, tickets), (6, 6));
}

#[derive(Deserialize)]
struct Mutation {
    mode: String,
    /// (indice de ligne, texte corrompu)
    lignes: Vec<(usize, String)>,
}

#[test]
fn banc3_mutations_zero_fausse_preuve() {
    let lecteur = Lecteur::new();
    let releves = releves("banc3_releves.json");
    let verites = verites();
    let mutations: BTreeMap<String, Mutation> =
        serde_json::from_str(&donnees("banc3_mutations.json")).unwrap();
    let mut par_mode: BTreeMap<String, (u32, u32, u32)> = BTreeMap::new(); // (prouvées justes, signalées, fausses)
    let mut fausses = Vec::new();
    for (mid, m) in &mutations {
        let pid = mid.split('_').next().unwrap();
        let mut lignes = releves[pid].lignes.clone();
        for (i, t) in &m.lignes {
            lignes[*i].text = t.clone();
        }
        let o = resoudre(lecteur.jetons(&lignes), grille_facture(), pack_essai());
        let e = par_mode.entry(m.mode.clone()).or_default();
        if o["issue"] == "prouvee" {
            if verites[pid].juste_mutation(&o) {
                e.0 += 1;
            } else {
                e.2 += 1;
                fausses.push(mid.clone());
            }
        } else {
            e.1 += 1;
        }
    }
    let total: u32 = par_mode.values().map(|(a, b, c)| a + b + c).sum();
    println!("MUTATIONS : {total}");
    for (mode, (j, s, f)) in &par_mode {
        println!("  {mode:7} prouvées justes (redondance) {j}, signalées {s}, fausses preuves {f}");
    }
    assert_eq!(total, 3000);
    assert!(fausses.is_empty(), "fausses preuves : {fausses:?}");
}
