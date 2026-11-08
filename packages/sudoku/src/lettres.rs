//! La preuve `lettres` : le montant écrit en toutes lettres égale un total prouvé.
//!
//! `{"op":"lettres","champ":"montant_en_lettres","egal_a":["total_ttc","net_a_payer?"]}`
//! (contrat §2). Le moteur ne lit pas les lettres (règle ①) : l'adaptateur les lit avec le
//! lexique du pack et porte le montant, en unités mineures, sur le premier jeton de la
//! phrase (`lettres`). Le moteur compare.
//!
//! Elle se juge APRÈS le centre et ses anneaux, sur la solution unique :
//! - aucun montant en lettres lu, ou pièce non prouvée : `non_evaluable` ;
//! - chaque montant lu égale la valeur prouvée (sans son signe) de l'un des champs `egal_a` :
//!   `verifiee` ;
//! - sinon `echec`, et c'est la SEULE preuve non arithmétique qui change l'issue : la pièce
//!   n'est plus `prouvee` mais `signalee` (100/D-04, 1er novembre 2026 : « trois mille deux
//!   cents dinars » sous un net de 9 676,890).

use crate::entree::{Entree, Grille};
use crate::textuel::jusqua;
use crate::{ChampSortie, RefJeton};
use serde_json::Value;

/// Le nom de l'op dans le langage des preuves.
pub const OP: &str = "lettres";

/// L'op lue dans la grille : le champ des lettres, et les champs qu'elles doivent égaler.
pub struct OpLettres {
    pub champ: usize,
    pub egal_a: Vec<usize>,
}

fn nom(v: &Value) -> Option<&str> {
    v.as_str().map(|s| s.trim_end_matches('?').trim())
}

pub fn lire_op(grille: &Grille, e: &Value) -> Result<OpLettres, String> {
    let index = |n: &str| {
        grille
            .champs
            .iter()
            .position(|c| c.code == n)
            .ok_or_else(|| format!("champ « {n} » absent de la grille"))
    };
    let champ = index(
        e.get("champ")
            .and_then(nom)
            .ok_or("clé « champ » manquante")?,
    )?;
    let egal_a = e
        .get("egal_a")
        .and_then(|v| v.as_array())
        .ok_or("clé « egal_a » manquante")?
        .iter()
        .map(|v| index(nom(v).ok_or("egal_a : un nom de champ attendu")?))
        .collect::<Result<Vec<_>, _>>()?;
    if egal_a.is_empty() {
        return Err("egal_a vide".into());
    }
    Ok(OpLettres { champ, egal_a })
}

/// Les montants en lettres que l'adaptateur a lus, chacun cité sur toute sa phrase.
pub(crate) fn lus(entree: &Entree) -> Vec<(i64, Vec<RefJeton>)> {
    entree
        .jetons
        .iter()
        .enumerate()
        .filter_map(|(i, j)| {
            let l = j.lettres?;
            let fin = jusqua(&entree.jetons, i, Some(l.fin));
            let refs = (i..=fin)
                .map(|k| RefJeton {
                    page: entree.jetons[k].page,
                    ordinal: entree.jetons[k].ordinal,
                })
                .collect();
            Some((l.v, refs))
        })
        .collect()
}

/// Ce que la preuve rend : son statut, et le champ des lettres.
pub struct Resultat {
    pub statut: &'static str,
    pub champ: Option<ChampSortie>,
}

/// `prouves` : la valeur prouvée de chaque champ de la grille, quand la pièce est prouvée.
pub fn prouver(
    op: &OpLettres,
    entree: &Entree,
    prouves: Option<&dyn Fn(usize) -> Option<i64>>,
) -> Resultat {
    let lus = lus(entree);
    let Some((v0, refs0)) = lus.first() else {
        return Resultat {
            statut: "non_evaluable",
            champ: None,
        };
    };
    let uniques = lus.iter().all(|(v, _)| v == v0);
    let champ = |statut: &str| {
        if uniques {
            ChampSortie {
                valeur: Some(v0.to_string()),
                refs: refs0.clone(),
                statut: statut.into(),
                instances: None,
            }
        } else {
            ChampSortie {
                valeur: None,
                refs: Vec::new(),
                statut: "signale".into(),
                instances: None,
            }
        }
    };
    let Some(prouves) = prouves else {
        return Resultat {
            statut: "non_evaluable",
            champ: Some(champ("conforme")),
        };
    };
    // Les lettres ne portent pas de signe : un avoir imprime « −1 856,400 » et écrit « mille
    // huit cent cinquante-six dinars et quatre cents millimes » (100/B-13).
    let attendus: Vec<i64> = op
        .egal_a
        .iter()
        .filter_map(|&c| prouves(c))
        .map(i64::abs)
        .collect();
    if attendus.is_empty() {
        return Resultat {
            statut: "non_evaluable",
            champ: Some(champ("conforme")),
        };
    }
    if lus.iter().all(|(v, _)| attendus.contains(v)) {
        Resultat {
            statut: "verifiee",
            champ: Some(champ("prouve")),
        }
    } else {
        Resultat {
            statut: "echec",
            champ: Some(champ("signale")),
        }
    }
}
