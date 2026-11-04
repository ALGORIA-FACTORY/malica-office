//! L'anneau 1 : les lignes d'articles, prouvées à partir du centre.
//!
//! Preuve `{"op":"lignes", …}` (contrat §2). Déterministe, sans IA :
//! 1. les jetons se regroupent en rangées (même page, recouvrement vertical de
//!    plus de la moitié de la hauteur) ;
//! 2. une rangée est une ligne d'article si elle porte, de gauche à droite, une
//!    quantité q (lecture quelconque), un prix p et un montant m (lectures fortes)
//!    avec m = arrondi(q × p × (1 − r)) à la tolérance du pack près, r étant un
//!    taux de remise lu sur la rangée (jeton marqué « % »), sinon 0 ;
//! 3. la somme EXACTE des montants retenus doit valoir la valeur PROUVÉE du total
//!    au centre. Une seule combinaison (en valeurs) qui ferme : `prouve` ; aucune ou
//!    plusieurs : `signale`.
//!
//! Une grille dont les prix s'impriment TTC (« PU TTC 32,000 », montant HT « 26,891 »)
//! le déclare par la clé `prix_ttc` de l'op : la rangée ferme alors aussi par
//! m = arrondi(q × p × (1 − r) ÷ (1 + t)), t un taux du barème de la grille, et la ligne
//! rend son prix comme TTC (`prix_ttc`). Sans la clé, rien ne change.
//!
//! Quand cette stratégie ne prouve pas (une cellule perdue par l'OCR), la lecture
//! « du milieu vers les bords » (`milieu`) prend le relais : elle apprend la règle du
//! tableau de sa rangée la mieux expliquée, et peut déduire une cellule manquante.
//!
//! Non bloquant : cette preuve lit la sortie du centre et ne la modifie jamais.
//! Aucune constante réglementaire : le barème vient du pack (R4).

mod colonnes;
mod milieu;

use crate::entree::{Entree, Grille, Jeton};
use crate::valeurs::{div_arrondi, CENT, PPM};
use crate::{ChampSortie, RefJeton};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Le nom de l'op dans le langage des preuves.
pub const OP: &str = "lignes";

/// Plafond des combinaisons de triplets explorées ; au-delà, les lignes sont signalées.
const PLAFOND_COMBINAISONS: u64 = 100_000;

#[derive(Serialize, Clone)]
pub struct Cite {
    pub valeur: String,
    pub refs: Vec<RefJeton>,
    /// `lu` (la valeur est celle du jeton cité) ou `deduit` (aucun jeton : la valeur est
    /// déduite de la rangée et de la somme). Rendu par la lecture du milieu seulement ;
    /// absent, la cellule est lue.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub statut: Option<&'static str>,
    /// Pour une cellule déduite : l'endroit où elle devrait être imprimée (colonne ×
    /// bande de la rangée), pour une relecture ciblée.
    #[serde(rename = "case", skip_serializing_if = "Option::is_none")]
    pub case_: Option<Case>,
    /// Pour une cellule issue d'une case collée (`statut` « coupe ») : la coupe retenue,
    /// en caractères à gauche du jeton cité.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coupe: Option<usize>,
}

/// Un rectangle de la page, en coordonnées du plan.
#[derive(Serialize, Clone)]
pub struct Case {
    pub page: u32,
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Cite {
    fn lue(valeur: String, refs: Vec<RefJeton>) -> Self {
        Cite { valeur, refs, statut: None, case_: None, coupe: None }
    }
}

#[derive(Serialize, Clone)]
pub struct TauxCite {
    pub code: String,
    pub refs: Vec<RefJeton>,
}

#[derive(Serialize, Clone)]
pub struct LigneSortie {
    pub designation: Option<Cite>,
    pub quantite: Cite,
    pub prix: Cite,
    pub remise: Option<Cite>,
    pub montant: Cite,
    pub taux: Option<TauxCite>,
    /// Le prix lu est TTC : la rangée ferme par q × p ÷ (1 + taux) = montant HT.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub prix_ttc: bool,
}

#[derive(Serialize)]
pub struct LignesSortie {
    pub statut: String,
    pub instances: Vec<LigneSortie>,
    /// Σ montants des lignes par taux = base de ce taux au centre :
    /// `verifiee`, `echec` (les taux lus sont alors retirés) ou `non_evaluable`.
    pub taux_par_base: String,
    /// Le nombre de cellules déduites (lecture du milieu), quand il y en a.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduites: Option<usize>,
    /// La remise globale qui sépare Σ montants des lignes du total HT prouvé, quand c'est
    /// elle qui ferme le tableau : sa valeur (positive) et le jeton qui la porte.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remise_globale: Option<Cite>,
}

/// L'op lue dans la grille.
pub struct OpLignes {
    /// Le champ de la désignation.
    pub designation: String,
    pub montant_total: String,
    pub total_brut: Option<String>,
    /// Le champ de la remise de ligne, s'il est déclaré (ses repères disent un tableau à remise).
    pub remise: Option<String>,
    /// Le champ de la remise globale, s'il est déclaré : ses repères ancrent, dans le bloc
    /// des totaux, la remise qui sépare Σ montants du total HT.
    pub remise_globale: Option<String>,
    /// Les champs des lignes (désignation, quantité, prix, remise, montant, taux).
    pub champs_lignes: Vec<String>,
    /// Les champs des trois colonnes chiffrées : quantité, prix, montant.
    pub colonnes: [String; 3],
    pub bareme: Option<String>,
    pub base_par_taux: Option<String>,
    /// Le total des bases du groupe de taux (`total_base`), s'il est déclaré.
    pub total_base: Option<String>,
    pub avec_taux: bool,
    /// Le champ du prix TTC (`prix_ttc`), quand la grille dit que les prix peuvent s'imprimer TTC.
    pub prix_ttc: Option<String>,
}

fn cle(e: &Value, k: &str) -> Option<String> {
    e.get(k).and_then(|v| v.as_str()).map(|s| s.trim_end_matches('?').trim().to_string())
}

/// Lit et contrôle l'op : tous les champs nommés existent dans la grille, avec le bon type.
pub fn lire_op(grille: &Grille, e: &Value) -> Result<OpLignes, String> {
    let genre = |nom: &str| -> Result<&str, String> {
        grille
            .champs
            .iter()
            .find(|c| c.code == nom)
            .map(|c| c.genre.as_str())
            .ok_or_else(|| format!("champ « {nom} » absent de la grille"))
    };
    let exige = |k: &str| cle(e, k).ok_or_else(|| format!("clé « {k} » manquante"));
    let numerique = |nom: &str| -> Result<(), String> {
        match genre(nom)? {
            "montant" | "nombre" => Ok(()),
            g => Err(format!("champ « {nom} » de type {g}, non numérique")),
        }
    };
    let designation = exige("designation")?;
    genre(&designation)?;
    let colonnes = [exige("quantite")?, exige("prix")?, exige("montant")?];
    for c in &colonnes {
        numerique(c)?;
    }
    let total = exige("total")?;
    numerique(&total)?;
    let remise = match cle(e, "remise") {
        Some(r) => {
            genre(&r)?;
            Some(r)
        }
        None => None,
    };
    let avec_taux = match cle(e, "taux") {
        Some(t) => {
            genre(&t)?;
            true
        }
        None => false,
    };
    let total_brut = match cle(e, "total_brut") {
        Some(t) => {
            numerique(&t)?;
            Some(t)
        }
        None => None,
    };
    // Le barème des taux de ligne : la clé `bareme`, sinon celui du groupe de taux de la grille.
    let groupe = grille.preuves.iter().filter_map(|p| p.expression.as_ref()).find(|x| {
        x.get("op").and_then(|o| o.as_str()) == Some("groupe_taux")
            && cle(e, "bareme").is_none_or(|b| x.get("bareme").and_then(|v| v.as_str()) == Some(b.as_str()))
    });
    let bareme = cle(e, "bareme").or_else(|| groupe.and_then(|g| cle(g, "bareme")));
    let base_par_taux = groupe.and_then(|g| cle(g, "base"));
    let total_base = groupe.and_then(|g| cle(g, "total_base"));
    let remise_globale = match cle(e, "remise_globale") {
        Some(r) => {
            numerique(&r)?;
            Some(r)
        }
        None => None,
    };
    let prix_ttc = match cle(e, "prix_ttc") {
        Some(t) => {
            numerique(&t)?;
            Some(t)
        }
        None => None,
    };
    let champs_lignes = ["designation", "quantite", "prix", "prix_ttc", "remise", "montant", "taux"]
        .iter()
        .filter_map(|k| cle(e, k))
        .collect();
    Ok(OpLignes {
        designation,
        montant_total: total,
        total_brut,
        remise,
        remise_globale,
        champs_lignes,
        colonnes,
        bareme,
        base_par_taux,
        total_base,
        avec_taux,
        prix_ttc,
    })
}

/// Un triplet d'une rangée (indices dans la rangée triée de gauche à droite).
#[derive(Clone)]
struct Triplet {
    q: (usize, i64),
    p: (usize, i64),
    m: (usize, i64),
    r: Option<(usize, i64)>,
    /// Le prix est TTC : le code du seul taux du barème qui ferme la rangée (`ferme_ttc`).
    ttc: Option<String>,
}

impl Triplet {
    fn valeurs(&self) -> (i64, i64, i64, i64) {
        (self.q.1, self.p.1, self.m.1, self.r.map_or(0, |x| x.1))
    }
}

/// Les rangées : jetons groupés par bande horizontale, triés de gauche à droite.
/// La pente d'une page sur laquelle les pentes de ses paires de jetons s'accordent le plus.
const PENTE_MAX: f64 = 0.15;
/// La largeur d'une classe de l'histogramme des pentes.
const PAS_DE_PENTE: f64 = 0.002;
/// Le nombre de paires d'accord en deçà duquel la page est tenue pour droite.
const ACCORD_MIN: usize = 6;

/// La pente de chaque page (dy / dx), lue sur ses jetons seuls.
///
/// Une page photographiée ou scannée de travers fait dériver une rangée de plusieurs
/// hauteurs de corps entre sa marge gauche et son montant : le montant ne recouvre plus la
/// référence, et la ligne d'articles se coupe en deux. Deux boîtes d'une même rangée,
/// éloignées en abscisse, donnent la pente de la page ; deux boîtes de deux rangées
/// voisines en donnent une autre, qui varie avec leur écart. Les pentes des vraies paires
/// s'accumulent toutes dans la même classe, celles des fausses s'étalent : la classe la
/// plus peuplée est la pente.
///
/// Le vote se fait par BOÎTE de l'OCR, pas par mot : les mots d'une même boîte (mêmes
/// bords, au bit près) sont horizontaux par construction, et deux longues lignes voisines
/// voteraient autant de fois que le produit de leurs mots.
fn pentes(jetons: &[Jeton]) -> BTreeMap<u32, f64> {
    // les boîtes : les jetons de mêmes bords (au bit près), recousus tant que le blanc qui
    // les sépare tient dans deux hauteurs de corps — les mots d'une boîte de l'OCR. Les
    // cellules d'une même rangée d'un PDF ont aussi les mêmes bords, mais un large blanc les
    // sépare : elles restent des boîtes distinctes, et votent pour une page droite.
    let mut memes_bords: BTreeMap<(u32, u64, u64), Vec<(f64, f64)>> = BTreeMap::new();
    for j in jetons {
        memes_bords.entry((j.page, j.y0.to_bits(), j.y1.to_bits())).or_default().push((j.x0, j.x1));
    }
    let mut par_page: BTreeMap<u32, Vec<(f64, f64, f64, f64)>> = BTreeMap::new();
    for ((page, y0, y1), mut xs) in memes_bords {
        let (y0, y1) = (f64::from_bits(y0), f64::from_bits(y1));
        xs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let boites = par_page.entry(page).or_default();
        let mut courante: Option<(f64, f64)> = None;
        for (x0, x1) in xs {
            courante = match courante {
                Some((a, b)) if x0 - b <= 2.0 * (y1 - y0) => Some((a, b.max(x1))),
                Some((a, b)) => {
                    boites.push((a, y0, b, y1));
                    Some((x0, x1))
                }
                None => Some((x0, x1)),
            };
        }
        if let Some((a, b)) = courante {
            boites.push((a, y0, b, y1));
        }
    }
    let classes = (2.0 * PENTE_MAX / PAS_DE_PENTE).round() as usize + 1;
    par_page
        .into_iter()
        .map(|(page, b)| {
            let mut pentes: Vec<f64> = Vec::new();
            for (n, a) in b.iter().enumerate() {
                for c in &b[n + 1..] {
                    let h = (a.3 - a.1).max(c.3 - c.1);
                    let dx = (c.0 + c.2 - a.0 - a.2) / 2.0;
                    let dy = (c.1 + c.3 - a.1 - a.3) / 2.0;
                    // une paire éloignée, et dont l'écart vertical tient dans une hauteur de corps
                    if dx.abs() < 4.0 * h || dy.abs() > 1.5 * h {
                        continue;
                    }
                    let p = dy / dx;
                    if p.abs() <= PENTE_MAX {
                        pentes.push(p);
                    }
                }
            }
            let mut histo = vec![0usize; classes];
            let classe = |p: f64| ((p + PENTE_MAX) / PAS_DE_PENTE).round() as usize;
            for &p in &pentes {
                histo[classe(p).min(classes - 1)] += 1;
            }
            // la classe la plus peuplée, avec ses deux voisines ; à égalité, la plus proche de zéro
            let accord = |k: usize| histo[k] + if k > 0 { histo[k - 1] } else { 0 } + histo.get(k + 1).copied().unwrap_or(0);
            let pic = (0..classes).max_by_key(|&k| (accord(k), std::cmp::Reverse((k as i64 - (classes / 2) as i64).abs())));
            // Deux rangées voisines d'une page DROITE votent autant pour +p que pour −p : une
            // pente que son miroir égale presque n'est que leur écart, pas une inclinaison.
            let miroir = |k: usize| classes - 1 - k;
            let pente = pic
                .filter(|&k| accord(k) >= ACCORD_MIN && (k.abs_diff(classes / 2) <= 1 || 2 * accord(miroir(k)) <= accord(k)))
                .map_or(0.0, |k| {
                    let mut dans: Vec<f64> = pentes.iter().copied().filter(|&p| classe(p).abs_diff(k) <= 1).collect();
                    dans.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    dans[dans.len() / 2]
                });
            (page, pente)
        })
        .collect()
}

/// Les jetons, leurs ordonnées redressées par la pente de leur page (`pentes`) : une ligne
/// d'articles suit sa page, quelle que soit son inclinaison, sans redresser l'image.
fn redresses(jetons: &[Jeton]) -> Vec<Jeton> {
    let pente = pentes(jetons);
    jetons
        .iter()
        .map(|j| {
            let p = pente.get(&j.page).copied().unwrap_or(0.0);
            let d = p * (j.x0 + j.x1) / 2.0;
            Jeton { y0: j.y0 - d, y1: j.y1 - d, ..j.clone() }
        })
        .collect()
}

/// Les lignes de texte d'une cellule, de haut en bas, chacune dans son ordre de lecture
/// (de droite à gauche pour une ligne arabe) : une rangée qui réunit les deux lignes d'une
/// désignation ne se lit pas en triant ses mots par abscisse.
pub(crate) fn en_lignes(jetons: &[Jeton], ids: &[usize]) -> Vec<Vec<usize>> {
    let mut ordre = ids.to_vec();
    ordre.sort_by(|&a, &b| jetons[a].y0.partial_cmp(&jetons[b].y0).unwrap_or(std::cmp::Ordering::Equal));
    let mut lignes: Vec<Vec<usize>> = Vec::new();
    for i in ordre {
        let j = &jetons[i];
        let place = lignes.iter().rposition(|l| {
            let a = &jetons[l[0]];
            let h = (a.y1 - a.y0).min(j.y1 - j.y0).max(f64::EPSILON);
            (a.y1.min(j.y1) - a.y0.max(j.y0)) > 0.5 * h
        });
        match place {
            Some(k) => lignes[k].push(i),
            None => lignes.push(vec![i]),
        }
    }
    for l in &mut lignes {
        l.sort_by(|&a, &b| jetons[a].x0.partial_cmp(&jetons[b].x0).unwrap_or(std::cmp::Ordering::Equal));
        // une ligne écrite de droite à gauche se lit depuis sa droite
        if l.iter().any(|&k| crate::reperes::droite_a_gauche(&jetons[k].texte)) {
            l.reverse();
        }
    }
    lignes
}

/// Les rangées des lignes d'articles, sur des jetons redressés : les classes de la
/// relation « se recouvrent de plus de la moitié de la plus petite hauteur », de proche en
/// proche. Une cellule dont le texte tient sur deux lignes et dont les chiffres sont
/// centrés entre elles est UNE rangée : ses chiffres recouvrent l'une et l'autre ligne, et
/// aucun jeton n'en est l'ancre — l'ordre de lecture n'y change rien.
fn rangees(droits: &[Jeton]) -> Vec<Vec<usize>> {
    let n = droits.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn racine(p: &mut [usize], mut i: usize) -> usize {
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    for a in 0..n {
        for b in a + 1..n {
            let (ja, jb) = (&droits[a], &droits[b]);
            let h = (ja.y1 - ja.y0).min(jb.y1 - jb.y0).max(f64::EPSILON);
            if ja.page == jb.page && (ja.y1.min(jb.y1) - ja.y0.max(jb.y0)) > 0.5 * h {
                let (ra, rb) = (racine(&mut parent, a), racine(&mut parent, b));
                if ra != rb {
                    parent[ra.max(rb)] = ra.min(rb);
                }
            }
        }
    }
    let mut classes: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..n {
        let r = racine(&mut parent, i);
        classes.entry(r).or_default().push(i);
    }
    let mut rangs: Vec<Vec<usize>> = classes.into_values().collect();
    let haut = |r: &Vec<usize>| (droits[r[0]].page, r.iter().map(|&i| droits[i].y0).fold(f64::MAX, f64::min));
    rangs.sort_by(|a, b| {
        let (pa, ya) = haut(a);
        let (pb, yb) = haut(b);
        pa.cmp(&pb).then(ya.partial_cmp(&yb).unwrap_or(std::cmp::Ordering::Equal))
    });
    for r in &mut rangs {
        r.sort_by(|&a, &b| droits[a].x0.partial_cmp(&droits[b].x0).unwrap_or(std::cmp::Ordering::Equal));
    }
    rangs
}

/// Les rangées, un jeton rejoignant la bande dont le premier jeton le recouvre de plus de
/// la moitié de `hauteur(h_premier, h_jeton)` : `f64::min` pour les lignes d'articles,
/// `f64::max` pour l'en-tête (un grand titre ne fusionne pas deux lignes de texte).
pub(crate) fn rangees_selon(jetons: &[Jeton], hauteur: fn(f64, f64) -> f64) -> Vec<Vec<usize>> {
    let mut ordre: Vec<usize> = (0..jetons.len()).collect();
    ordre.sort_by(|&a, &b| {
        let (ja, jb) = (&jetons[a], &jetons[b]);
        ja.page
            .cmp(&jb.page)
            .then(ja.y0.partial_cmp(&jb.y0).unwrap_or(std::cmp::Ordering::Equal))
            .then(ja.x0.partial_cmp(&jb.x0).unwrap_or(std::cmp::Ordering::Equal))
    });
    let mut rangs: Vec<Vec<usize>> = Vec::new();
    for i in ordre {
        let j = &jetons[i];
        let hj = (j.y1 - j.y0).max(f64::EPSILON);
        // l'ancre d'une rangée est son premier jeton
        let place = rangs.iter().rposition(|r| {
            let a = &jetons[r[0]];
            let ha = (a.y1 - a.y0).max(f64::EPSILON);
            a.page == j.page && (a.y1.min(j.y1) - a.y0.max(j.y0)) > 0.5 * hauteur(ha, hj)
        });
        match place {
            Some(k) => rangs[k].push(i),
            None => rangs.push(vec![i]),
        }
    }
    for r in &mut rangs {
        r.sort_by(|&a, &b| jetons[a].x0.partial_cmp(&jetons[b].x0).unwrap_or(std::cmp::Ordering::Equal));
    }
    rangs
}

struct Contexte<'a> {
    jetons: &'a [Jeton],
    tol: i64,
    /// 10^décimales du pack.
    unite: i128,
    pourcent: Regex,
    bareme: Vec<(String, i64)>,
    /// La grille déclare des prix TTC (`prix_ttc`).
    prix_ttc: bool,
}

impl Contexte<'_> {
    /// Le jeton est-il marqué « % » (sur lui-même, ou au début du jeton suivant de la rangée) ?
    fn marque_pourcent(&self, rang: &[usize], k: usize) -> bool {
        self.jetons[rang[k]].texte.contains('%')
            || rang.get(k + 1).is_some_and(|&n| self.jetons[n].texte.trim_start().starts_with('%'))
    }

    /// Les pourcentages lus sur un jeton, en unités mineures du pourcentage (« 10 % » → 10 × 10^déc).
    /// Un jeton sans lecture de montant (« 19% ») est lu par son seul motif de pourcentage.
    fn pourcentages(&self, j: &Jeton) -> Vec<i64> {
        if !j.montants.is_empty() {
            return j.montants.iter().map(|l| l.v).collect();
        }
        let t: String = j.texte.chars().filter(|c| !c.is_whitespace()).collect();
        let Some(c) = self.pourcent.captures(&t) else { return Vec::new() };
        let ent = c.name("e").or_else(|| c.name("e2")).map(|m| m.as_str()).unwrap_or("");
        let dec = c.name("d").map(|m| m.as_str()).unwrap_or("");
        let Ok(e) = ent.parse::<i128>() else { return Vec::new() };
        let mut v = e * self.unite;
        if !dec.is_empty() {
            let Ok(d) = dec.parse::<i128>() else { return Vec::new() };
            let echelle = 10i128.pow(dec.len() as u32);
            if self.unite % echelle != 0 {
                return Vec::new();
            }
            v += d * (self.unite / echelle);
        }
        i64::try_from(v).map(|x| vec![x]).unwrap_or_default()
    }

    /// Le code du barème dont le taux vaut ce pourcentage, s'il y en a un.
    fn taux_de(&self, v: i64) -> Option<&str> {
        // ppm = v × 10^6 / (100 × 10^déc), exactement
        let num = v as i128 * PPM;
        let den = CENT * self.unite;
        if num % den != 0 {
            return None;
        }
        let ppm = num / den;
        self.bareme.iter().find(|(_, t)| *t as i128 == ppm).map(|(c, _)| c.as_str())
    }

    fn ferme(&self, q: i64, p: i64, m: i64, r: i64) -> bool {
        let cent = CENT * self.unite;
        if r < 0 || r as i128 >= cent {
            return false;
        }
        let attendu = div_arrondi(q as i128 * p as i128 * (cent - r as i128), self.unite * cent);
        (attendu - m as i128).abs() <= self.tol as i128
    }

    /// Le prix TTC : m = arrondi(q × p × (1 − r) ÷ (1 + t)) pour un taux t du barème, à la
    /// tolérance du pack près. Rend le code du taux, s'il est le SEUL à fermer — et, quand la
    /// rangée imprime son taux (`imprime`), seulement ce taux-là : un prix TTC fermé à 7 % sur
    /// une ligne imprimée à 19 % n'est pas une lecture. Le taux nul n'en est pas un (le
    /// barème ne le porte pas) : un prix sans taxe est un prix HT, que `ferme` lit déjà.
    fn ferme_ttc(&self, q: i64, p: i64, m: i64, r: i64, imprime: Option<&str>) -> Option<String> {
        let cent = CENT * self.unite;
        if !self.prix_ttc || r < 0 || r as i128 >= cent {
            return None;
        }
        let ferment: Vec<&String> = self
            .bareme
            .iter()
            .filter(|(code, _)| imprime.is_none_or(|i| i == code))
            .filter(|(_, t)| {
                let attendu = div_arrondi(
                    q as i128 * p as i128 * (cent - r as i128) * PPM,
                    self.unite * cent * (PPM + *t as i128),
                );
                (attendu - m as i128).abs() <= self.tol as i128
            })
            .map(|(code, _)| code)
            .collect();
        match ferment.as_slice() {
            [un] => Some((*un).clone()),
            _ => None,
        }
    }

    /// Les triplets d'une rangée, dédoublonnés par valeurs (q, p, m, r) : à valeurs
    /// égales, on garde les jetons les plus à droite (la colonne, pas la désignation).
    /// `avec_ttc` : la rangée peut aussi fermer par un prix TTC (la stratégie de toujours
    /// seulement : la lecture du milieu déduit par m / p, qui suppose un prix HT).
    fn triplets(&self, rang: &[usize], avec_ttc: bool) -> Vec<Triplet> {
        // q et m peuvent être négatifs (une reprise : « -20 × 1,500 = -30,000 ») ; p est positif.
        let lectures = |k: usize, prix: bool| -> Vec<i64> {
            let mut v: Vec<i64> = self.jetons[rang[k]]
                .montants
                .iter()
                .filter(|l| if prix { l.forte && l.v > 0 } else { l.v != 0 })
                .map(|l| l.v)
                .collect();
            v.sort();
            v.dedup();
            v
        };
        let remises: Vec<(usize, i64)> = (0..rang.len())
            .filter(|&k| self.marque_pourcent(rang, k))
            .flat_map(|k| self.pourcentages(&self.jetons[rang[k]]).into_iter().filter(|v| *v > 0).map(move |v| (k, v)))
            .collect();
        let mut par_valeurs: BTreeMap<(i64, i64, i64, i64), Triplet> = BTreeMap::new();
        let n = rang.len();
        let fortes = |k: usize| -> Vec<i64> {
            let mut v: Vec<i64> =
                self.jetons[rang[k]].montants.iter().filter(|l| l.forte && l.v != 0).map(|l| l.v).collect();
            v.sort();
            v.dedup();
            v
        };
        for qi in 0..n {
            for q in lectures(qi, false) {
                for pi in qi + 1..n {
                    for p in lectures(pi, true) {
                        for mi in pi + 1..n {
                            for m in fortes(mi) {
                                let mut candidats: Vec<Option<(usize, i64)>> = vec![None];
                                candidats.extend(
                                    remises.iter().filter(|(k, _)| *k != qi && *k != pi && *k != mi).map(|x| Some(*x)),
                                );
                                for r in candidats {
                                    let rv = r.map_or(0, |x| x.1);
                                    let ttc = if self.ferme(q, p, m, rv) {
                                        None
                                    } else if avec_ttc {
                                        // Le taux imprimé sur la rangée, hors des trois cellules.
                                        let pris = [Some(qi), Some(pi), Some(mi), r.map(|x| x.0)];
                                        let imprime = self.taux_parmi(
                                            rang.iter()
                                                .enumerate()
                                                .filter(|(k, _)| !pris.contains(&Some(*k)))
                                                .map(|(_, &jk)| jk),
                                        );
                                        match self.ferme_ttc(q, p, m, rv, imprime.as_ref().map(|t| t.code.as_str())) {
                                            Some(code) => Some(code),
                                            None => continue,
                                        }
                                    } else {
                                        continue;
                                    };
                                    let t = Triplet { q: (qi, q), p: (pi, p), m: (mi, m), r, ttc };
                                    let cle = t.valeurs();
                                    let garder = match par_valeurs.get(&cle) {
                                        None => true,
                                        Some(x) => (t.m.0, t.q.0, t.p.0) > (x.m.0, x.q.0, x.p.0),
                                    };
                                    if garder {
                                        par_valeurs.insert(cle, t);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        par_valeurs.into_values().collect()
    }

    /// La désignation : les jetons donnés, ligne par ligne, cités.
    /// `ancre` est la cellule chiffrée de la ligne (sa quantité) : la ligne de texte qui la
    /// recouvre le plus est la ligne principale ; d'une autre ligne, seuls les mots qui se
    /// tiennent dans son étendue en sont la suite — un bloc posé à côté du tableau
    /// (« MATRICULE FISCAL ») que la rangée a recouvert n'en est pas.
    fn designation(&self, jetons: &[usize], ancre: Option<usize>) -> Cite {
        let lignes = en_lignes(self.jetons, jetons);
        let recouvre = |l: &Vec<usize>, a: &Jeton| {
            l.iter().map(|&k| (self.jetons[k].y1.min(a.y1) - self.jetons[k].y0.max(a.y0)).max(0.0)).fold(0.0, f64::max)
        };
        let principale = ancre.and_then(|a| {
            let a = &self.jetons[a];
            (0..lignes.len()).max_by(|&x, &y| {
                recouvre(&lignes[x], a).partial_cmp(&recouvre(&lignes[y], a)).unwrap_or(std::cmp::Ordering::Equal)
            })
        });
        let ordre: Vec<usize> = match principale {
            Some(m) => {
                // l'étendue de la ligne principale, élargie d'un blanc entre deux mots
                let h = lignes[m].iter().map(|&k| self.jetons[k].y1 - self.jetons[k].y0).fold(0.0, f64::max);
                let x0 = lignes[m].iter().map(|&k| self.jetons[k].x0).fold(f64::MAX, f64::min) - 2.0 * h;
                let x1 = lignes[m].iter().map(|&k| self.jetons[k].x1).fold(f64::MIN, f64::max) + 2.0 * h;
                lignes
                    .iter()
                    .enumerate()
                    .flat_map(|(i, l)| {
                        l.iter().copied().filter(move |&k| i == m || self.jetons[k].x1 > x0 && self.jetons[k].x0 < x1)
                    })
                    .collect()
            }
            None => lignes.into_iter().flatten().collect(),
        };
        Cite::lue(
            ordre.iter().map(|&k| self.jetons[k].texte.trim()).collect::<Vec<_>>().join(" "),
            ordre.iter().map(|&k| self.cite(k)).collect(),
        )
    }

    /// Le taux d'une rangée : parmi ces jetons, ceux qui valent un taux du barème ;
    /// plusieurs taux distincts ou aucun → absent.
    fn taux_parmi(&self, jetons: impl Iterator<Item = usize>) -> Option<TauxCite> {
        let mut trouves: Vec<(String, usize)> = Vec::new();
        for jk in jetons {
            for v in self.pourcentages(&self.jetons[jk]) {
                if let Some(c) = self.taux_de(v) {
                    trouves.push((c.to_string(), jk));
                }
            }
        }
        let mut codes: Vec<&String> = trouves.iter().map(|(c, _)| c).collect();
        codes.sort();
        codes.dedup();
        if codes.len() == 1 {
            let code = codes[0].clone();
            let refs = trouves.iter().filter(|(c, _)| *c == code).map(|(_, k)| self.cite(*k)).collect();
            Some(TauxCite { code, refs })
        } else {
            None
        }
    }

    fn cite(&self, k: usize) -> RefJeton {
        let j = &self.jetons[k];
        RefJeton { page: j.page, ordinal: j.ordinal }
    }

    fn sortie(&self, rang: &[usize], t: &Triplet, avec_taux: bool) -> LigneSortie {
        let gauche: Vec<usize> = rang[..t.q.0].to_vec();
        let designation = if gauche.is_empty() {
            None
        } else {
            Some(self.designation(&gauche, Some(rang[t.q.0])))
        };
        let un = |(k, v): (usize, i64)| Cite::lue(v.to_string(), vec![self.cite(rang[k])]);
        // Le taux : un jeton de la rangée, à droite de la quantité, hors q, p, m et remise.
        let taux = if avec_taux {
            let pris = [Some(t.q.0), Some(t.p.0), Some(t.m.0), t.r.map(|x| x.0)];
            self.taux_parmi(
                rang.iter().enumerate().skip(t.q.0 + 1).filter(|(k, _)| !pris.contains(&Some(*k))).map(|(_, &jk)| jk),
            )
        } else {
            None
        };
        LigneSortie {
            designation,
            quantite: un(t.q),
            prix: un(t.p),
            remise: t.r.map(un),
            montant: un(t.m),
            taux,
            prix_ttc: t.ttc.is_some(),
        }
    }
}

/// La valeur prouvée d'un champ scalaire au centre.
fn prouvee(champs: &BTreeMap<String, ChampSortie>, code: &str) -> Option<i64> {
    champs.get(code).filter(|c| c.statut == "prouve").and_then(|c| c.valeur.as_ref()).and_then(|v| v.parse().ok())
}

/// Prouve les lignes. Rend la sortie `lignes` et le statut de la preuve.
pub fn prouver(op: &OpLignes, entree: &Entree, champs: &BTreeMap<String, ChampSortie>) -> (LignesSortie, &'static str) {
    let pack = &entree.pack;
    let ctx = Contexte {
        jetons: &entree.jetons,
        tol: pack.tolerance,
        unite: 10i128.pow(pack.decimales),
        pourcent: Regex::new(r"^\(?(?:(?P<e>\d+)(?:[.,](?P<d>\d+))?%|%(?P<e2>\d+))\)?[.,;]?$").expect("motif"),
        bareme: op
            .bareme
            .as_ref()
            .and_then(|b| pack.baremes.get(b))
            .map(|v| v.iter().filter(|t| t.ppm > 0).map(|t| (t.code.clone(), t.ppm)).collect())
            .unwrap_or_default(),
        prix_ttc: op.prix_ttc.is_some(),
    };
    let vide = |statut: &str| LignesSortie {
        statut: statut.into(),
        instances: Vec::new(),
        taux_par_base: "non_evaluable".into(),
        deduites: None,
        remise_globale: None,
    };

    let droits = redresses(&entree.jetons);
    let rangs = rangees(&droits);
    let candidates: Vec<(usize, Vec<Triplet>)> =
        rangs.iter().enumerate().map(|(i, r)| (i, ctx.triplets(r, true))).filter(|(_, t)| !t.is_empty()).collect();
    let cibles: Vec<i64> =
        [Some(op.montant_total.as_str()), op.total_brut.as_deref()].into_iter().flatten().filter_map(|c| prouvee(champs, c)).collect();
    let lu = if candidates.is_empty() {
        // aucune rangée q × p = m : seule une graine ancrée par l'en-tête peut lire le tableau
        let r = if cibles.is_empty() { None } else { milieu::prouver(&ctx, op, &entree.grille, &rangs, &cibles) };
        match r {
            Some(r) => r,
            None => return (vide("absent"), "non_evaluable"),
        }
    } else if cibles.is_empty() {
        return (vide("signale"), "non_evaluable");
    } else {
        match toujours(&ctx, op, &rangs, candidates, &cibles) {
            Ok(instances) => milieu::Lu { instances, deduites: 0, remise_globale: None },
            // la stratégie de toujours ne prouve pas : la lecture du milieu, sinon son verdict
            Err(st) => match milieu::prouver(&ctx, op, &entree.grille, &rangs, &cibles) {
                Some(r) => r,
                None => return (vide("signale"), st),
            },
        }
    };
    let milieu::Lu { mut instances, deduites, remise_globale } = lu;
    colonnes::affiner(&mut instances, &droits, &rangs, &entree.grille, &op.designation);
    // Les chiffres d'une ligne sont prouvés par le calcul ; sa désignation ne l'est par
    // rien. Un mot que l'OCR lit sans assurance (« كاء » pour « كراء ») ferait une
    // désignation fausse : elle est tue, la ligne reste.
    // Un mot que l'OCR a pu mal lire (le lexique de l'adaptateur) fait taire la désignation
    // aussi : « Transport de matérel », « 12 chifres ».
    let seuil = pack.confiance_du_texte;
    let incertains: BTreeSet<(u32, u32)> = entree
        .jetons
        .iter()
        .filter(|j| j.douteux || seuil.is_some_and(|s| j.confiance.is_some_and(|c| c < s)))
        .map(|j| (j.page, j.ordinal))
        .collect();
    for l in instances.iter_mut() {
        if l.designation.as_ref().is_some_and(|d| d.refs.iter().any(|r| incertains.contains(&(r.page, r.ordinal)))) {
            l.designation = None;
        }
    }
    let nuls = op.bareme.as_ref().and_then(|b| pack.taux_nuls.get(b)).map(Vec::as_slice).unwrap_or_default();
    let taux_par_base = verifier_taux(op, champs, nuls, &mut instances);
    let sortie = LignesSortie {
        statut: "prouve".into(),
        instances,
        taux_par_base: taux_par_base.into(),
        deduites: (deduites > 0).then_some(deduites),
        remise_globale,
    };
    (sortie, "verifiee")
}

/// La stratégie de toujours : toutes les rangées candidates sont des lignes. Rend les
/// lignes, ou le statut de la preuve quand elles ne ferment pas.
fn toujours(
    ctx: &Contexte,
    op: &OpLignes,
    rangs: &[Vec<usize>],
    candidates: Vec<(usize, Vec<Triplet>)>,
    cibles: &[i64],
) -> Result<Vec<LigneSortie>, &'static str> {

    // Toutes les rangées candidates sont des lignes : une combinaison de leurs triplets
    // dont la somme des montants vaut exactement un total prouvé.
    let mut fermantes: Vec<Vec<usize>> = Vec::new();
    let mut explorees: u64 = 0;
    let mut depasse = false;
    let mut choix: Vec<usize> = Vec::with_capacity(candidates.len());
    fn chercher(
        c: &[(usize, Vec<Triplet>)],
        cibles: &[i64],
        somme: i64,
        choix: &mut Vec<usize>,
        out: &mut Vec<Vec<usize>>,
        explorees: &mut u64,
        depasse: &mut bool,
    ) {
        if *depasse || out.len() > 1 {
            return;
        }
        *explorees += 1;
        if *explorees > PLAFOND_COMBINAISONS {
            *depasse = true;
            return;
        }
        let k = choix.len();
        if k == c.len() {
            if cibles.contains(&somme) {
                out.push(choix.clone());
            }
            return;
        }
        for (i, t) in c[k].1.iter().enumerate() {
            choix.push(i);
            chercher(c, cibles, somme + t.m.1, choix, out, explorees, depasse);
            choix.pop();
        }
    }
    chercher(&candidates, cibles, 0, &mut choix, &mut fermantes, &mut explorees, &mut depasse);
    if depasse {
        return Err("non_evaluable");
    }
    match fermantes.len() {
        0 => return Err("echec"),
        1 => {}
        _ => return Err("indeterminee"),
    }
    Ok(candidates.iter().zip(&fermantes[0]).map(|((ri, ts), &i)| ctx.sortie(&rangs[*ri], &ts[i], op.avec_taux)).collect())
}

/// Σ montants des lignes par taux = base de ce taux au centre, quand c'est évaluable :
/// `verifiee`, `echec` (les taux lus sont alors retirés des lignes) ou `non_evaluable`.
/// La part exonérée d'une exonération partielle (une base au centre sous un taux nul,
/// `nuls`) vaut la somme des lignes sans taux.
fn verifier_taux(
    op: &OpLignes,
    champs: &BTreeMap<String, ChampSortie>,
    nuls: &[String],
    instances: &mut [LigneSortie],
) -> &'static str {
    let mut taux_par_base = "non_evaluable";
    // Une base seulement déduite (non imprimée) n'est connue que pour un taux unique : c'est
    // alors le total des bases du groupe, prouvé au centre.
    let bases: Option<BTreeMap<String, i64>> = op.base_par_taux.as_ref().and_then(|b| champs.get(b)).and_then(|c| {
        if c.statut != "prouve" {
            return None;
        }
        let inst = c.instances.as_ref()?;
        let deduite = match inst.as_slice() {
            [_] => op.total_base.as_deref().and_then(|t| prouvee(champs, t)),
            _ => None,
        };
        if inst.is_empty() {
            return None;
        }
        inst.iter()
            .map(|i| Some((i.taux.clone(), i.valeur.as_ref().and_then(|v| v.parse::<i64>().ok()).or(deduite)?)))
            .collect()
    });
    if let Some(bases) = bases {
        if instances.iter().any(|l| l.taux.is_some()) {
            let mut sommes: BTreeMap<String, i64> = BTreeMap::new();
            let exoneree = bases.keys().find(|c| nuls.contains(c));
            for l in instances.iter() {
                let code = match (&l.taux, exoneree) {
                    (Some(t), _) => &t.code,
                    (None, Some(c)) => c,
                    (None, None) => continue,
                };
                *sommes.entry(code.clone()).or_default() += l.montant.valeur.parse::<i64>().unwrap_or_default();
            }
            if sommes == bases {
                taux_par_base = "verifiee";
            } else {
                taux_par_base = "echec";
                for l in instances.iter_mut() {
                    l.taux = None;
                }
            }
        }
    }
    taux_par_base
}
