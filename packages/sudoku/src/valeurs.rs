//! Le domaine des valeurs lues (chaque valeur et les jetons qui la portent) et
//! l'arithmétique entière des taux. Aucun flottant dans un verdict : les taux
//! sont en parties par million (contrat §3), les arrondis sont entiers.

use crate::entree::Jeton;
use std::collections::BTreeMap;

/// Dénominateur des parties par million : l'unité du contrat, pas un taux.
pub const PPM: i128 = 1_000_000;

/// Un pourcentage s'exprime sur cent : l'unité du symbole « % », pas un taux.
pub const CENT: i128 = 100;

/// Division arrondie au plus proche, demi loin de zéro (d > 0).
pub fn div_arrondi(n: i128, d: i128) -> i128 {
    if n >= 0 {
        (2 * n + d) / (2 * d)
    } else {
        -((-2 * n + d) / (2 * d))
    }
}

/// Un coefficient rationnel strictement positif : arrondi(b × num / den).
#[derive(Clone, Copy, Debug)]
pub struct Coef {
    pub num: i128,
    pub den: i128,
}

impl Coef {
    pub fn ppm(ppm: i64) -> Self {
        Coef {
            num: ppm as i128,
            den: PPM,
        }
    }
    /// Le taux appliqué à une base majorée des charges d'assiette (ppm cumulés).
    pub fn avec_assiette(ppm: i64, assiette_ppm: i64) -> Self {
        Coef {
            num: ppm as i128 * (PPM + assiette_ppm as i128),
            den: PPM * PPM,
        }
    }
    pub fn applique(&self, b: i64) -> i64 {
        div_arrondi(b as i128 * self.num, self.den) as i64
    }
    pub fn reel(&self) -> f64 {
        self.num as f64 / self.den as f64
    }
    /// Plus petite base b telle que arrondi(b × coef) ≥ cible (la fonction est croissante).
    pub fn premiere_base(&self, cible: i64) -> i64 {
        let est = (cible as i128 * self.den / self.num) as i64;
        let pas = (self.den / self.num) as i64 + 4;
        let (mut lo, mut hi) = (est - pas, est + pas);
        while self.applique(lo) >= cible {
            lo -= pas;
        }
        while self.applique(hi) < cible {
            hi += pas;
        }
        // invariant : applique(lo) < cible ≤ applique(hi)
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if self.applique(mid) >= cible {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        hi
    }
    /// Les bases b telles que |arrondi(b × coef) − m| ≤ tol.
    pub fn bases_a_tolerance(&self, m: i64, tol: i64) -> (i64, i64) {
        (
            self.premiere_base(m - tol),
            self.premiere_base(m + tol + 1) - 1,
        )
    }
    /// Les bases b telles que arrondi(b × coef) = m exactement, élargies de tol unités
    /// de base : la marge des bases déduites, non imprimées.
    pub fn bases_deduites(&self, m: i64, tol: i64) -> (i64, i64) {
        (
            self.premiere_base(m) - tol,
            self.premiere_base(m + 1) - 1 + tol,
        )
    }
}

/// Une occurrence d'une valeur : le jeton qui la porte et la force de sa lecture.
#[derive(Clone, Copy)]
pub struct Occurrence {
    pub jeton: usize,
    pub forte: bool,
}

pub struct Valeur {
    /// Vrai si au moins une lecture de cette valeur est forte.
    pub forte: bool,
    pub occurrences: Vec<Occurrence>,
}

pub struct Domaine {
    pub valeurs: BTreeMap<i64, Valeur>,
}

impl Domaine {
    pub fn new(jetons: &[Jeton]) -> Self {
        let mut valeurs: BTreeMap<i64, Valeur> = BTreeMap::new();
        for (i, j) in jetons.iter().enumerate() {
            for l in &j.montants {
                let e = valeurs.entry(l.v).or_insert(Valeur {
                    forte: false,
                    occurrences: Vec::new(),
                });
                e.forte |= l.forte;
                if !e
                    .occurrences
                    .iter()
                    .any(|o| o.jeton == i && o.forte == l.forte)
                {
                    e.occurrences.push(Occurrence {
                        jeton: i,
                        forte: l.forte,
                    });
                }
            }
        }
        Domaine { valeurs }
    }

    /// Some(faible) si la valeur est portée par un jeton, None sinon.
    pub fn faible(&self, v: i64) -> Option<bool> {
        self.valeurs.get(&v).map(|e| !e.forte)
    }

    pub fn forte(&self, v: i64) -> bool {
        self.valeurs.get(&v).is_some_and(|e| e.forte)
    }

    /// Les valeurs portées dans [lo, hi], avec leur faiblesse.
    pub fn entre(&self, lo: i64, hi: i64) -> Vec<(i64, bool)> {
        if lo > hi {
            return Vec::new();
        }
        self.valeurs
            .range(lo..=hi)
            .map(|(v, e)| (*v, !e.forte))
            .collect()
    }

    pub fn toutes(&self) -> Vec<(i64, bool)> {
        self.valeurs.iter().map(|(v, e)| (*v, !e.forte)).collect()
    }
}
