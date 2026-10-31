//! Le sudoku : attribuer les valeurs lues d'une pièce aux champs de sa grille
//! par les seules relations de la grille et les paramètres du pack.
//!
//! Contrat : `docs/sudoku/contrat-du-moteur.md` (§2 langage des preuves, §3 entrée,
//! §4 sortie). Le moteur ne lit aucun montant lui-même (il reçoit `montants`
//! déjà lus par jeton) et ne porte aucune constante réglementaire (R4) : taux,
//! charges, formats et libellés arrivent en entrée. Toute valeur rendue cite le
//! jeton qui la porte (R2).

mod entree;
mod modele;
mod numerique;
mod reperes;
mod textuel;
mod valeurs;

use entree::Entree;
use modele::{Contrainte, Modele, NonNumerique};
use numerique::{cle, Etat, Eval, Solution, Solveur};
use reperes::{reperes_de, Plan};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use textuel::Issue;
use valeurs::Domaine;

/// Plafond de combinaisons par défaut, quand l'entrée n'en fixe pas.
const PLAFOND_DEFAUT: u64 = 200_000;

#[derive(Serialize, Clone)]
pub struct RefJeton {
    pub page: u32,
    pub ordinal: u32,
}

#[derive(Serialize)]
pub struct InstanceSortie {
    /// Code du taux dans le barème du pack.
    pub taux: String,
    pub valeur: Option<String>,
    pub refs: Vec<RefJeton>,
}

#[derive(Serialize)]
pub struct ChampSortie {
    pub valeur: Option<String>,
    pub refs: Vec<RefJeton>,
    pub statut: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instances: Option<Vec<InstanceSortie>>,
}

#[derive(Serialize)]
pub struct Sortie {
    pub issue: String,
    pub solutions: usize,
    pub champs: BTreeMap<String, ChampSortie>,
    pub preuves: BTreeMap<String, String>,
    pub combinaisons: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raison: Option<String>,
}

fn erreur(m: String) -> String {
    let s = Sortie {
        issue: "aucune".into(),
        solutions: 0,
        champs: BTreeMap::new(),
        preuves: BTreeMap::new(),
        combinaisons: 0,
        raison: Some(m),
    };
    serde_json::to_string(&s).unwrap_or_default()
}

/// Point d'entrée : JSON du contrat §3 en entrée, JSON du contrat §4 en sortie.
pub fn solve(input_json: &str) -> String {
    let entree: Entree = match serde_json::from_str(input_json) {
        Ok(e) => e,
        Err(e) => return erreur(format!("entrée invalide : {e}")),
    };
    match resoudre(&entree) {
        Ok(s) => serde_json::to_string(&s).unwrap_or_else(|e| erreur(format!("sortie : {e}"))),
        Err(m) => erreur(m),
    }
}

fn resoudre(entree: &Entree) -> Result<Sortie, String> {
    let grille = &entree.grille;
    let plan = Plan::new(&entree.jetons);
    let dom = Domaine::new(&entree.jetons);
    let mut modele: Modele = modele::construire(entree);
    let reperes: Vec<Vec<String>> = grille.champs.iter().map(reperes_de).collect();

    // Présence des champs facultatifs, décidée avant la recherche.
    let fixes: BTreeMap<usize, i64> = modele
        .contraintes
        .iter()
        .filter_map(|cp| match cp.c {
            Contrainte::Charge { m, fixe: Some(f), .. } => Some((m, f)),
            _ => None,
        })
        .collect();
    for (i, v) in modele.vars.iter_mut().enumerate() {
        if v.facultatif {
            let annonce = plan.annonce(&reperes[v.champ]);
            let fixe_imprime = fixes.get(&i).is_some_and(|f| dom.forte(*f));
            v.present = annonce || fixe_imprime;
        }
    }
    let exo: Vec<bool> = modele
        .groupes
        .iter()
        .map(|g| g.exoneration.is_some_and(|c| plan.annonce(&reperes[c])))
        .collect();

    // Un champ que seules des sommes exactes contraignent peut prendre n'importe quel
    // jeton : quand son libellé ancre des jetons porteurs de montants (sur le jeton
    // lui-même ou juste à gauche), il ne prend que ceux-là.
    let restreints: Vec<Option<BTreeSet<i64>>> = (0..modele.vars.len())
        .map(|i| {
            let somme_seule = modele.contraintes.iter().all(|cp| match &cp.c {
                Contrainte::Lin { .. } => true,
                c => !numerique::unites(c, &modele).contains(&modele::Unite::S(i)),
            });
            if !somme_seule {
                return None;
            }
            let champ = modele.vars[i].champ;
            let ancrees: BTreeSet<i64> = dom
                .valeurs
                .iter()
                .filter(|(_, val)| val.occurrences.iter().any(|o| plan.ancre(o.jeton, &reperes[champ], None, false)))
                .map(|(v, _)| *v)
                .collect();
            if ancrees.is_empty() {
                None
            } else {
                Some(ancrees)
            }
        })
        .collect();

    let plafond = entree.plafond.unwrap_or(PLAFOND_DEFAUT);
    let mut s = Solveur::new(&modele, &dom, &entree.pack, exo, restreints, plafond);
    let a_chercher = !modele.contraintes.is_empty();
    if a_chercher {
        s.chercher();
    }

    // Déduplication : une même solution par deux chemins n'en fait qu'une, la plus forte.
    let mut uniques: BTreeMap<_, Solution> = BTreeMap::new();
    for sol in s.solutions.drain(..) {
        let k = cle(&sol.etat);
        match uniques.get(&k) {
            Some(x) if !x.faible || sol.faible => {}
            _ => {
                uniques.insert(k, sol);
            }
        }
    }
    let toutes: Vec<Solution> = uniques.into_values().collect();
    // Une solution qui ne s'appuie que sur des lectures fortes l'emporte.
    let fortes: Vec<Solution> = toutes.iter().filter(|x| !x.faible).cloned().collect();
    let retenues = if fortes.is_empty() { toutes } else { fortes };

    let unique: Option<&Etat> = if retenues.len() == 1 { Some(&retenues[0].etat) } else { None };
    let mut issue = match retenues.len() {
        0 => "aucune",
        1 => "prouvee",
        _ => "ambigue",
    }
    .to_string();
    let mut raison = None;
    if s.depasse {
        issue = "aucune".into();
        raison = Some(format!("plafond de {plafond} combinaisons atteint"));
    } else if !a_chercher {
        raison = Some("aucune preuve arithmétique exécutable".into());
    }

    // Statut de chaque contrainte dans la solution unique.
    let evals: Vec<Eval> = match unique {
        Some(e) if !s.depasse => modele.contraintes.iter().map(|cp| s.evaluer(e, &cp.c)).collect(),
        _ => vec![Eval::Inconnu; modele.contraintes.len()],
    };
    // toutes les contraintes numériques sont arithmétiques : il en faut au moins une vérifiée
    if issue == "prouvee" && !evals.contains(&Eval::Ok) {
        issue = "aucune".into();
        raison = Some("aucune preuve arithmétique vérifiée".into());
    }
    let prouvee = issue == "prouvee";

    // ---------- Les champs ----------
    let mut champs: BTreeMap<String, ChampSortie> = BTreeMap::new();
    let cite = |v: i64, champ: usize| -> Vec<RefJeton> {
        let occ = match dom.valeurs.get(&v) {
            Some(x) => &x.occurrences,
            None => return Vec::new(),
        };
        // l'occurrence ancrée au libellé du champ, puis forte, puis la plus basse de la dernière page
        let best = occ.iter().max_by(|a, b| {
            let ja = &entree.jetons[a.jeton];
            let jb = &entree.jetons[b.jeton];
            let ka = (plan.ancre(a.jeton, &reperes[champ], None, false), a.forte, ja.page);
            let kb = (plan.ancre(b.jeton, &reperes[champ], None, false), b.forte, jb.page);
            ka.cmp(&kb)
                .then(ja.y0.partial_cmp(&jb.y0).unwrap_or(std::cmp::Ordering::Equal))
                .then(ja.ordinal.cmp(&jb.ordinal))
        });
        best.map(|o| {
            let j = &entree.jetons[o.jeton];
            vec![RefJeton { page: j.page, ordinal: j.ordinal }]
        })
        .unwrap_or_default()
    };
    let signale = || ChampSortie { valeur: None, refs: Vec::new(), statut: "signale".into(), instances: None };
    let absent = || ChampSortie { valeur: None, refs: Vec::new(), statut: "absent".into(), instances: None };

    for (i, v) in modele.vars.iter().enumerate() {
        if !s.utile(i) {
            continue;
        }
        let code = grille.champs[v.champ].code.clone();
        let sortie = match unique {
            Some(e) if prouvee => match e.s[i] {
                Some(x) if !x.absent => {
                    let dans_preuve = modele.contraintes.iter().zip(&evals).any(|(cp, ev)| {
                        *ev == Eval::Ok && numerique::unites(&cp.c, &modele).contains(&modele::Unite::S(i))
                    });
                    ChampSortie {
                        valeur: Some(x.v.to_string()),
                        refs: cite(x.v, v.champ),
                        statut: if dans_preuve { "prouve" } else { "signale" }.into(),
                        instances: None,
                    }
                }
                _ => absent(),
            },
            _ => {
                if v.present {
                    signale()
                } else {
                    absent()
                }
            }
        };
        champs.insert(code, sortie);
    }
    for (g, gr) in modele.groupes.iter().enumerate() {
        let coefs = s.coefs_groupe(g);
        for (champ, est_base) in [(gr.champ_base, true), (gr.champ_montant, false)] {
            let code = grille.champs[champ].code.clone();
            let sortie = match unique {
                Some(e) if prouvee => {
                    let sol = e.g[g].as_ref().expect("groupe résolu");
                    if sol.exoneration {
                        if est_base {
                            absent()
                        } else {
                            ChampSortie {
                                valeur: Some("0".into()),
                                refs: cite(0, champ),
                                statut: "prouve".into(),
                                instances: Some(Vec::new()),
                            }
                        }
                    } else {
                        let inst = sol
                            .instances
                            .iter()
                            .map(|it| {
                                let v = if est_base { it.b } else { it.m };
                                InstanceSortie {
                                    taux: coefs[it.taux].0.clone(),
                                    valeur: v.map(|x| x.to_string()),
                                    refs: v.map(|x| cite(x, champ)).unwrap_or_default(),
                                }
                            })
                            .collect();
                        ChampSortie { valeur: None, refs: Vec::new(), statut: "prouve".into(), instances: Some(inst) }
                    }
                }
                _ => signale(),
            };
            champs.insert(code, sortie);
        }
    }

    // Les champs non numériques.
    let mut lus: BTreeMap<usize, String> = BTreeMap::new();
    for (c, champ) in grille.champs.iter().enumerate() {
        if !textuel::traite(champ, &entree.pack) {
            continue;
        }
        let sortie = match textuel::lire(champ, &entree.pack, &plan)? {
            Issue::Conforme(l) => {
                lus.insert(c, l.valeur.clone());
                let j = &entree.jetons[l.jeton];
                ChampSortie {
                    valeur: Some(l.valeur),
                    refs: vec![RefJeton { page: j.page, ordinal: j.ordinal }],
                    statut: "conforme".into(),
                    instances: None,
                }
            }
            Issue::Signale => signale(),
            Issue::Absent => absent(),
        };
        champs.insert(champ.code.clone(), sortie);
    }

    // ---------- Les preuves ----------
    let mut preuves: BTreeMap<String, String> = BTreeMap::new();
    for i in modele.non_traduites.keys() {
        preuves.insert(grille.preuves[*i].code.clone(), "non_evaluable".into());
    }
    for (cp, ev) in modele.contraintes.iter().zip(&evals) {
        let st = if s.depasse {
            "non_fermee"
        } else if prouvee {
            match ev {
                Eval::Ok => "verifiee",
                Eval::NonEvaluable => "non_evaluable",
                Eval::Echec => "echec",
                Eval::Inconnu => "non_evaluable",
            }
        } else if issue == "ambigue" {
            "indeterminee"
        } else {
            "non_fermee"
        };
        preuves.insert(grille.preuves[cp.preuve].code.clone(), st.into());
    }
    for (p, nn) in &modele.non_numeriques {
        let st = match nn {
            NonNumerique::Format { champ, format } => match (lus.get(champ), entree.pack.formats.get(format)) {
                (Some(v), Some(motif)) => {
                    if textuel::respecte(v, motif)? {
                        "verifiee"
                    } else {
                        "echec"
                    }
                }
                _ => "non_evaluable",
            },
            NonNumerique::Ordre { avant, apres } => match (lus.get(avant), lus.get(apres)) {
                (Some(a), Some(b)) => {
                    if a <= b {
                        "verifiee"
                    } else {
                        "echec"
                    }
                }
                _ => "non_evaluable",
            },
        };
        preuves.insert(grille.preuves[*p].code.clone(), st.into());
    }

    Ok(Sortie {
        issue,
        solutions: retenues.len(),
        champs,
        preuves,
        combinaisons: s.combinaisons,
        raison,
    })
}

/// Exports WebAssembly, sans wasm-bindgen : l'hôte alloue, écrit l'entrée,
/// appelle `solve_json`, lit la sortie (pointeur << 32 | longueur), puis libère.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::alloc::{alloc as sys_alloc, dealloc as sys_dealloc, Layout};

    #[no_mangle]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        if len == 0 {
            return core::ptr::NonNull::<u8>::dangling().as_ptr();
        }
        match Layout::from_size_align(len, 1) {
            Ok(l) => unsafe { sys_alloc(l) },
            Err(_) => core::ptr::null_mut(),
        }
    }

    /// # Safety
    /// `ptr` doit venir de `alloc(len)` ou de `solve_json`, avec la même longueur.
    #[no_mangle]
    pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
        if len == 0 || ptr.is_null() {
            return;
        }
        if let Ok(l) = Layout::from_size_align(len, 1) {
            sys_dealloc(ptr, l);
        }
    }

    /// # Safety
    /// `ptr` doit désigner `len` octets lisibles (l'entrée JSON en UTF-8).
    #[no_mangle]
    pub unsafe extern "C" fn solve_json(ptr: *const u8, len: usize) -> u64 {
        let octets = if len == 0 { &[][..] } else { core::slice::from_raw_parts(ptr, len) };
        let sortie = match core::str::from_utf8(octets) {
            Ok(s) => crate::solve(s),
            Err(_) => crate::erreur("entrée non UTF-8".into()),
        };
        let b = sortie.as_bytes();
        let p = alloc(b.len());
        if p.is_null() {
            return 0;
        }
        if !b.is_empty() {
            core::ptr::copy_nonoverlapping(b.as_ptr(), p, b.len());
        }
        ((p as u32 as u64) << 32) | (b.len() as u32 as u64)
    }
}
