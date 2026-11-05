//! L'anneau 1 lu du milieu vers les bords (« middle-out ») : du plus sûr vers l'incertain.
//!
//! N'intervient que lorsque la stratégie de toujours ne prouve pas les lignes — le plus
//! souvent parce que l'OCR n'a pas vu un petit nombre isolé (la quantité « 1 » seule
//! dans sa colonne), et que la rangée n'a plus que son prix et son montant.
//!
//! 1. La graine : une rangée où q × p (− remise) = m, prix et montant lus en lecture
//!    forte, les trois jetons dans l'ordre des colonnes ; s'il y en a plusieurs, on part
//!    de celle du milieu du bloc, et TOUTES doivent conduire au même tableau. Quand
//!    AUCUNE rangée de la page n'a ses trois cellules lues, la graine peut être ancrée par
//!    l'en-tête : un en-tête qui porte les étiquettes des trois colonnes (repères de la
//!    grille), une rangée dont le prix et le montant sont lus sous leurs étiquettes, m / p
//!    entier strictement positif (la quantité est déduite). Sans étiquettes, pas de graine.
//! 2. La règle du tableau, apprise de la graine : les intervalles horizontaux des colonnes
//!    quantité, prix et montant (élargis d'au plus une largeur de cellule ou une hauteur
//!    de rangée, jamais au-delà de la moitié de l'écart à la colonne voisine), le pas
//!    vertical, le sens de lecture (montant à gauche du prix : de droite à gauche).
//! 3. L'expansion, une rangée à la fois vers le haut puis vers le bas : chaque jeton
//!    chiffré va à la colonne qui le contient ; un nombre hors des colonnes (dans la
//!    désignation) est ignoré. Trois cellules lues qui ferment : la rangée est lue, et
//!    affine la règle. Une seule cellule absente : la quantité (m / p) ou le prix (m / q)
//!    se déduit s'il est EXACT ; le montant ne se déduit que pour une seule rangée de
//!    tout le tableau, par l'écart au total. Une case collée (« 1 » et « 2400,000 » lus
//!    « 12400,000 ») se sépare par une coupe FOURNIE par l'adaptateur, si la géométrie la
//!    place à cheval sur les colonnes quantité et prix et que gauche × droite = montant.
//!    Une rangée qui ne porte qu'un montant est un report (« À reporter », sous-total) :
//!    elle doit valoir la somme courante. Une rangée sans nombre dans les colonnes de
//!    prix et de montant est du texte ; toute autre rangée inexpliquée bloque.
//!    En haut, l'expansion s'arrête à l'en-tête ; en bas, à la première rangée qui porte
//!    un repère d'un champ du centre (lus dans la grille, jamais en dur), après plus de
//!    `LIMITE_PAS` pas de texte, ou au bas de la page — le tableau reprend alors sur la
//!    page suivante, dont les colonnes sont réapprises par sa propre graine.
//! 4. La fermeture : Σ montants = total prouvé au centre, EXACTEMENT, par une seule
//!    affectation de valeurs — ou Σ − remise globale = total HT, la remise étant un
//!    montant fort (ou un taux) ancré par un repère du champ de la remise globale dans le
//!    bloc des totaux, et un total brut lu valant Σ. Sinon : rien (lignes signalées).
//!
//! Une cellule déduite ne cite aucun jeton (`refs` vide, `statut` « deduit ») ; elle dit
//! où elle devrait être imprimée (`case`), pour une relecture ciblée. Un tableau à remise
//! (repère de la remise de ligne dans l'en-tête, ou une remise lue sur une rangée) ne
//! déduit rien : une remise que l'OCR aurait perdue fausserait la quantité déduite.

use super::{Case, Cite, Contexte, LigneSortie, OpLignes, Triplet, PLAFOND_COMBINAISONS};
use crate::entree::{Grille, Jeton};
use crate::reperes::{normaliser, reperes_de};
use crate::valeurs::{div_arrondi, PPM};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

/// Au-delà de ce nombre de pas sans rangée chiffrée, le tableau est fini.
const LIMITE_PAS: f64 = 3.0;
/// Le pas par défaut, tant qu'une seule rangée est chiffrée : deux hauteurs de rangée.
const PAS_EN_HAUTEURS: f64 = 2.0;
/// Plafond des enchaînements de pages explorés ; au-delà, les lignes restent signalées.
const PLAFOND_ENCHAINEMENTS: usize = 64;
/// Un pourcentage s'exprime sur cent : l'unité du symbole « % », pas un taux.
const CENT: i128 = 100;

/// Les trois colonnes, dans l'ordre de la règle.
const Q: usize = 0;
const P: usize = 1;
const M: usize = 2;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Cellule {
    /// Lue sur le jeton (indice dans le plan).
    Lue(usize, i64),
    Deduite(i64),
    /// Une part d'une case collée : (jeton, valeur, coupe).
    Coupe(usize, i64, usize),
    /// Absente ou illisible, et que rien ne prouve : tue (une rangée partielle).
    Inconnue,
}

impl Cellule {
    fn v(&self) -> i64 {
        match self {
            Cellule::Lue(_, v) | Cellule::Deduite(v) | Cellule::Coupe(_, v, _) => *v,
            // jamais une valeur lue : une quantité lue n'est pas nulle, un prix est positif
            Cellule::Inconnue => 0,
        }
    }
    fn deduite(&self) -> bool {
        matches!(self, Cellule::Deduite(_))
    }
    fn jeton(&self) -> Option<usize> {
        match self {
            Cellule::Lue(k, _) | Cellule::Coupe(k, _, _) => Some(*k),
            Cellule::Deduite(_) | Cellule::Inconnue => None,
        }
    }
}

/// Une explication d'une rangée.
#[derive(Clone)]
struct Choix {
    q: Cellule,
    p: Cellule,
    m: Cellule,
    /// La remise lue : (jeton, valeur).
    r: Option<(usize, i64)>,
    /// Le prix est TTC : le code du taux qui ferme la rangée (`Contexte::fermeture`).
    ttc: Option<String>,
}

impl Choix {
    fn valeurs(&self) -> (i64, i64, i64, i64) {
        (self.q.v(), self.p.v(), self.m.v(), self.r.map_or(0, |x| x.1))
    }
}

struct Colonne {
    /// Le cœur : l'étendue des cellules lues de la colonne.
    x0: f64,
    x1: f64,
    marge_g: f64,
    marge_d: f64,
}

impl Colonne {
    fn contient(&self, x: f64) -> bool {
        x >= self.x0 - self.marge_g && x <= self.x1 + self.marge_d
    }
    /// La boîte [x0, x1] touche-t-elle l'intervalle élargi de la colonne ?
    fn touche(&self, x0: f64, x1: f64) -> bool {
        x0 <= self.x1 + self.marge_d && x1 >= self.x0 - self.marge_g
    }
    fn centre(&self) -> f64 {
        (self.x0 + self.x1) / 2.0
    }
    fn affiner(&mut self, j: &Jeton) {
        self.x0 = self.x0.min(j.x0);
        self.x1 = self.x1.max(j.x1);
    }
}

/// La règle du tableau, apprise de la graine et affinée par les rangées lues.
struct Regle {
    page: u32,
    cols: [Colonne; 3],
    /// Les centres verticaux des rangées chiffrées, pour le pas.
    centres: Vec<f64>,
    hauteur: f64,
}

impl Regle {
    fn pas(&self) -> f64 {
        let mut c = self.centres.clone();
        c.sort_by(f64::total_cmp);
        let mut d: Vec<f64> = c.windows(2).map(|w| w[1] - w[0]).filter(|x| *x > 0.0).collect();
        if d.is_empty() {
            return PAS_EN_HAUTEURS * self.hauteur;
        }
        d.sort_by(f64::total_cmp);
        d[d.len() / 2]
    }

    /// La colonne d'une abscisse : celle qui la contient (la plus proche s'il y en a deux).
    fn colonne_x(&self, x: f64) -> Option<usize> {
        (0..3).filter(|&k| self.cols[k].contient(x)).min_by(|&a, &b| {
            (self.cols[a].centre() - x).abs().total_cmp(&(self.cols[b].centre() - x).abs())
        })
    }

    /// La colonne d'un jeton : celle de son centre.
    fn colonne(&self, j: &Jeton) -> Option<usize> {
        self.colonne_x((j.x0 + j.x1) / 2.0)
    }
}

/// Ce qu'est une rangée pour la règle.
enum Classe {
    /// Aucun nombre dans les colonnes.
    Vide,
    /// Aucun nombre dans les colonnes de prix et de montant : du texte.
    Texte,
    Expliquee(Vec<Choix>),
    /// Quantité et prix lus, montant absent : les montants possibles, à déduire par la somme.
    SansMontant(Vec<Choix>),
    /// Un montant seul : un report, qui doit valoir la somme courante.
    Report(Vec<(usize, i64)>),
    Bloque,
}

/// Une graine : sa rangée, les boîtes horizontales de ses trois colonnes (q, p, m), son
/// explication et le centre vertical de son montant.
struct Graine {
    s: usize,
    boites: [(f64, f64); 3],
    page: u32,
    hauteur: f64,
    y: f64,
    choix: Choix,
}

/// Une rangée du tableau : une ligne expliquée, ou un report (`choix` vide).
struct Ligne {
    rang: usize,
    choix: Vec<Choix>,
    /// Les lectures du montant d'un report.
    report: Vec<(usize, i64)>,
    /// La règle de la page de la rangée.
    regle: Option<Rc<Regle>>,
}

impl Ligne {
    fn est_report(&self) -> bool {
        self.choix.is_empty()
    }
}

/// Les rangées d'une page, lues d'une graine.
struct Segment {
    lignes: Vec<Ligne>,
    /// Le bas du segment est un repère du centre (le tableau est fini sur cette page).
    clos: bool,
}

/// Ce que la lecture du milieu rend quand elle prouve.
pub(super) struct Lu {
    pub instances: Vec<LigneSortie>,
    pub deduites: usize,
    pub remise_globale: Option<Cite>,
}

/// La remise globale possible d'un tableau, lue dans son bloc des totaux.
#[derive(Default)]
struct RemiseGlobale {
    /// Les montants forts des rangées qui portent un repère de la remise globale (valeur absolue).
    montants: Vec<(usize, i64)>,
    /// Les taux lus sur ces rangées (unités mineures du pourcentage).
    taux: Vec<(usize, i64)>,
    /// Les montants des rangées qui portent un repère du total brut.
    bruts: Vec<i64>,
}

impl RemiseGlobale {
    /// La remise qui mène de Σ à une cible, et le jeton qui la porte.
    fn explique(&self, somme: i64, cibles: &[i64], unite: i128) -> Option<(i64, usize)> {
        if !self.bruts.is_empty() && !self.bruts.contains(&somme) {
            return None;
        }
        cibles.iter().find_map(|&c| {
            let d = somme.checked_sub(c).filter(|d| *d > 0)?;
            self.montants
                .iter()
                .find(|(_, v)| *v == d)
                .or_else(|| self.taux.iter().find(|(_, r)| div_arrondi(somme as i128 * *r as i128, CENT * unite) == d as i128))
                .map(|(k, _)| (d, *k))
        })
    }
}

struct Lecture<'a> {
    ctx: &'a Contexte<'a>,
    rangs: &'a [Vec<usize>],
    /// Les repères des champs du centre : une rangée qui en porte un clôt le tableau.
    arret: Vec<String>,
    /// Les repères de la remise de ligne.
    remise: Vec<String>,
    /// Les repères des trois colonnes (quantité, prix, montant) : l'en-tête qui les porte
    /// dit où sont les colonnes.
    etiquettes: [Vec<String>; 3],
    /// Les repères de la remise globale et du total brut.
    remise_globale: Vec<String>,
    brut: Vec<String>,
}

fn centre_y(j: &Jeton) -> f64 {
    (j.y0 + j.y1) / 2.0
}

impl Lecture<'_> {
    fn jeton(&self, k: usize) -> &Jeton {
        &self.ctx.jetons[k]
    }

    fn page(&self, i: usize) -> u32 {
        self.jeton(self.rangs[i][0]).page
    }

    fn texte(&self, rang: &[usize]) -> String {
        rang.iter().map(|&k| normaliser(&self.jeton(k).texte)).collect()
    }

    fn porte(&self, rang: &[usize], reperes: &[String]) -> bool {
        let t = self.texte(rang);
        reperes.iter().any(|r| t.contains(r.as_str()))
    }

    /// Les étendues horizontales où un repère est lu sur la rangée (un repère peut
    /// couvrir plusieurs jetons : « P.U. » « HT »).
    fn etendues(&self, rang: &[usize], reperes: &[String]) -> Vec<(f64, f64)> {
        let mut texte = String::new();
        let mut de: Vec<usize> = Vec::new();
        for &k in rang {
            let n = normaliser(&self.jeton(k).texte);
            de.extend(std::iter::repeat_n(k, n.len()));
            texte.push_str(&n);
        }
        let mut out = Vec::new();
        for r in reperes {
            for (i, _) in texte.match_indices(r.as_str()) {
                let (a, b) = (de[i], de[i + r.len() - 1]);
                out.push((self.jeton(a).x0.min(self.jeton(b).x0), self.jeton(a).x1.max(self.jeton(b).x1)));
            }
        }
        out
    }

    /// Les colonnes de la règle sont-elles sous leurs étiquettes, quand l'en-tête en porte ?
    fn sous_l_entete(&self, regle: &Regle, entete: &[usize]) -> bool {
        (0..3).all(|c| {
            let e = self.etendues(entete, &self.etiquettes[c]);
            e.is_empty() || e.iter().any(|&(x0, x1)| regle.cols[c].touche(x0, x1))
        })
    }

    fn bande(&self, rang: &[usize]) -> (f64, f64) {
        let y0 = rang.iter().map(|&k| self.jeton(k).y0).fold(f64::INFINITY, f64::min);
        let y1 = rang.iter().map(|&k| self.jeton(k).y1).fold(f64::NEG_INFINITY, f64::max);
        (y0, y1)
    }

    /// Les pourcentages lus sur la rangée : (jeton, valeur), et s'il y en a un qui n'est
    /// pas un taux du barème (une remise possible).
    fn remises(&self, rang: &[usize]) -> (Vec<(usize, i64)>, bool) {
        let mut out = Vec::new();
        let mut hors_bareme = false;
        for k in 0..rang.len() {
            if !self.ctx.marque_pourcent(rang, k) {
                continue;
            }
            for v in self.ctx.pourcentages(self.jeton(rang[k])).into_iter().filter(|v| *v > 0) {
                out.push((rang[k], v));
                if self.ctx.taux_de(v).is_none() {
                    hors_bareme = true;
                }
            }
        }
        (out, hors_bareme)
    }

    /// Les explications d'une rangée par une case collée : un jeton dont la boîte touche les
    /// colonnes quantité et prix, coupé par une coupe FOURNIE que la géométrie place à cheval
    /// sur les deux (la part gauche dans la colonne quantité, la droite dans celle du prix),
    /// avec gauche × droite = un montant lu de la rangée, exactement.
    fn coupes(&self, regle: &Regle, rang: &[usize], ms: &[(usize, i64)], cols: &[Vec<usize>; 3]) -> Vec<Choix> {
        let unite = self.ctx.unite;
        let mut out = Vec::new();
        for &k in rang {
            let j = self.jeton(k);
            if j.page != regle.page || j.decoupes.is_empty() {
                continue;
            }
            let (gauche, droite) = if regle.cols[Q].centre() < regle.cols[P].centre() { (Q, P) } else { (P, Q) };
            if !regle.cols[Q].touche(j.x0, j.x1) || !regle.cols[P].touche(j.x0, j.x1) {
                continue;
            }
            // seulement quand la quantité ou le prix n'a pas d'autre jeton sur la rangée
            let autre = |c: usize| cols[c].iter().any(|&x| x != k);
            if autre(Q) && autre(P) {
                continue;
            }
            let n = j.texte.chars().count();
            if n == 0 {
                continue;
            }
            for d in &j.decoupes {
                if d.coupe == 0 || d.coupe >= n {
                    continue;
                }
                let x = j.x0 + (j.x1 - j.x0) * d.coupe as f64 / n as f64;
                if regle.colonne_x((j.x0 + x) / 2.0) != Some(gauche) || regle.colonne_x((x + j.x1) / 2.0) != Some(droite) {
                    continue;
                }
                // la part gauche est la cellule de la colonne de gauche
                let (lq, lp): (Vec<i64>, Vec<i64>) = if gauche == Q {
                    (vec![d.gauche], d.droite.iter().filter(|l| l.forte).map(|l| l.v).collect())
                } else {
                    (d.droite.iter().map(|l| l.v).collect(), if d.gauche > 0 { vec![d.gauche] } else { Vec::new() })
                };
                for &q in lq.iter().filter(|q| **q > 0) {
                    for &p in lp.iter().filter(|p| **p > 0) {
                        for &(mk, m) in ms.iter().filter(|(mk, _)| *mk != k) {
                            if div_arrondi(q as i128 * p as i128, unite) == m as i128 {
                                out.push(Choix {
                                    q: Cellule::Coupe(k, q, d.coupe),
                                    p: Cellule::Coupe(k, p, d.coupe),
                                    m: Cellule::Lue(mk, m),
                                    r: None,
                                    ttc: None,
                                });
                            }
                        }
                    }
                }
            }
        }
        out
    }

    /// La rangée vue par la règle. `deduire` : une cellule absente peut se déduire.
    fn classer(&self, regle: &Regle, rang: &[usize], deduire: bool) -> Classe {
        let mut cols: [Vec<usize>; 3] = Default::default();
        for &k in rang {
            let j = self.jeton(k);
            if j.page != regle.page || j.montants.is_empty() {
                continue;
            }
            if let Some(c) = regle.colonne(j) {
                cols[c].push(k);
            }
        }
        if cols.iter().all(|c| c.is_empty()) {
            return Classe::Vide;
        }
        if cols[P].is_empty() && cols[M].is_empty() {
            return Classe::Texte;
        }
        let lectures = |c: usize, garder: &dyn Fn(i64, bool) -> bool| -> Vec<(usize, i64)> {
            let mut v: Vec<(usize, i64)> = cols[c]
                .iter()
                .flat_map(|&k| self.jeton(k).montants.iter().filter(|l| garder(l.v, l.forte)).map(move |l| (k, l.v)))
                .collect();
            v.sort();
            v.dedup();
            v
        };
        // q : lecture quelconque ; p : forte et positive ; m : forte (une reprise est négative)
        let qs = lectures(Q, &|v, _| v != 0);
        let ps = lectures(P, &|v, f| f && v > 0);
        let ms = lectures(M, &|v, f| f && v != 0);
        let (remises, hors_bareme) = self.remises(rang);
        let unite = self.ctx.unite;

        // a. trois cellules lues
        if !qs.is_empty() && !ps.is_empty() && !ms.is_empty() {
            let mut par_valeurs: BTreeMap<(i64, i64, i64, i64), Choix> = BTreeMap::new();
            for &(qk, q) in &qs {
                for &(pk, p) in &ps {
                    for &(mk, m) in &ms {
                        let mut rs: Vec<Option<(usize, i64)>> = vec![None];
                        rs.extend(remises.iter().filter(|(k, _)| ![qk, pk, mk].contains(k)).map(|x| Some(*x)));
                        for r in rs {
                            let prises: Vec<usize> = [Some(qk), Some(pk), Some(mk), r.map(|x| x.0)].into_iter().flatten().collect();
                            if let Some(ttc) = self.ctx.fermeture((q, p, m, r.map_or(0, |x| x.1)), rang, &prises) {
                                let c = Choix { q: Cellule::Lue(qk, q), p: Cellule::Lue(pk, p), m: Cellule::Lue(mk, m), r, ttc };
                                par_valeurs.entry(c.valeurs()).or_insert(c);
                            }
                        }
                    }
                }
            }
            return if par_valeurs.is_empty() {
                Classe::Bloque
            } else {
                Classe::Expliquee(par_valeurs.into_values().collect())
            };
        }
        let coupes = self.coupes(regle, rang, &ms, &cols);
        // un montant seul, sans quantité ni prix : un report
        if cols[Q].is_empty() && cols[P].is_empty() && !ms.is_empty() {
            return Classe::Report(ms);
        }
        // Une cellule absente : la colonne est vide (un jeton présent mais illisible bloque),
        // les deux autres lues, et rien ne dit une remise.
        let absente = |c: usize| cols[c].is_empty();
        let mut choix: Vec<Choix> = Vec::new();
        // Un prix TTC (la grille le permet) : les taux du barème, ou le seul taux imprimé
        // sur la rangée hors des cellules prises — celui que `fermeture` exige.
        let taux_ttc = |prises: &[usize]| -> Vec<(String, i64)> {
            if !self.ctx.prix_ttc {
                return Vec::new();
            }
            let imprime = self.ctx.taux_parmi(rang.iter().copied().filter(|k| !prises.contains(k)));
            self.ctx.bareme.iter().filter(|(c, _)| imprime.as_ref().is_none_or(|i| &i.code == c)).cloned().collect()
        };
        let ferme_ttc_a = |q: i64, p: i64, m: i64, prises: &[usize], code: &str| {
            self.ctx.fermeture((q, p, m, 0), rang, prises).flatten().is_some_and(|c| c == code)
        };
        if deduire && !hors_bareme {
            if absente(Q) && !ps.is_empty() && !ms.is_empty() {
                for &(pk, p) in &ps {
                    for &(mk, m) in &ms {
                        // b. la quantité : m / p, exacte, strictement positive
                        let n = m as i128 * unite;
                        if m > 0 && n % p as i128 == 0 {
                            if let Ok(q) = i64::try_from(n / p as i128) {
                                if q > 0 && div_arrondi(q as i128 * p as i128, unite) == m as i128 {
                                    choix.push(Choix { q: Cellule::Deduite(q), p: Cellule::Lue(pk, p), m: Cellule::Lue(mk, m), r: None, ttc: None });
                                }
                            }
                        }
                        // b'. un prix TTC : m × (1 + t) / p, une quantité ENTIÈRE (l'arrondi du
                        // montant HT ne laisse rien d'exact) que ce seul taux ferme
                        if m <= 0 {
                            continue;
                        }
                        for (code, ppm) in taux_ttc(&[pk, mk]) {
                            let k = div_arrondi(m as i128 * (PPM + ppm as i128), PPM * p as i128);
                            let Ok(q) = i64::try_from(k * unite) else { continue };
                            if k > 0 && ferme_ttc_a(q, p, m, &[pk, mk], &code) {
                                choix.push(Choix { q: Cellule::Deduite(q), p: Cellule::Lue(pk, p), m: Cellule::Lue(mk, m), r: None, ttc: Some(code) });
                            }
                        }
                    }
                }
            } else if absente(P) && !qs.is_empty() && !ms.is_empty() {
                for &(qk, q) in &qs {
                    for &(mk, m) in &ms {
                        if q <= 0 || m <= 0 {
                            continue;
                        }
                        // c. le prix : le seul p > 0 tel que arrondi(q × p) = m exactement
                        let p0 = div_arrondi(m as i128 * unite, q as i128);
                        let exacts: Vec<i128> =
                            (p0 - 1..=p0 + 1).filter(|&p| p > 0 && div_arrondi(q as i128 * p, unite) == m as i128).collect();
                        if let [p] = exacts.as_slice() {
                            if let Ok(p) = i64::try_from(*p) {
                                choix.push(Choix { q: Cellule::Lue(qk, q), p: Cellule::Deduite(p), m: Cellule::Lue(mk, m), r: None, ttc: None });
                            }
                        }
                        // c'. un prix TTC : le seul p qui ferme à ce seul taux
                        for (code, ppm) in taux_ttc(&[qk, mk]) {
                            let p0 = div_arrondi(m as i128 * unite * (PPM + ppm as i128), q as i128 * PPM);
                            let exacts: Vec<i64> = (p0 - 2..=p0 + 2)
                                .filter(|&p| p > 0)
                                .filter_map(|p| i64::try_from(p).ok())
                                .filter(|&p| ferme_ttc_a(q, p, m, &[qk, mk], &code))
                                .collect();
                            if let [p] = exacts.as_slice() {
                                choix.push(Choix { q: Cellule::Lue(qk, q), p: Cellule::Deduite(*p), m: Cellule::Lue(mk, m), r: None, ttc: Some(code) });
                            }
                        }
                    }
                }
            } else if absente(M) && !qs.is_empty() && !ps.is_empty() {
                // d. le montant : arrondi(q × p), que seule la somme pourra confirmer ; un
                // prix TTC, au seul taux imprimé sur la rangée
                for &(qk, q) in &qs {
                    for &(pk, p) in &ps {
                        if q <= 0 {
                            continue;
                        }
                        if let Ok(m) = i64::try_from(div_arrondi(q as i128 * p as i128, unite)) {
                            choix.push(Choix { q: Cellule::Lue(qk, q), p: Cellule::Lue(pk, p), m: Cellule::Deduite(m), r: None, ttc: None });
                        }
                        let imprime = self.ctx.taux_parmi(rang.iter().copied().filter(|k| ![qk, pk].contains(k)));
                        let taux = imprime.and_then(|i| self.ctx.bareme.iter().find(|(c, _)| *c == i.code).cloned());
                        if let (true, Some((code, ppm))) = (self.ctx.prix_ttc, taux) {
                            let m = div_arrondi(q as i128 * p as i128 * PPM, unite * (PPM + ppm as i128));
                            if let Ok(m) = i64::try_from(m) {
                                choix.push(Choix { q: Cellule::Lue(qk, q), p: Cellule::Lue(pk, p), m: Cellule::Deduite(m), r: None, ttc: Some(code) });
                            }
                        }
                    }
                }
                return if choix.is_empty() { Classe::Bloque } else { Classe::SansMontant(choix) };
            }
        }
        choix.extend(coupes);
        if !choix.is_empty() {
            return Classe::Expliquee(choix);
        }
        // e. La rangée partielle : son montant lu en lecture forte dans sa colonne, et un
        // nombre dans la colonne des quantités ou un prix lu — une ligne, que la somme exacte
        // au total prouvé confirme, et dont la cellule absente (ou illisible) est TUE : rien
        // n'est déduit (une remise perdue fausserait la quantité ; un tableau à remise ne
        // déduit pas). Le prix — et la remise lue sur la rangée — ne sont rendus que si une
        // quantité entière les ferme avec le montant ; la quantité absente ne l'est jamais.
        if !ms.is_empty() && (!cols[Q].is_empty() || !ps.is_empty()) {
            for &(mk, m) in &ms {
                let mut prix: Vec<Choix> = Vec::new();
                if absente(Q) {
                    let cent = CENT * unite;
                    for &(pk, p) in &ps {
                        let rs = std::iter::once(None).chain(remises.iter().filter(|(k, _)| ![pk, mk].contains(k)).map(|x| Some(*x)));
                        for r in rs {
                            let rv = r.map_or(0, |x| x.1) as i128;
                            if rv >= cent {
                                continue;
                            }
                            // la quantité entière que le montant permet, au plus une par voie
                            // (un prix HT, ou TTC à un taux du barème)
                            let entiere = |ppm: i128| div_arrondi(m as i128 * (PPM + ppm) * cent, PPM * p as i128 * (cent - rv));
                            let voies = std::iter::once(None).chain(self.ctx.bareme.iter().map(|(c, t)| Some((c.clone(), *t))));
                            let prises: Vec<usize> = [Some(pk), Some(mk), r.map(|x| x.0)].into_iter().flatten().collect();
                            let ferme = voies.into_iter().find_map(|v| {
                                let k = entiere(v.as_ref().map_or(0, |x| x.1 as i128));
                                let q = i64::try_from(k * unite).ok().filter(|_| k > 0)?;
                                self.ctx
                                    .fermeture((q, p, m, rv as i64), rang, &prises)
                                    .filter(|t| t.as_deref() == v.as_ref().map(|x| x.0.as_str()))
                            });
                            if let Some(ttc) = ferme {
                                prix.push(Choix { q: Cellule::Inconnue, p: Cellule::Lue(pk, p), m: Cellule::Lue(mk, m), r, ttc });
                            }
                        }
                    }
                }
                if prix.is_empty() {
                    choix.push(Choix { q: Cellule::Inconnue, p: Cellule::Inconnue, m: Cellule::Lue(mk, m), r: None, ttc: None });
                } else {
                    choix.extend(prix);
                }
            }
            return Classe::Expliquee(choix);
        }
        Classe::Bloque
    }

    /// La graine d'un triplet lu (positions dans la rangée).
    fn graine_lue(&self, s: usize, t: &Triplet) -> Graine {
        let rang = &self.rangs[s];
        let js = [self.jeton(rang[t.q.0]), self.jeton(rang[t.p.0]), self.jeton(rang[t.m.0])];
        let mut hs: Vec<f64> = js.iter().map(|j| j.y1 - j.y0).collect();
        hs.sort_by(f64::total_cmp);
        Graine {
            s,
            boites: js.map(|j| (j.x0, j.x1)),
            page: js[M].page,
            hauteur: hs[1].max(f64::EPSILON),
            y: centre_y(js[M]),
            choix: Choix {
                q: Cellule::Lue(rang[t.q.0], t.q.1),
                p: Cellule::Lue(rang[t.p.0], t.p.1),
                m: Cellule::Lue(rang[t.m.0], t.m.1),
                r: t.r.map(|(k, v)| (rang[k], v)),
                ttc: t.ttc.clone(),
            },
        }
    }

    /// La règle apprise d'une graine : ses trois boîtes, élargies.
    fn regle(g: &Graine) -> Regle {
        let b = g.boites;
        let hauteur = g.hauteur;
        // l'ordre géométrique des trois colonnes, de gauche à droite
        let mut ordre = [Q, P, M];
        ordre.sort_by(|&a, &c| b[a].0.total_cmp(&b[c].0));
        let mut cols: Vec<Colonne> = b.iter().map(|&(x0, x1)| Colonne { x0, x1, marge_g: 0.0, marge_d: 0.0 }).collect();
        for (rangc, &c) in ordre.iter().enumerate() {
            let large = (b[c].1 - b[c].0).max(hauteur);
            let gauche = rangc.checked_sub(1).map(|r| (b[c].0 - b[ordre[r]].1) / 2.0);
            let droite = ordre.get(rangc + 1).map(|&o| (b[o].0 - b[c].1) / 2.0);
            cols[c].marge_g = gauche.map_or(large, |x| large.min(x.max(0.0)));
            cols[c].marge_d = droite.map_or(large, |x| large.min(x.max(0.0)));
        }
        let mut it = cols.into_iter();
        let cols = [it.next().unwrap(), it.next().unwrap(), it.next().unwrap()];
        Regle { page: g.page, cols, centres: vec![g.y], hauteur }
    }

    /// Les graines lues d'une page : un triplet q × p = m (un prix HT, ou TTC quand la grille
    /// le permet), de gauche à droite puis de droite à gauche ; jamais une rangée qui porte
    /// un repère du centre.
    fn graines_lues(&self, page: u32) -> Vec<Graine> {
        let mut out = Vec::new();
        for (i, r) in self.rangs.iter().enumerate() {
            if self.page(i) != page || self.porte(r, &self.arret) {
                continue;
            }
            out.extend(self.ctx.triplets(r, true).into_iter().map(|t| self.graine_lue(i, &t)));
            let inverse: Vec<usize> = r.iter().rev().copied().collect();
            let n = r.len();
            let retour = |(k, v): (usize, i64)| (n - 1 - k, v);
            out.extend(self.ctx.triplets(&inverse, true).into_iter().map(|t| {
                self.graine_lue(i, &Triplet { q: retour(t.q), p: retour(t.p), m: retour(t.m), r: t.r.map(retour), ttc: t.ttc.clone() })
            }));
        }
        out
    }

    /// Les graines ancrées par l'en-tête d'une page, quand aucune de ses rangées n'a ses
    /// trois cellules lues : sous un en-tête qui porte les étiquettes des trois colonnes
    /// (repères de la grille), une rangée dont le prix et le montant sont lus en lecture
    /// forte sous leurs étiquettes, la colonne des quantités vide, et m / p entier
    /// strictement positif.
    fn graines_d_entete(&self, page: u32) -> Vec<Graine> {
        let unite = self.ctx.unite;
        let mut out = Vec::new();
        // l'en-tête peut porter un repère du centre (« Montant HT ») : il n'est pas filtré
        for (h, entete) in self.rangs.iter().enumerate() {
            if self.page(h) != page {
                continue;
            }
            let [eq, ep, em] = [Q, P, M].map(|c| self.etendues(entete, &self.etiquettes[c]));
            let (Some(&bq), false, false) = (eq.first(), ep.is_empty(), em.is_empty()) else { continue };
            let sous = |j: &Jeton, e: &[(f64, f64)]| e.iter().any(|&(x0, x1)| j.x0 <= x1 && j.x1 >= x0);
            for (s, rang) in self.rangs.iter().enumerate().skip(h + 1) {
                if self.page(s) != page || self.porte(rang, &self.arret) {
                    continue;
                }
                let fortes = |k: usize, e: &[(f64, f64)]| -> Vec<i64> {
                    let j = self.jeton(k);
                    if !sous(j, e) {
                        return Vec::new();
                    }
                    j.montants.iter().filter(|l| l.forte && l.v > 0).map(|l| l.v).collect()
                };
                for &pk in rang {
                    for p in fortes(pk, &ep) {
                        for &mk in rang.iter().filter(|&&mk| mk != pk) {
                            for m in fortes(mk, &em) {
                                let n = m as i128 * unite;
                                if n % p as i128 != 0 || (n / p as i128) % unite != 0 || n / p as i128 <= 0 {
                                    continue;
                                }
                                let (jp, jm) = (self.jeton(pk), self.jeton(mk));
                                let mut g = Graine {
                                    s,
                                    boites: [bq, (jp.x0, jp.x1), (jm.x0, jm.x1)],
                                    page,
                                    hauteur: (jp.y1 - jp.y0).max(f64::EPSILON),
                                    y: centre_y(jm),
                                    choix: Choix { q: Cellule::Deduite(0), p: Cellule::Lue(pk, p), m: Cellule::Lue(mk, m), r: None, ttc: None },
                                };
                                // la rangée vue par sa propre règle : quantité absente, déduite
                                let Classe::Expliquee(choix) = self.classer(&Self::regle(&g), rang, true) else { continue };
                                if let Some(c) = choix.into_iter().find(|c| {
                                    c.q.deduite() && c.p == Cellule::Lue(pk, p) && c.m == Cellule::Lue(mk, m)
                                }) {
                                    g.choix = c;
                                    out.push(g);
                                }
                            }
                        }
                    }
                }
            }
        }
        out
    }

    /// Le segment d'une graine : les rangées de sa page, ou rien si une rangée bloque.
    /// Un tableau qui porte une rangée partielle (une cellule tue) ou une remise lue ne
    /// déduit rien : ce qui fait taire une cellule (une remise perdue, une lecture fausse)
    /// peut fausser une cellule déduite ailleurs. Il se relit alors sans déduction — ses
    /// rangées incomplètes deviennent partielles.
    fn segment(&self, g: &Graine) -> Option<Segment> {
        let seg = self.segment_selon(g, true)?;
        let partielle = |c: &Choix| c.q == Cellule::Inconnue || c.p == Cellule::Inconnue;
        let douteux = seg.lignes.iter().any(|l| l.choix.iter().any(|c| partielle(c) || c.r.is_some()));
        let deduit = seg.lignes.iter().any(|l| l.choix.iter().any(|c| c.q.deduite() || c.p.deduite() || c.m.deduite()));
        if douteux && deduit {
            self.segment_selon(g, false)
        } else {
            Some(seg)
        }
    }

    /// Le segment d'une graine, la déduction permise ou non (`permise`).
    fn segment_selon(&self, g: &Graine, permise: bool) -> Option<Segment> {
        let rangs = self.rangs;
        let s = g.s;
        let mut regle = Self::regle(g);
        // L'en-tête : au-dessus, la première rangée sans nombre dans les colonnes de la graine
        // qui porte une étiquette de colonne ; à défaut, la première rangée sans nombre.
        let vides: Vec<usize> = (0..s)
            .rev()
            .take_while(|&i| self.page(i) == regle.page)
            .filter(|&i| matches!(self.classer(&regle, &rangs[i], false), Classe::Vide))
            .collect();
        let etiquetee = vides.iter().copied().find(|&i| self.etiquettes.iter().any(|e| self.porte(&rangs[i], e)));
        let entete = etiquetee.or(vides.first().copied());
        // colonnes cohérentes : sous les étiquettes de l'en-tête, quand il en porte
        if entete.is_some_and(|i| !self.sous_l_entete(&regle, &rangs[i])) {
            return None;
        }
        let a_remise = g.choix.r.is_some() || entete.is_some_and(|i| self.porte(&rangs[i], &self.remise));
        let deduire = permise && !a_remise;
        // la graine d'en-tête porte une quantité déduite : sans déduction, elle est tue
        let mut graine = g.choix.clone();
        if !permise && graine.q.deduite() {
            graine.q = Cellule::Inconnue;
        }
        let mut lignes = vec![Ligne { rang: s, choix: vec![graine], report: Vec::new(), regle: None }];

        let accueillir = |regle: &mut Regle, i: usize, classe: Classe, lignes: &mut Vec<Ligne>| -> Option<bool> {
            match classe {
                Classe::Vide | Classe::Texte => Some(false),
                Classe::Bloque => None,
                Classe::Report(report) => {
                    lignes.push(Ligne { rang: i, choix: Vec::new(), report, regle: None });
                    Some(true)
                }
                Classe::Expliquee(choix) | Classe::SansMontant(choix) => {
                    // une explication par valeurs : deux jetons de même valeur ne font
                    // pas deux affectations (la fermeture compte les affectations distinctes)
                    let mut vus = BTreeSet::new();
                    let choix: Vec<Choix> = choix.into_iter().filter(|c| vus.insert(c.valeurs())).collect();
                    // une rangée lue sans ambiguïté de jetons affine les colonnes
                    if let [c] = choix.as_slice() {
                        for (col, cel) in [(Q, c.q), (P, c.p), (M, c.m)] {
                            if let Cellule::Lue(k, _) = cel {
                                regle.cols[col].affiner(&self.ctx.jetons[k]);
                            }
                        }
                    }
                    let (y0, y1) = self.bande(&rangs[i]);
                    regle.centres.push((y0 + y1) / 2.0);
                    lignes.push(Ligne { rang: i, choix, report: Vec::new(), regle: None });
                    Some(true)
                }
            }
        };
        // vers le haut, jusqu'à l'en-tête ; sous un en-tête étiqueté, une rangée sans nombre
        // (une colonne voisine de la page, une désignation sur deux lignes) est sautée, à
        // moins de `LIMITE_PAS` pas de la dernière rangée chiffrée
        let mut dernier = g.y;
        for i in (0..s).rev() {
            if self.page(i) != regle.page || Some(i) == entete {
                break;
            }
            let classe = self.classer(&regle, &rangs[i], deduire);
            let (y0, y1) = self.bande(&rangs[i]);
            if matches!(classe, Classe::Vide | Classe::Texte) {
                if etiquetee.is_none() || dernier - (y0 + y1) / 2.0 > LIMITE_PAS * regle.pas() {
                    break;
                }
                continue;
            }
            dernier = (y0 + y1) / 2.0;
            accueillir(&mut regle, i, classe, &mut lignes)?;
        }
        // vers le bas, jusqu'à un repère du centre, la fin du tableau ou le bas de la page
        dernier = g.y;
        let mut clos = false;
        for (i, r) in rangs.iter().enumerate().skip(s + 1) {
            if self.page(i) != regle.page {
                break;
            }
            if self.porte(r, &self.arret) {
                clos = true;
                break;
            }
            let (y0, y1) = self.bande(r);
            if (y0 + y1) / 2.0 - dernier > LIMITE_PAS * regle.pas() {
                break;
            }
            let classe = self.classer(&regle, r, deduire);
            if accueillir(&mut regle, i, classe, &mut lignes)? {
                dernier = (y0 + y1) / 2.0;
            }
        }
        let regle = Rc::new(regle);
        for l in &mut lignes {
            l.regle = Some(regle.clone());
        }
        lignes.sort_by_key(|l| l.rang);
        Some(Segment { lignes, clos })
    }

    /// La remise globale possible : dans le bloc des totaux (les rangées de la dernière page
    /// sous la dernière ligne), les rangées qui portent un repère de la remise globale ou
    /// du total brut.
    fn remise_globale(&self, derniere: usize) -> RemiseGlobale {
        let mut r = RemiseGlobale::default();
        let page = self.page(derniere);
        for (i, rang) in self.rangs.iter().enumerate().skip(derniere + 1) {
            if self.page(i) != page {
                break;
            }
            let fortes = || rang.iter().flat_map(|&k| self.jeton(k).montants.iter().filter(|l| l.forte && l.v != 0).map(move |l| (k, l.v)));
            if !self.remise_globale.is_empty() && self.porte(rang, &self.remise_globale) {
                r.montants.extend(fortes().map(|(k, v)| (k, v.abs())));
                r.taux.extend(self.remises(rang).0);
            }
            if !self.brut.is_empty() && self.porte(rang, &self.brut) {
                r.bruts.extend(fortes().map(|(_, v)| v));
            }
        }
        r
    }
}

/// Une affectation qui ferme : un choix par rangée (0 pour un report) et la remise globale
/// retenue, s'il en faut une : (valeur, jeton).
type Fermante = (Vec<usize>, Option<(i64, usize)>);

/// La fermeture : les affectations (un choix par rangée, en valeurs) dont la somme des
/// montants vaut un total prouvé, directement ou par la remise globale ; chaque report vaut
/// la somme courante. `Err` si le plafond est dépassé.
fn fermer(lignes: &[&Ligne], cibles: &[i64], remise: &RemiseGlobale, unite: i128) -> Result<Vec<Fermante>, ()> {
    struct Recherche<'a> {
        l: &'a [&'a Ligne],
        cibles: &'a [i64],
        remise: &'a RemiseGlobale,
        unite: i128,
        out: Vec<Fermante>,
        explorees: u64,
    }
    fn chercher(r: &mut Recherche, somme: i64, choix: &mut Vec<usize>) -> Result<(), ()> {
        if r.out.len() > 1 {
            return Ok(());
        }
        r.explorees += 1;
        if r.explorees > PLAFOND_COMBINAISONS {
            return Err(());
        }
        let k = choix.len();
        if k == r.l.len() {
            if r.cibles.contains(&somme) {
                r.out.push((choix.clone(), None));
            } else if let Some(x) = r.remise.explique(somme, r.cibles, r.unite) {
                r.out.push((choix.clone(), Some(x)));
            }
            return Ok(());
        }
        let ligne = r.l[k];
        if ligne.est_report() {
            if ligne.report.iter().any(|(_, v)| *v == somme) {
                choix.push(0);
                chercher(r, somme, choix)?;
                choix.pop();
            }
            return Ok(());
        }
        for (i, c) in ligne.choix.iter().enumerate() {
            choix.push(i);
            chercher(r, somme.saturating_add(c.m.v()), choix)?;
            choix.pop();
        }
        Ok(())
    }
    let mut r = Recherche { l: lignes, cibles, remise, unite, out: Vec::new(), explorees: 0 };
    chercher(&mut r, 0, &mut Vec::with_capacity(lignes.len()))?;
    Ok(r.out)
}

/// Les repères des champs du centre : les champs montants nommés par les preuves de la
/// grille autres que `lignes`, et le total des lignes. Les champs des lignes en sont exclus.
fn reperes_d_arret(op: &OpLignes, grille: &Grille, champs_lignes: &BTreeSet<String>) -> Vec<String> {
    fn noms(v: &serde_json::Value, out: &mut BTreeSet<String>) {
        match v {
            serde_json::Value::String(s) => {
                out.insert(s.trim_end_matches('?').trim().to_string());
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| noms(x, out)),
            serde_json::Value::Object(o) => o.values().for_each(|x| noms(x, out)),
            _ => {}
        }
    }
    let mut codes: BTreeSet<String> = BTreeSet::new();
    for p in &grille.preuves {
        if let Some(e) = &p.expression {
            if e.get("op").and_then(|o| o.as_str()) != Some(super::OP) {
                noms(e, &mut codes);
            }
        }
    }
    codes.insert(op.montant_total.clone());
    codes.extend(op.total_brut.clone());
    grille
        .champs
        .iter()
        .filter(|c| c.genre == "montant" && codes.contains(&c.code) && !champs_lignes.contains(&c.code))
        .flat_map(reperes_de)
        .collect()
}

/// L'empreinte d'une rangée d'un segment : son rang, ses explications et son report, en valeurs.
type EmpreinteLigne = (usize, Vec<(i64, i64, i64, i64)>, Vec<i64>);

/// La signature d'un tableau qui ferme : chaque ligne en valeurs, et la remise globale.
type Signature = (Vec<(usize, (i64, i64, i64, i64))>, Option<i64>);

/// Les lignes lues du milieu vers les bords, ou rien (les lignes restent signalées, avec
/// le verdict de toujours).
pub(super) fn prouver(ctx: &Contexte, op: &OpLignes, grille: &Grille, rangs: &[Vec<usize>], cibles: &[i64]) -> Option<Lu> {
    let champs_lignes: BTreeSet<String> = op.champs_lignes.iter().cloned().collect();
    let reperes = |code: Option<&String>| {
        code.and_then(|r| grille.champs.iter().find(|c| &c.code == r)).map(reperes_de).unwrap_or_default()
    };
    let lecture = Lecture {
        ctx,
        rangs,
        arret: reperes_d_arret(op, grille, &champs_lignes),
        remise: reperes(op.remise.as_ref()),
        etiquettes: [reperes(Some(&op.colonnes[Q])), reperes(Some(&op.colonnes[P])), reperes(Some(&op.colonnes[M]))],
        remise_globale: reperes(op.remise_globale.as_ref()),
        brut: reperes(op.total_brut.as_ref()),
    };

    // Par page : les graines (lues, sinon ancrées par l'en-tête), du milieu vers les bords,
    // et les segments distincts qu'elles lisent.
    let pages: BTreeSet<u32> = (0..rangs.len()).map(|i| lecture.page(i)).collect();
    let mut segments: BTreeMap<u32, Vec<Segment>> = BTreeMap::new();
    for &page in &pages {
        let mut graines = lecture.graines_lues(page);
        if graines.is_empty() {
            graines = lecture.graines_d_entete(page);
        }
        if graines.is_empty() {
            continue;
        }
        let ys: Vec<f64> = graines.iter().map(|g| g.y).collect();
        let milieu = (ys.iter().copied().fold(f64::INFINITY, f64::min) + ys.iter().copied().fold(f64::NEG_INFINITY, f64::max)) / 2.0;
        let mut ordre: Vec<usize> = (0..graines.len()).collect();
        ordre.sort_by(|&a, &b| (ys[a] - milieu).abs().total_cmp(&(ys[b] - milieu).abs()).then(a.cmp(&b)));
        let mut vus: BTreeSet<Vec<EmpreinteLigne>> = BTreeSet::new();
        for g in ordre {
            let Some(seg) = lecture.segment(&graines[g]) else { continue };
            let sig = seg
                .lignes
                .iter()
                .map(|l| (l.rang, l.choix.iter().map(Choix::valeurs).collect(), l.report.iter().map(|x| x.1).collect()))
                .collect();
            if vus.insert(sig) {
                segments.entry(page).or_default().push(seg);
            }
        }
    }

    // Les tableaux : un segment par page, sur des pages consécutives, chaque segment sauf le
    // dernier ouvert en bas (pas de repère du centre) ; toutes les affectations qui ferment
    // doivent donner le même tableau, en valeurs.
    let liste: Vec<(u32, &Vec<Segment>)> = segments.iter().map(|(p, s)| (*p, s)).collect();
    let mut enchainements: Vec<Vec<&Segment>> = Vec::new();
    for a in 0..liste.len() {
        let mut courants: Vec<Vec<&Segment>> = liste[a].1.iter().map(|s| vec![s]).collect();
        let mut b = a;
        loop {
            enchainements.extend(courants.iter().cloned());
            if enchainements.len() > PLAFOND_ENCHAINEMENTS {
                return None;
            }
            b += 1;
            if b >= liste.len() || liste[b].0 != liste[b - 1].0 + 1 {
                break;
            }
            courants = courants
                .iter()
                .filter(|c| !c.last().is_some_and(|s| s.clos))
                .flat_map(|c| {
                    liste[b].1.iter().map(move |s| {
                        let mut n = c.clone();
                        n.push(s);
                        n
                    })
                })
                .collect();
            if courants.is_empty() {
                break;
            }
        }
    }

    let mut retenu: Option<(Vec<&Ligne>, Fermante, Signature)> = None;
    for e in enchainements {
        let lignes: Vec<&Ligne> = e.iter().flat_map(|s| s.lignes.iter()).collect();
        // un seul montant déduit dans tout le tableau ; une remise lue interdit toute déduction
        let sans_montant = lignes.iter().filter(|l| l.choix.iter().any(|c| c.m.deduite())).count();
        let remise_lue = lignes.iter().any(|l| l.choix.iter().any(|c| c.r.is_some()));
        let une_deduite =
            lignes.iter().any(|l| l.choix.iter().any(|c| c.q.deduite() || c.p.deduite() || c.m.deduite()));
        if sans_montant > 1 || (remise_lue && une_deduite) || lignes.iter().all(|l| l.est_report()) {
            continue;
        }
        let derniere = lignes.iter().map(|l| l.rang).max().unwrap_or_default();
        let remise = lecture.remise_globale(derniere);
        let Ok(fermantes) = fermer(&lignes, cibles, &remise, ctx.unite) else { return None };
        let mut signatures: BTreeSet<Signature> = BTreeSet::new();
        for (f, r) in &fermantes {
            signatures.insert((
                lignes.iter().zip(f).filter(|(l, _)| !l.est_report()).map(|(l, &i)| (l.rang, l.choix[i].valeurs())).collect(),
                r.map(|x| x.0),
            ));
        }
        match (signatures.len(), &retenu) {
            (0, _) => {}
            (1, None) => {
                let sig = signatures.into_iter().next().unwrap();
                let f = fermantes.into_iter().next().unwrap();
                retenu = Some((lignes, f, sig));
            }
            (1, Some((_, _, sig))) if signatures.contains(sig) => {}
            _ => return None,
        }
    }
    let (lignes, (f, remise), _) = retenu?;
    let mut deduites = 0;
    let instances = lignes
        .iter()
        .zip(&f)
        .filter(|(l, _)| !l.est_report())
        .map(|(l, &i)| {
            let c = &l.choix[i];
            deduites += [c.q, c.p, c.m].iter().filter(|x| x.deduite()).count();
            sortie(&lecture, l.regle.as_ref().expect("règle du segment"), &rangs[l.rang], c, op.avec_taux)
        })
        .collect();
    let remise_globale = remise.map(|(v, k)| Cite::lue(v.to_string(), vec![ctx.cite(k)]));
    Some(Lu { instances, deduites, remise_globale })
}

fn sortie(lecture: &Lecture, regle: &Regle, rang: &[usize], c: &Choix, avec_taux: bool) -> LigneSortie {
    let ctx = lecture.ctx;
    let (y0, y1) = lecture.bande(rang);
    let cellule = |cel: Cellule, col: usize| match cel {
        Cellule::Lue(k, v) => Some(Cite { statut: Some("lu"), ..Cite::lue(v.to_string(), vec![ctx.cite(k)]) }),
        Cellule::Coupe(k, v, coupe) => {
            Some(Cite { statut: Some("coupe"), coupe: Some(coupe), ..Cite::lue(v.to_string(), vec![ctx.cite(k)]) })
        }
        Cellule::Deduite(v) => Some(Cite {
            statut: Some("deduit"),
            case_: Some(Case { page: regle.page, x0: regle.cols[col].x0, y0, x1: regle.cols[col].x1, y1 }),
            ..Cite::lue(v.to_string(), Vec::new())
        }),
        Cellule::Inconnue => None,
    };
    // Les jetons d'une cellule tue (une rangée partielle) ne sont ni le taux ni la désignation.
    let tues: BTreeSet<usize> = [(Q, c.q), (P, c.p)]
        .into_iter()
        .filter(|(_, cel)| *cel == Cellule::Inconnue)
        .flat_map(|(col, _)| rang.iter().copied().filter(move |&k| regle.colonne(&ctx.jetons[k]) == Some(col)))
        .collect();
    let lus: BTreeSet<usize> =
        [c.q, c.p, c.m].iter().filter_map(Cellule::jeton).chain(c.r.map(|x| x.0)).chain(tues.iter().copied()).collect();
    // La désignation : au-delà de la colonne des quantités, du côté opposé aux prix.
    let q = &regle.cols[Q];
    let rtl = regle.cols[P].centre() < q.centre();
    let au_dela = |j: &Jeton| {
        let x = (j.x0 + j.x1) / 2.0;
        if rtl {
            x > q.x1 + q.marge_d
        } else {
            x < q.x0 - q.marge_g
        }
    };
    let gauche: Vec<usize> = rang.iter().copied().filter(|&k| !lus.contains(&k) && au_dela(&ctx.jetons[k])).collect();
    let taux = if avec_taux {
        ctx.taux_parmi(rang.iter().copied().filter(|&k| !lus.contains(&k) && !au_dela(&ctx.jetons[k])))
    } else {
        None
    };
    LigneSortie {
        // la ligne principale de la désignation est celle de la quantité, sinon du prix, sinon
        // du montant
        designation: if gauche.is_empty() {
            None
        } else {
            let chiffres: Vec<usize> = [c.q, c.p, c.m].iter().filter_map(Cellule::jeton).collect();
            ctx.designation(&gauche, chiffres.first().copied(), &chiffres)
        },
        quantite: cellule(c.q, Q),
        prix: cellule(c.p, P),
        remise: c.r.map(|(k, v)| Cite { statut: Some("lu"), ..Cite::lue(v.to_string(), vec![ctx.cite(k)]) }),
        montant: cellule(c.m, M).expect("le montant d'une ligne est lu ou déduit"),
        taux,
        prix_ttc: c.ttc.is_some() && c.p != Cellule::Inconnue,
    }
}
