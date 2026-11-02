//! La recherche : un retour arrière avec propagation. À chaque nœud, on vérifie
//! les contraintes entièrement connues ; puis on cherche un champ DÉTERMINÉ par
//! une contrainte dont les autres termes sont affectés (on calcule sa valeur et
//! on exige qu'un jeton la porte) ; à défaut, on énumère un champ LIBRE, borné
//! par les intervalles que les groupes de taux imposent aux sommes.
//!
//! Règles héritées de l'implémentation mesurée (0 fausse preuve sur 7 191 lectures
//! corrompues) et préservées ici :
//! - sommes et égalités exactes ; seuls produit, taux et charge à taux arrondissent ;
//! - une solution qui ne s'appuie que sur des lectures fortes l'emporte sur les faibles ;
//! - le groupe de taux « en total seul » et l'exonération n'acceptent que des lectures fortes ;
//! - une charge à montant fixe imprimé (lecture forte) ne peut pas être écartée ;
//! - deux chemins vers la même solution n'en font qu'une : on garde la plus forte.

use crate::modele::{Contrainte, Groupe, Modele, Unite};
use crate::valeurs::{div_arrondi, Coef, Domaine};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

#[derive(Clone, Copy, Debug)]
pub struct Val {
    pub v: i64,
    pub absent: bool,
    pub faible: bool,
}

#[derive(Clone, Debug)]
pub struct Instance {
    /// Indice du taux dans le barème du groupe.
    pub taux: usize,
    /// Montant imprimé ; None en « total seul » (montant recalculé, non cité).
    pub m: Option<i64>,
    pub m_calcule: i64,
    /// Base imprimée ; None quand elle est seulement déduite.
    pub b: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct SolGroupe {
    pub instances: Vec<Instance>,
    pub somme_m: i64,
    pub somme_b: i64,
    pub faible: bool,
    pub exige_forte: bool,
    /// Exonération : zéro instance, montant nul imprimé.
    pub exoneration: bool,
    /// Exonération partielle : bases toutes imprimées, Σ bases < total des bases ; la
    /// part exonérée (total − Σ bases) doit être confirmée par les lignes (`lib.rs`).
    pub partielle: bool,
}

#[derive(Clone)]
pub struct Etat {
    pub s: Vec<Option<Val>>,
    pub g: Vec<Option<Rc<SolGroupe>>>,
}

#[derive(Clone)]
pub struct Solution {
    pub etat: Etat,
    pub faible: bool,
}

#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum Eval {
    Inconnu,
    Ok,
    Echec,
    NonEvaluable,
}

pub struct Solveur<'a> {
    pub m: &'a Modele,
    pub dom: &'a Domaine,
    pub tol: i64,
    pub decimales: u32,
    /// Barème effectif de chaque groupe : (code, coefficient), taux nuls exclus.
    coefs_groupes: Vec<Vec<(String, Coef)>>,
    baremes: BTreeMap<String, Vec<(String, i64, Coef)>>,
    utiles: Vec<bool>,
    /// Domaine restreint aux valeurs ancrées par le libellé, pour les champs de somme seule.
    restreints: Vec<Option<BTreeSet<i64>>>,
    exo_autorisee: Vec<bool>,
    zero_fort: bool,
    plafond: u64,
    pub combinaisons: u64,
    pub depasse: bool,
    pub solutions: Vec<Solution>,
}

fn combinaisons_k(n: usize, k: usize) -> Vec<Vec<usize>> {
    fn rec(n: usize, k: usize, debut: usize, cur: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
        if cur.len() == k {
            out.push(cur.clone());
            return;
        }
        for i in debut..n {
            cur.push(i);
            rec(n, k, i + 1, cur, out);
            cur.pop();
        }
    }
    let mut out = Vec::new();
    rec(n, k, 0, &mut Vec::new(), &mut out);
    out
}

impl<'a> Solveur<'a> {
    pub fn new(
        m: &'a Modele,
        dom: &'a Domaine,
        pack: &crate::entree::Pack,
        exo_annoncee: Vec<bool>,
        restreints: Vec<Option<BTreeSet<i64>>>,
        plafond: u64,
    ) -> Self {
        // Les charges d'assiette présentes majorent la base du barème que leur preuve nomme.
        let mut assiette_ppm: BTreeMap<&str, i64> = BTreeMap::new();
        for cp in &m.contraintes {
            if let Contrainte::Charge { m: v, taux_ppm: Some(t), assiette: Some(b), .. } = &cp.c {
                if m.vars[*v].present {
                    *assiette_ppm.entry(b.as_str()).or_insert(0) += *t;
                }
            }
        }
        let mut baremes = BTreeMap::new();
        for (nom, taux) in &pack.baremes {
            let v: Vec<(String, i64, Coef)> = taux
                .iter()
                .map(|t| {
                    let c = match assiette_ppm.get(nom.as_str()) {
                        Some(&a) if a != 0 => Coef::avec_assiette(t.ppm, a),
                        _ => Coef::ppm(t.ppm),
                    };
                    (t.code.clone(), t.ppm, c)
                })
                .collect();
            baremes.insert(nom.clone(), v);
        }
        let coefs_groupes = m
            .groupes
            .iter()
            .map(|g| {
                baremes[&g.bareme].iter().filter(|(_, p, _)| *p > 0).map(|(c, _, k)| (c.clone(), *k)).collect()
            })
            .collect();
        // Un champ qu'aucune contrainte n'emploie n'est pas cherché.
        let mut utiles = vec![false; m.vars.len()];
        for cp in &m.contraintes {
            for u in unites(&cp.c, m) {
                if let Unite::S(i) = u {
                    utiles[i] = true;
                }
            }
        }
        Solveur {
            m,
            dom,
            tol: pack.tolerance,
            decimales: pack.decimales,
            coefs_groupes,
            baremes,
            utiles,
            restreints,
            exo_autorisee: exo_annoncee,
            zero_fort: dom.forte(0),
            plafond,
            combinaisons: 0,
            depasse: false,
            solutions: Vec::new(),
        }
    }

    pub fn utile(&self, v: usize) -> bool {
        self.utiles[v]
    }

    pub fn coefs_groupe(&self, g: usize) -> &[(String, Coef)] {
        &self.coefs_groupes[g]
    }

    fn compter(&mut self, n: u64) -> bool {
        self.combinaisons += n;
        if self.combinaisons > self.plafond {
            self.depasse = true;
        }
        !self.depasse
    }

    pub fn etat_initial(&self) -> Etat {
        let s = self
            .m
            .vars
            .iter()
            .enumerate()
            .map(|(i, v)| {
                if !v.present || !self.utiles[i] {
                    Some(Val { v: 0, absent: true, faible: false })
                } else {
                    None
                }
            })
            .collect();
        Etat { s, g: vec![None; self.m.groupes.len()] }
    }

    fn valeur(&self, e: &Etat, u: Unite) -> Option<i64> {
        match u {
            Unite::S(i) => e.s[i].map(|v| v.v),
            Unite::M(g) => e.g[g].as_ref().map(|s| s.somme_m),
            Unite::B(g) => e.g[g].as_ref().map(|s| s.somme_b),
        }
    }

    fn present(&self, e: &Etat, i: usize) -> Option<i64> {
        e.s[i].and_then(|v| if v.absent { None } else { Some(v.v) })
    }

    /// Le statut d'une contrainte dans un état.
    pub fn evaluer(&self, e: &Etat, c: &Contrainte) -> Eval {
        let tol = self.tol;
        match c {
            Contrainte::Lin { termes } => {
                let mut s: i128 = 0;
                for &(u, k) in termes {
                    match self.valeur(e, u) {
                        Some(v) => s += v as i128 * k as i128,
                        None => return Eval::Inconnu,
                    }
                }
                if s == 0 {
                    Eval::Ok
                } else {
                    Eval::Echec
                }
            }
            Contrainte::Produit { total, facteurs } => {
                let mut tout = vec![*total];
                tout.extend(facteurs.iter().copied());
                if tout.iter().any(|&i| e.s[i].is_none()) {
                    return Eval::Inconnu;
                }
                if tout.iter().any(|&i| e.s[i].unwrap().absent) {
                    return Eval::NonEvaluable;
                }
                let p = self.produit(facteurs.iter().map(|&i| e.s[i].unwrap().v));
                if (p - e.s[*total].unwrap().v as i128).abs() <= tol as i128 {
                    Eval::Ok
                } else {
                    Eval::Echec
                }
            }
            Contrainte::Taux { m, b, bareme } => match (e.s[*m], e.s[*b]) {
                (Some(vm), Some(vb)) => {
                    if vm.absent || vb.absent {
                        return Eval::NonEvaluable;
                    }
                    if self.baremes[bareme].iter().any(|(_, _, k)| (k.applique(vb.v) - vm.v).abs() <= tol) {
                        Eval::Ok
                    } else {
                        Eval::Echec
                    }
                }
                _ => Eval::Inconnu,
            },
            Contrainte::Charge { m, admis, taux_ppm, base, .. } => {
                let vm = match e.s[*m] {
                    Some(v) => v,
                    None => return Eval::Inconnu,
                };
                if vm.absent {
                    return Eval::NonEvaluable;
                }
                if !admis.is_empty() {
                    return if admis.contains(&vm.v) { Eval::Ok } else { Eval::Echec };
                }
                match (taux_ppm, base) {
                    (Some(t), Some(b)) => match e.s[*b] {
                        None => Eval::Inconnu,
                        Some(vb) if vb.absent => Eval::NonEvaluable,
                        Some(vb) => {
                            if (Coef::ppm(*t).applique(vb.v) - vm.v).abs() <= tol {
                                Eval::Ok
                            } else {
                                Eval::Echec
                            }
                        }
                    },
                    _ => Eval::NonEvaluable,
                }
            }
            Contrainte::Groupe { g } => {
                let sol = match &e.g[*g] {
                    Some(s) => s,
                    None => return Eval::Inconnu,
                };
                let gr = &self.m.groupes[*g];
                let mut connu = true;
                if let Some(tb) = gr.total_base {
                    match e.s[tb] {
                        None => connu = false,
                        // exonération partielle : une part strictement positive du total, de son signe
                        Some(v) if !v.absent && sol.partielle => {
                            if !partie_stricte(sol.somme_b, v.v) {
                                return Eval::Echec;
                            }
                        }
                        Some(v) if !v.absent && !sol.exoneration && v.v != sol.somme_b => return Eval::Echec,
                        _ => {}
                    }
                }
                if let Some(tm) = gr.total_montant {
                    match e.s[tm] {
                        None => connu = false,
                        Some(v) if !v.absent && v.v != sol.somme_m => return Eval::Echec,
                        _ => {}
                    }
                }
                if connu {
                    Eval::Ok
                } else {
                    Eval::Inconnu
                }
            }
        }
    }

    /// Produit de montants en unités mineures, ramené à l'échelle des décimales du pack.
    fn produit(&self, f: impl Iterator<Item = i64>) -> i128 {
        let echelle = 10i128.pow(self.decimales);
        let mut p: i128 = 1;
        for (n, x) in f.enumerate() {
            p = if n == 0 { x as i128 } else { div_arrondi(p * x as i128, echelle) };
        }
        p
    }

    // ---------- La recherche ----------

    pub fn chercher(&mut self) {
        let e = self.etat_initial();
        self.noeud(e);
    }

    fn noeud(&mut self, e: Etat) {
        if self.depasse {
            return;
        }
        for cp in &self.m.contraintes {
            if self.evaluer(&e, &cp.c) == Eval::Echec {
                return;
            }
        }
        if let Some(branches) = self.determiner(&e) {
            for b in branches {
                if !self.compter(1) {
                    return;
                }
                self.noeud(b);
            }
            return;
        }
        if let Some(branches) = self.libre(&e) {
            for b in branches {
                if !self.compter(1) {
                    return;
                }
                self.noeud(b);
            }
            return;
        }
        // Tout est affecté et aucune contrainte n'échoue : une solution.
        let faible = e.s.iter().any(|v| v.is_some_and(|v| !v.absent && v.faible))
            || e.g.iter().any(|g| g.as_ref().is_some_and(|g| g.faible));
        let exige = e.g.iter().any(|g| g.as_ref().is_some_and(|g| g.exige_forte));
        if exige && faible {
            return;
        }
        self.solutions.push(Solution { etat: e, faible });
    }

    fn avec_scalaire(&self, e: &Etat, i: usize, cands: Vec<(i64, bool)>) -> Vec<Etat> {
        let r = &self.restreints[i];
        cands
            .into_iter()
            .filter(|(v, _)| r.as_ref().is_none_or(|r| r.contains(v)))
            .map(|(v, faible)| {
                let mut n = e.clone();
                n.s[i] = Some(Val { v, absent: false, faible });
                n
            })
            .collect()
    }

    fn avec_groupe(&self, e: &Etat, g: usize, sols: Vec<SolGroupe>) -> Vec<Etat> {
        sols.into_iter()
            .map(|s| {
                let mut n = e.clone();
                n.g[g] = Some(Rc::new(s));
                n
            })
            .collect()
    }

    fn exact(&self, v: i64) -> Vec<(i64, bool)> {
        self.dom.faible(v).map(|f| vec![(v, f)]).unwrap_or_default()
    }

    fn somme_b_connue(&self, e: &Etat, g: usize) -> Option<i64> {
        self.m.groupes[g].total_base.and_then(|t| self.present(e, t))
    }

    fn somme_m_connue(&self, e: &Etat, g: usize) -> Option<i64> {
        self.m.groupes[g].total_montant.and_then(|t| self.present(e, t))
    }

    /// Une variable déterminée par une contrainte dont tous les autres termes sont connus.
    /// Les déterminations scalaires passent avant celles des groupes (plus coûteuses).
    fn determiner(&mut self, e: &Etat) -> Option<Vec<Etat>> {
        let tol = self.tol;
        let modele: &'a Modele = self.m;
        let mut groupe_a_resoudre: Option<(usize, Option<i64>, Option<i64>)> = None;
        for cp in &modele.contraintes {
            match &cp.c {
                Contrainte::Lin { termes } => {
                    let inconnues: Vec<&(Unite, i64)> =
                        termes.iter().filter(|(u, _)| self.valeur(e, *u).is_none()).collect();
                    if inconnues.len() != 1 {
                        continue;
                    }
                    let (u, _) = *inconnues[0];
                    let reste: i128 = termes
                        .iter()
                        .filter(|(x, _)| *x != u)
                        .map(|(x, c)| self.valeur(e, *x).unwrap() as i128 * *c as i128)
                        .sum();
                    // k = ±1 : u = −reste / k ; un même terme répété se cumule
                    let coef: i64 = termes.iter().filter(|(x, _)| *x == u).map(|(_, c)| *c).sum();
                    if coef == 0 || reste % coef as i128 != 0 {
                        return Some(Vec::new());
                    }
                    let v = (-reste / coef as i128) as i64;
                    match u {
                        Unite::S(i) => return Some(self.avec_scalaire(e, i, self.exact(v))),
                        Unite::M(g) => {
                            if groupe_a_resoudre.is_none() {
                                groupe_a_resoudre = Some((g, Some(v), self.somme_b_connue(e, g)));
                            }
                        }
                        Unite::B(g) => {
                            if groupe_a_resoudre.is_none() {
                                groupe_a_resoudre = Some((g, self.somme_m_connue(e, g), Some(v)));
                            }
                        }
                    }
                }
                Contrainte::Charge { m, admis, taux_ppm, base, .. } => {
                    if e.s[*m].is_none() {
                        if !admis.is_empty() {
                            let cands = admis.iter().flat_map(|f| self.exact(*f)).collect();
                            return Some(self.avec_scalaire(e, *m, cands));
                        }
                        if let (Some(t), Some(b)) = (taux_ppm, base) {
                            if let Some(vb) = e.s[*b] {
                                if !vb.absent {
                                    let c = Coef::ppm(*t).applique(vb.v);
                                    return Some(self.avec_scalaire(e, *m, self.dom.entre(c - tol, c + tol)));
                                }
                            }
                        }
                    } else if let (Some(t), Some(b)) = (taux_ppm, base) {
                        let vm = e.s[*m].unwrap();
                        if e.s[*b].is_none() && !vm.absent && *t > 0 {
                            let (lo, hi) = Coef::ppm(*t).bases_a_tolerance(vm.v, tol);
                            return Some(self.avec_scalaire(e, *b, self.dom.entre(lo, hi)));
                        }
                    }
                }
                Contrainte::Taux { m, b, bareme } => {
                    let coefs: Vec<Coef> =
                        self.baremes[bareme].iter().filter(|(_, p, _)| *p > 0).map(|(_, _, k)| *k).collect();
                    match (e.s[*m], e.s[*b]) {
                        (None, Some(vb)) if !vb.absent => {
                            let mut c: Vec<(i64, bool)> = Vec::new();
                            for k in &coefs {
                                let x = k.applique(vb.v);
                                c.extend(self.dom.entre(x - tol, x + tol));
                            }
                            // un taux nul du barème : montant nul
                            if self.baremes[bareme].iter().any(|(_, p, _)| *p == 0) {
                                c.extend(self.dom.entre(-tol, tol));
                            }
                            c.sort();
                            c.dedup();
                            return Some(self.avec_scalaire(e, *m, c));
                        }
                        (Some(vm), None) if !vm.absent => {
                            let mut c: Vec<(i64, bool)> = Vec::new();
                            for k in &coefs {
                                let (lo, hi) = k.bases_a_tolerance(vm.v, tol);
                                c.extend(self.dom.entre(lo, hi));
                            }
                            c.sort();
                            c.dedup();
                            return Some(self.avec_scalaire(e, *b, c));
                        }
                        _ => {}
                    }
                }
                Contrainte::Produit { total, facteurs } => {
                    let inconnus: Vec<usize> = std::iter::once(*total)
                        .chain(facteurs.iter().copied())
                        .filter(|&i| e.s[i].is_none())
                        .collect();
                    if inconnus.len() != 1 {
                        continue;
                    }
                    let i = inconnus[0];
                    if i == *total {
                        if facteurs.iter().any(|&f| e.s[f].unwrap().absent) {
                            continue;
                        }
                        let p = self.produit(facteurs.iter().map(|&f| e.s[f].unwrap().v)) as i64;
                        return Some(self.avec_scalaire(e, i, self.dom.entre(p - tol, p + tol)));
                    }
                    // un facteur : la division donne une fenêtre, la vérification reste exacte
                    let vt = e.s[*total].unwrap();
                    if vt.absent || facteurs.iter().any(|&f| f != i && e.s[f].unwrap().absent) {
                        continue;
                    }
                    let autres: Vec<i64> = facteurs.iter().filter(|&&f| f != i).map(|&f| e.s[f].unwrap().v).collect();
                    let echelle = 10i128.pow(self.decimales);
                    let p_autres: i128 = if autres.is_empty() { echelle } else { self.produit(autres.into_iter()) };
                    if p_autres == 0 {
                        continue;
                    }
                    let x = vt.v as i128 * echelle / p_autres;
                    let marge = ((tol as i128 + 1) * echelle / p_autres.abs()).abs() + 2;
                    let c = self.dom.entre((x - marge) as i64, (x + marge) as i64);
                    return Some(self.avec_scalaire(e, i, c));
                }
                Contrainte::Groupe { g } => {
                    let gr = &modele.groupes[*g];
                    match &e.g[*g] {
                        Some(sol) => {
                            if let Some(tb) = gr.total_base {
                                // une solution partielle ne naît que le total des bases connu
                                if e.s[tb].is_none() && !sol.partielle {
                                    let v = sol.somme_b;
                                    return Some(self.avec_scalaire(e, tb, self.exact(v)));
                                }
                            }
                            if let Some(tm) = gr.total_montant {
                                if e.s[tm].is_none() {
                                    let v = sol.somme_m;
                                    return Some(self.avec_scalaire(e, tm, self.exact(v)));
                                }
                            }
                        }
                        None => {
                            // déterminé seulement quand ses deux sommes sont connues ;
                            // sinon on préfère énumérer un scalaire libre, borné par le groupe
                            let (sm, sb) = (self.somme_m_connue(e, *g), self.somme_b_connue(e, *g));
                            if sm.is_some() && sb.is_some() && groupe_a_resoudre.is_none() {
                                groupe_a_resoudre = Some((*g, sm, sb));
                            }
                        }
                    }
                }
            }
        }
        if let Some((g, sm, sb)) = groupe_a_resoudre {
            let sols = self.resoudre_groupe(g, sm, sb);
            return Some(self.avec_groupe(e, g, sols));
        }
        None
    }

    /// Le degré d'un champ : le nombre de contraintes encore ouvertes qui l'emploient.
    fn degre(&self, e: &Etat, i: usize) -> usize {
        self.m
            .contraintes
            .iter()
            .filter(|cp| unites(&cp.c, self.m).contains(&Unite::S(i)) && self.evaluer(e, &cp.c) == Eval::Inconnu)
            .count()
    }

    /// Bornes d'un agrégat de montants quand la somme des bases est connue :
    /// chaque montant vaut à peu près base × taux, les bases ayant le signe de leur somme.
    fn bornes_m(&self, e: &Etat, g: usize) -> Option<(i128, i128)> {
        let sb = self.somme_b_connue(e, g)? as i128;
        let coefs = &self.coefs_groupes[g];
        if coefs.is_empty() {
            return None;
        }
        let n = self.m.groupes[g].instances_max.max(1) as i128;
        let marge = n * (2 * self.tol as i128 + 2);
        let mut lo = i128::MAX;
        let mut hi = i128::MIN;
        for (_, k) in coefs {
            let x = sb * k.num / k.den;
            lo = lo.min(x);
            hi = hi.max(x);
        }
        let (mut lo, mut hi) = (lo - marge, hi + marge);
        // exonération (totale ou partielle) : le montant peut tomber jusqu'à zéro
        if self.exo_possible(g) || self.partielle_possible(g) {
            lo = lo.min(0);
            hi = hi.max(0);
        }
        Some((lo, hi))
    }

    fn exo_possible(&self, g: usize) -> bool {
        self.exo_autorisee[g] && self.zero_fort
    }

    /// Exonération partielle : déclarée par la grille, et sa mention lue.
    fn partielle_possible(&self, g: usize) -> bool {
        self.m.groupes[g].exoneration_partielle && self.exo_autorisee[g]
    }

    /// Les candidats d'un champ libre, filtrés par les intervalles des sommes où
    /// il est la seule inconnue scalaire (les autres étant des agrégats bornés).
    fn candidats_libres(&self, e: &Etat, i: usize) -> Vec<(i64, bool)> {
        let mut lo = i128::MIN;
        let mut hi = i128::MAX;
        for cp in &self.m.contraintes {
            if let Contrainte::Lin { termes } = &cp.c {
                let k_i: i64 = termes.iter().filter(|(u, _)| *u == Unite::S(i)).map(|(_, k)| *k).sum();
                if k_i == 0 {
                    continue;
                }
                // k_i·x = −Σ autres ; les autres connus ou bornés
                let (mut slo, mut shi) = (0i128, 0i128);
                let mut borne = true;
                for &(u, k) in termes {
                    if u == Unite::S(i) {
                        continue;
                    }
                    let (a, b) = match self.valeur(e, u) {
                        Some(v) => (v as i128, v as i128),
                        None => match u {
                            Unite::M(g) => match self.bornes_m(e, g) {
                                Some(x) => x,
                                None => {
                                    borne = false;
                                    break;
                                }
                            },
                            _ => {
                                borne = false;
                                break;
                            }
                        },
                    };
                    let (a, b) = if k > 0 { (a * k as i128, b * k as i128) } else { (b * k as i128, a * k as i128) };
                    slo += a;
                    shi += b;
                }
                if !borne {
                    continue;
                }
                // x = −S / k_i
                let (xl, xh) = if k_i > 0 {
                    (-shi / k_i as i128, -slo / k_i as i128)
                } else {
                    (slo / (-k_i) as i128, shi / (-k_i) as i128)
                };
                lo = lo.max(xl - 1);
                hi = hi.min(xh + 1);
            }
        }
        if lo == i128::MIN && hi == i128::MAX {
            return self.dom.toutes();
        }
        let l = lo.max(i64::MIN as i128) as i64;
        let h = hi.min(i64::MAX as i128) as i64;
        self.dom.entre(l, h)
    }

    fn libre(&mut self, e: &Etat) -> Option<Vec<Etat>> {
        let libres: Vec<usize> = (0..e.s.len()).filter(|&i| e.s[i].is_none()).collect();
        if !libres.is_empty() {
            let i = *libres
                .iter()
                .max_by_key(|&&i| (self.degre(e, i), std::cmp::Reverse(i)))
                .unwrap();
            let c = self.candidats_libres(e, i);
            return Some(self.avec_scalaire(e, i, c));
        }
        let g = (0..e.g.len()).find(|&g| e.g[g].is_none())?;
        let sols = self.resoudre_groupe(g, self.somme_m_connue(e, g), self.somme_b_connue(e, g));
        Some(self.avec_groupe(e, g, sols))
    }

    // ---------- Les groupes de taux ----------

    /// Les instances (taux distincts, montant, base) d'un groupe compatibles avec
    /// ce qu'on sait de ses sommes.
    pub fn resoudre_groupe(&mut self, g: usize, sm: Option<i64>, sb: Option<i64>) -> Vec<SolGroupe> {
        let mut out = Vec::new();
        let modele: &'a Modele = self.m;
        let gr: &Groupe = &modele.groupes[g];
        let coefs: Vec<Coef> = self.coefs_groupes[g].iter().map(|(_, k)| *k).collect();
        let n = coefs.len();
        // Exonération : zéro instance, seulement si la mention est lue et un zéro imprimé (lectures fortes).
        if self.exo_possible(g) && sm.is_none_or(|v| v == 0) {
            out.push(SolGroupe {
                instances: Vec::new(),
                somme_m: 0,
                somme_b: sb.unwrap_or(0),
                faible: false,
                exige_forte: true,
                exoneration: true,
                partielle: false,
            });
        }
        let kmax = gr.instances_max.min(n);
        for k in 1..=kmax {
            for combo in combinaisons_k(n, k) {
                let ks: Vec<Coef> = combo.iter().map(|&i| coefs[i]).collect();
                let mut choisis = Vec::new();
                self.enumerer(&combo, &ks, sm, sb, &mut choisis, &mut out);
                if self.depasse {
                    return Vec::new();
                }
            }
        }
        // Exonération partielle : le total des bases connu, des instances dont CHAQUE base est
        // imprimée et dont la somme n'en est qu'une part stricte ; lectures fortes seulement.
        // Le reste (total − Σ bases) est la part exonérée : la pièce ne sera prouvée que si
        // les lignes la confirment (`lib.rs`).
        if let (true, Some(sb)) = (self.partielle_possible(g), sb) {
            let mut partielles = Vec::new();
            for k in 1..=kmax {
                for combo in combinaisons_k(n, k) {
                    let ks: Vec<Coef> = combo.iter().map(|&i| coefs[i]).collect();
                    let mut choisis = Vec::new();
                    self.enumerer(&combo, &ks, sm, None, &mut choisis, &mut partielles);
                    if self.depasse {
                        return Vec::new();
                    }
                }
            }
            out.extend(partielles.into_iter().filter(|s| !s.faible && partie_stricte(s.somme_b, sb)).map(|mut s| {
                s.partielle = true;
                s.exige_forte = true;
                s
            }));
        }
        // « Total seul » : le total des montants est imprimé, pas les montants par taux ;
        // deux taux, bases imprimées, lectures fortes seulement (règle verrouillée par la mesure).
        if gr.total_montant.is_some() && n >= 2 && gr.instances_max >= 2 {
            if let (Some(sm), Some(sb)) = (sm, sb) {
                self.total_seul(&coefs, sm, sb, &mut out);
            }
        }
        out
    }

    fn marge_base(&self, k: &Coef) -> f64 {
        (self.tol as f64 + 1.0) / k.reel() + self.tol as f64 + 1.0
    }

    fn enumerer(
        &mut self,
        combo: &[usize],
        ks: &[Coef],
        sm: Option<i64>,
        sb: Option<i64>,
        choisis: &mut Vec<(i64, bool)>,
        out: &mut Vec<SolGroupe>,
    ) {
        if self.depasse {
            return;
        }
        let idx = choisis.len();
        let k = ks.len();
        let reste = k - idx;
        if reste == 0 {
            self.finaliser(combo, ks, sb, choisis, out);
            return;
        }
        let partiel: i64 = choisis.iter().map(|(v, _)| *v).sum();
        let base_partielle: f64 = choisis.iter().zip(ks).map(|((v, _), c)| *v as f64 / c.reel()).sum();
        let marge_tot: f64 = ks.iter().map(|c| self.marge_base(c)).sum();
        let cands: Vec<(i64, bool)> = if reste == 1 {
            if let Some(sm) = sm {
                self.exact(sm - partiel)
            } else if let Some(sb) = sb {
                let c = ks[idx];
                let centre = (sb as f64 - base_partielle) * c.reel();
                let w = marge_tot * c.reel() + 2.0;
                self.dom.entre((centre - w).floor() as i64, (centre + w).ceil() as i64)
            } else {
                self.dom.toutes()
            }
        } else if reste == 2 && sm.is_some() && sb.is_some() {
            // deux inconnues, deux équations (Σm et Σb) : le montant est fixé à la marge près
            let (a, c) = (ks[idx], ks[idx + 1]);
            let r = (sm.unwrap() - partiel) as f64;
            let bb = sb.unwrap() as f64 - base_partielle;
            let d = 1.0 / a.reel() - 1.0 / c.reel();
            if d.abs() < f64::EPSILON {
                Vec::new()
            } else {
                let centre = (bb - r / c.reel()) / d;
                let w = marge_tot / d.abs() + 2.0;
                self.dom.entre((centre - w).floor() as i64, (centre + w).ceil() as i64)
            }
        } else {
            self.dom.toutes()
        };
        // Taux encore à placer après celui-ci : bornes de leurs coefficients.
        let suivants = &ks[idx + 1..];
        let kmin = suivants.iter().map(|c| c.reel()).fold(f64::INFINITY, f64::min);
        let kmax = suivants.iter().map(|c| c.reel()).fold(0.0, f64::max);
        let retenus: Vec<(i64, bool)> = cands
            .into_iter()
            .filter(|&(v, _)| {
                if v == 0 {
                    return false;
                }
                // même signe que la somme connue, et strictement plus petit en valeur absolue tant qu'il reste des instances
                if let Some(sm) = sm {
                    if v.signum() != sm.signum() || (reste > 1 && (partiel + v).abs() >= sm.abs()) {
                        return false;
                    }
                } else if let Some(sb) = sb {
                    if v.signum() != sb.signum() {
                        return false;
                    }
                }
                // Les instances restantes doivent pouvoir combler les deux sommes :
                // reste des montants ≈ reste des bases × un taux entre kmin et kmax.
                if let (Some(sm), Some(sb), true) = (sm, sb, reste > 1) {
                    let r = (sm - partiel - v) as f64;
                    let bb = sb as f64 - base_partielle - v as f64 / ks[idx].reel();
                    if bb.signum() != (sb as f64).signum() {
                        return false;
                    }
                    let marge = marge_tot * kmax + 2.0 * (self.tol as f64 + 1.0) * reste as f64;
                    let (lo, hi) = if bb >= 0.0 { (bb * kmin, bb * kmax) } else { (bb * kmax, bb * kmin) };
                    if r < lo - marge || r > hi + marge {
                        return false;
                    }
                }
                true
            })
            .collect();
        if !self.compter(retenus.len() as u64) {
            return;
        }
        for (v, faible) in retenus {
            choisis.push((v, faible));
            self.enumerer(combo, ks, sm, sb, choisis, out);
            choisis.pop();
        }
    }

    fn finaliser(&mut self, combo: &[usize], ks: &[Coef], sb: Option<i64>, vs: &[(i64, bool)], out: &mut Vec<SolGroupe>) {
        let tol = self.tol;
        let somme_m: i64 = vs.iter().map(|(v, _)| *v).sum();
        let faible_m = vs.iter().any(|(_, f)| *f);
        let mk = |bases: &[Option<i64>]| -> Vec<Instance> {
            combo
                .iter()
                .zip(vs)
                .zip(bases)
                .map(|((&t, (v, _)), b)| Instance { taux: t, m: Some(*v), m_calcule: *v, b: *b })
                .collect()
        };
        // Un seul taux : la base est la somme des bases.
        if ks.len() == 1 {
            if let Some(sb) = sb {
                if (ks[0].applique(sb) - vs[0].0).abs() <= tol {
                    let b = self.dom.faible(sb).map(|_| sb);
                    out.push(SolGroupe {
                        instances: mk(&[b]),
                        somme_m,
                        somme_b: sb,
                        faible: faible_m,
                        exige_forte: false,
                        exoneration: false,
                        partielle: false,
                    });
                }
                return;
            }
        }
        // Bases imprimées candidates, par instance.
        let imprimees: Vec<Vec<(i64, bool)>> = ks
            .iter()
            .zip(vs)
            .map(|(c, (v, _))| {
                let (lo, hi) = c.bases_a_tolerance(*v, tol);
                self.dom.entre(lo, hi).into_iter().filter(|(b, _)| *b != 0 && b.signum() == v.signum()).collect()
            })
            .collect();
        let mut combos_bases: Vec<(Vec<i64>, bool)> = Vec::new();
        let mut cur = Vec::new();
        produit_cartesien(&imprimees, 0, &mut cur, false, &mut combos_bases);
        if !self.compter(combos_bases.len() as u64) {
            return;
        }
        match sb {
            Some(sb) => {
                if let Some((bases, fb)) = combos_bases.iter().find(|(b, _)| b.iter().sum::<i64>() == sb) {
                    let bs: Vec<Option<i64>> = bases.iter().map(|b| Some(*b)).collect();
                    out.push(SolGroupe {
                        instances: mk(&bs),
                        somme_m,
                        somme_b: sb,
                        faible: faible_m || *fb,
                        exige_forte: false,
                        exoneration: false,
                        partielle: false,
                    });
                    return;
                }
                // Bases déduites : il existe des bases entières, chacune donnant son montant
                // à l'arrondi près (élargies de la tolérance), dont la somme vaut sb exactement.
                let (mut lo, mut hi) = (0i64, 0i64);
                for (c, (v, _)) in ks.iter().zip(vs) {
                    let (l, h) = c.bases_deduites(*v, tol);
                    lo += l;
                    hi += h;
                }
                if lo <= sb && sb <= hi {
                    let bs = vec![None; ks.len()];
                    out.push(SolGroupe {
                        instances: mk(&bs),
                        somme_m,
                        somme_b: sb,
                        faible: faible_m,
                        exige_forte: false,
                        exoneration: false,
                        partielle: false,
                    });
                }
            }
            None => {
                // Sans somme des bases connue, chaque base doit être imprimée.
                for (bases, fb) in combos_bases {
                    let bs: Vec<Option<i64>> = bases.iter().map(|b| Some(*b)).collect();
                    out.push(SolGroupe {
                        instances: mk(&bs),
                        somme_m,
                        somme_b: bases.iter().sum(),
                        faible: faible_m || fb,
                        exige_forte: false,
                        exoneration: false,
                        partielle: false,
                    });
                }
            }
        }
    }

    fn total_seul(&mut self, coefs: &[Coef], sm: i64, sb: i64, out: &mut Vec<SolGroupe>) {
        let fortes: Vec<i64> = self
            .dom
            .toutes()
            .into_iter()
            .filter(|(b, f)| !*f && *b != 0 && b.signum() == sb.signum() && b.abs() < sb.abs())
            .map(|(b, _)| b)
            .collect();
        for combo in combinaisons_k(coefs.len(), 2) {
            let (c1, c2) = (coefs[combo[0]], coefs[combo[1]]);
            if !self.compter(fortes.len() as u64) {
                return;
            }
            for &b1 in &fortes {
                let b2 = sb - b1;
                if !self.dom.forte(b2) {
                    continue;
                }
                let (t1, t2) = (c1.applique(b1), c2.applique(b2));
                if (t1 + t2 - sm).abs() <= 2 * self.tol {
                    out.push(SolGroupe {
                        instances: vec![
                            Instance { taux: combo[0], m: None, m_calcule: t1, b: Some(b1) },
                            Instance { taux: combo[1], m: None, m_calcule: t2, b: Some(b2) },
                        ],
                        somme_m: sm,
                        somme_b: sb,
                        faible: false,
                        exige_forte: true,
                        exoneration: false,
                        partielle: false,
                    });
                }
            }
        }
    }
}

/// `partie` est une part stricte de `total` : même signe, non nulle, plus petite en valeur absolue.
fn partie_stricte(partie: i64, total: i64) -> bool {
    partie != 0 && partie.signum() == total.signum() && partie.abs() < total.abs()
}

fn produit_cartesien(l: &[Vec<(i64, bool)>], i: usize, cur: &mut Vec<(i64, bool)>, faible: bool, out: &mut Vec<(Vec<i64>, bool)>) {
    if i == l.len() {
        out.push((cur.iter().map(|(b, _)| *b).collect(), faible));
        return;
    }
    for &(b, f) in &l[i] {
        cur.push((b, f));
        produit_cartesien(l, i + 1, cur, faible || f, out);
        cur.pop();
    }
}

/// Les unités qu'une contrainte emploie.
pub fn unites(c: &Contrainte, m: &Modele) -> Vec<Unite> {
    match c {
        Contrainte::Lin { termes } => termes.iter().map(|(u, _)| *u).collect(),
        Contrainte::Produit { total, facteurs } => {
            std::iter::once(Unite::S(*total)).chain(facteurs.iter().map(|&f| Unite::S(f))).collect()
        }
        Contrainte::Taux { m, b, .. } => vec![Unite::S(*m), Unite::S(*b)],
        Contrainte::Charge { m, base, .. } => {
            let mut v = vec![Unite::S(*m)];
            if let Some(b) = base {
                v.push(Unite::S(*b));
            }
            v
        }
        Contrainte::Groupe { g } => {
            let gr = &m.groupes[*g];
            let mut v = vec![Unite::M(*g), Unite::B(*g)];
            if let Some(t) = gr.total_base {
                v.push(Unite::S(t));
            }
            if let Some(t) = gr.total_montant {
                v.push(Unite::S(t));
            }
            v
        }
    }
}

/// La clé de déduplication d'une solution : les valeurs des champs et, pour les
/// groupes, les couples (taux, montant). Les bases n'y entrent pas.
pub type Cle = (Vec<Option<i64>>, Vec<Vec<(usize, i64)>>);

pub fn cle(e: &Etat) -> Cle {
    let s = e.s.iter().map(|v| v.and_then(|v| if v.absent { None } else { Some(v.v) })).collect();
    let g = e
        .g
        .iter()
        .map(|g| {
            let mut v: Vec<(usize, i64)> =
                g.as_ref().map(|g| g.instances.iter().map(|i| (i.taux, i.m_calcule)).collect()).unwrap_or_default();
            v.sort();
            v
        })
        .collect();
    (s, g)
}
