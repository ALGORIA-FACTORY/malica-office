//! L'identité du dossier ne remplit qu'un seul rôle par pièce.
//!
//! Le moteur connaît le dossier (son matricule, sa raison sociale : `connus.dossier`) et
//! la grille dit, pour chaque champ, la partie qu'il décrit (`role` : fournisseur, client,
//! employeur, bailleur…). Une pièce est entre des parties DISTINCTES : une valeur qui porte
//! l'identité du dossier ne peut décrire qu'un rôle — celui du dossier.
//!
//! D'où l'invariant, vérifié sur tous les champs, quel que soit l'anneau qui les a lus :
//!
//!   - quand un rôle du dossier est PROUVÉ (l'anneau 2 a établi le sens de la pièce), une
//!     valeur à l'identité du dossier, posée sur un AUTRE rôle, est retirée ;
//!   - sans rôle prouvé, si l'identité du dossier se lit dans deux rôles différents, aucun
//!     des deux ne la garde : le moteur ne choisit pas, il se tait.
//!
//! Banc sans IA du 4 novembre 2026 : la raison sociale du fournisseur sortait « ALGORIA
//! FACTORY SARL » (le dossier) sur 17 achats, puis « الحريف :Laboratoire Qirwane… » (le
//! bloc du client) sur des pièces bilingues. Aucune règle propre à un champ : le rôle vient
//! de la base, l'identité du dossier aussi.

use std::collections::{BTreeMap, BTreeSet};

use crate::entree::Entree;
use crate::reperes::normaliser;
use crate::ChampSortie;

/// Un mot comparable : sans casse, sans accents, sans ponctuation.
fn mots(s: &str) -> Vec<String> {
    s.split(|c: char| c.is_whitespace() || ":;,/|()".contains(c))
        .map(|m| normaliser(m).chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|m| !m.is_empty())
        .collect()
}

/// La signature du dossier : la clé de son matricule (le noyau et sa lettre) et les mots de
/// sa raison sociale, formes juridiques ôtées.
struct Signature {
    cle: Option<String>,
    nom: Vec<String>,
}

impl Signature {
    fn porte(&self, valeur: &str) -> bool {
        let compacte: String = valeur.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_uppercase()).collect();
        if self.cle.as_deref().is_some_and(|k| compacte.contains(k)) {
            return true;
        }
        if self.nom.is_empty() {
            return false;
        }
        let m = mots(valeur);
        m.windows(self.nom.len()).any(|w| w == self.nom.as_slice())
    }
}

pub fn exclusive(entree: &Entree, champs: &mut BTreeMap<String, ChampSortie>) {
    let Some(dossier) = entree.connus.as_ref().and_then(|c| c.dossier.as_ref()) else { return };
    let formes: BTreeSet<String> = entree
        .connus
        .as_ref()
        .map(|c| c.formes_juridiques.iter().flat_map(|f| mots(f)).collect())
        .unwrap_or_default();
    // La clé : la plus longue suite de chiffres suivie d'une lettre, en tête du matricule.
    let compact: String = dossier.matricule.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_uppercase()).collect();
    let chiffres = compact.chars().take_while(|c| c.is_ascii_digit()).count();
    let cle = (chiffres >= 6 && compact.len() > chiffres).then(|| compact[..=chiffres].to_string());
    let nom: Vec<String> = dossier
        .raison_sociale
        .as_deref()
        .map(|rs| mots(rs).into_iter().filter(|m| !formes.contains(m)).collect())
        .unwrap_or_default();
    let sig = Signature { cle, nom };

    let roles: BTreeMap<&str, &str> = entree
        .grille
        .champs
        .iter()
        .filter_map(|c| c.role.as_deref().map(|r| (c.code.as_str(), r)))
        .collect();
    let porteurs: Vec<(String, &str, bool)> = champs
        .iter()
        .filter_map(|(code, c)| {
            let role = roles.get(code.as_str())?;
            let v = c.valeur.as_deref()?;
            sig.porte(v).then(|| (code.clone(), *role, c.statut == "prouve"))
        })
        .collect();
    let prouves: BTreeSet<&str> = porteurs.iter().filter(|(_, _, p)| *p).map(|(_, r, _)| *r).collect();
    let tous: BTreeSet<&str> = porteurs.iter().map(|(_, r, _)| *r).collect();
    for (code, role, _) in &porteurs {
        let retirer = if prouves.is_empty() { tous.len() > 1 } else { !prouves.contains(role) };
        if retirer {
            champs.insert(code.clone(), ChampSortie { valeur: None, refs: Vec::new(), statut: "absent".into(), instances: None });
        }
    }
}
