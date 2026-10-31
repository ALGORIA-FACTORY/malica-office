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
//! Quand cette stratégie ne prouve pas (une cellule perdue par l'OCR), la lecture
//! « du milieu vers les bords » (`milieu`) prend le relais : elle apprend la règle du
//! tableau de sa rangée la mieux expliquée, et peut déduire une cellule manquante.
//!
//! Non bloquant : cette preuve lit la sortie du centre et ne la modifie jamais.
//! Aucune constante réglementaire : le barème vient du pack (R4).

mod milieu;

use crate::entree::{Entree, Grille, Jeton};
use crate::valeurs::{div_arrondi, PPM};
use crate::{ChampSortie, RefJeton};
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

/// Le nom de l'op dans le langage des preuves.
pub const OP: &str = "lignes";

/// Plafond des combinaisons de triplets explorées ; au-delà, les lignes sont signalées.
const PLAFOND_COMBINAISONS: u64 = 100_000;

/// Un pourcentage s'exprime sur cent : l'unité du symbole « % », pas un taux.
const CENT: i128 = 100;

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
        Cite { valeur, refs, statut: None, case_: None }
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
}

/// L'op lue dans la grille.
pub struct OpLignes {
    pub montant_total: String,
    pub total_brut: Option<String>,
    /// Le champ de la remise de ligne, s'il est déclaré (ses repères disent un tableau à remise).
    pub remise: Option<String>,
    /// Les champs des lignes (désignation, quantité, prix, remise, montant, taux).
    pub champs_lignes: Vec<String>,
    /// Les champs des trois colonnes chiffrées : quantité, prix, montant.
    pub colonnes: [String; 3],
    pub bareme: Option<String>,
    pub base_par_taux: Option<String>,
    /// Le total des bases du groupe de taux (`total_base`), s'il est déclaré.
    pub total_base: Option<String>,
    pub avec_taux: bool,
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
    genre(&exige("designation")?)?;
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
    let champs_lignes =
        ["designation", "quantite", "prix", "remise", "montant", "taux"].iter().filter_map(|k| cle(e, k)).collect();
    Ok(OpLignes { montant_total: total, total_brut, remise, champs_lignes, colonnes, bareme, base_par_taux, total_base, avec_taux })
}

/// Un triplet d'une rangée (indices dans la rangée triée de gauche à droite).
#[derive(Clone)]
struct Triplet {
    q: (usize, i64),
    p: (usize, i64),
    m: (usize, i64),
    r: Option<(usize, i64)>,
}

impl Triplet {
    fn valeurs(&self) -> (i64, i64, i64, i64) {
        (self.q.1, self.p.1, self.m.1, self.r.map_or(0, |x| x.1))
    }
}

/// Les rangées : jetons groupés par bande horizontale, triés de gauche à droite.
fn rangees(jetons: &[Jeton]) -> Vec<Vec<usize>> {
    rangees_selon(jetons, f64::min)
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

    /// Les triplets d'une rangée, dédoublonnés par valeurs (q, p, m, r) : à valeurs
    /// égales, on garde les jetons les plus à droite (la colonne, pas la désignation).
    fn triplets(&self, rang: &[usize]) -> Vec<Triplet> {
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
                                    if !self.ferme(q, p, m, r.map_or(0, |x| x.1)) {
                                        continue;
                                    }
                                    let t = Triplet { q: (qi, q), p: (pi, p), m: (mi, m), r };
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

    /// La désignation : les jetons donnés, joints, cités.
    fn designation(&self, jetons: &[usize]) -> Cite {
        Cite::lue(
            jetons.iter().map(|&k| self.jetons[k].texte.trim()).collect::<Vec<_>>().join(" "),
            jetons.iter().map(|&k| self.cite(k)).collect(),
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
            Some(self.designation(&gauche))
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
    };
    let vide = |statut: &str| LignesSortie {
        statut: statut.into(),
        instances: Vec::new(),
        taux_par_base: "non_evaluable".into(),
        deduites: None,
    };

    let rangs = rangees(&entree.jetons);
    let candidates: Vec<(usize, Vec<Triplet>)> =
        rangs.iter().enumerate().map(|(i, r)| (i, ctx.triplets(r))).filter(|(_, t)| !t.is_empty()).collect();
    let cibles: Vec<i64> =
        [Some(op.montant_total.as_str()), op.total_brut.as_deref()].into_iter().flatten().filter_map(|c| prouvee(champs, c)).collect();
    let (mut instances, deduites) = if candidates.is_empty() {
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
            Ok(i) => (i, 0),
            // la stratégie de toujours ne prouve pas : la lecture du milieu, sinon son verdict
            Err(st) => match milieu::prouver(&ctx, op, &entree.grille, &rangs, &cibles) {
                Some(r) => r,
                None => return (vide("signale"), st),
            },
        }
    };
    let taux_par_base = verifier_taux(op, champs, &mut instances);
    let sortie = LignesSortie {
        statut: "prouve".into(),
        instances,
        taux_par_base: taux_par_base.into(),
        deduites: (deduites > 0).then_some(deduites),
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
fn verifier_taux(op: &OpLignes, champs: &BTreeMap<String, ChampSortie>, instances: &mut [LigneSortie]) -> &'static str {
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
            for l in instances.iter() {
                if let Some(t) = &l.taux {
                    *sommes.entry(t.code.clone()).or_default() += l.montant.valeur.parse::<i64>().unwrap_or_default();
                }
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
