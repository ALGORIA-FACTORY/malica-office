//! Le sudoku : attribuer les valeurs lues d'une pièce aux champs de sa grille
//! par les seules relations de la grille et les paramètres du pack.
//!
//! Contrat : `docs/sudoku/contrat-du-moteur.md` (§2 langage des preuves, §3 entrée,
//! §4 sortie). Le moteur ne lit aucun montant lui-même (il reçoit `montants`
//! déjà lus par jeton) et ne porte aucune constante réglementaire (R4) : taux,
//! charges, formats et libellés arrivent en entrée. Toute valeur rendue cite le
//! jeton qui la porte (R2).

mod entete;
mod entree;
mod lettres;
mod lignes;
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
    /// Les lignes d'articles (anneau 1), quand la grille porte une preuve `lignes`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lignes: Option<lignes::LignesSortie>,
    /// Les parties de l'en-tête (anneau 2), quand la grille porte une preuve `parties`
    /// et que l'entrée porte le dossier (`connus`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parties: Option<entete::PartiesSortie>,
}

fn erreur(m: String) -> String {
    let s = Sortie {
        issue: "aucune".into(),
        solutions: 0,
        champs: BTreeMap::new(),
        preuves: BTreeMap::new(),
        combinaisons: 0,
        raison: Some(m),
        lignes: None,
        parties: None,
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
    // Une CHARGE du pack (timbre, FODEC) est exigée dès que son libellé est lu, même
    // sans montant à côté : c'est ce qui empêche un TTC de « fermer » sans le timbre
    // imprimé que l'OCR a manqué. Les autres champs facultatifs (retenue, acompte…)
    // ne le sont que sur une rangée chiffrée.
    let charges: BTreeSet<usize> = modele
        .contraintes
        .iter()
        .filter_map(|cp| match cp.c {
            Contrainte::Charge { m, .. } => Some(m),
            _ => None,
        })
        .collect();
    for (i, v) in modele.vars.iter_mut().enumerate() {
        if v.facultatif {
            let annonce = if charges.contains(&i) {
                plan.annonce(&reperes[v.champ])
            } else {
                plan.annonce_chiffree(&reperes[v.champ])
            };
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
    let mut prouvee = issue == "prouvee";

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
        // Deux champs de la grille portent le même format (le matricule de l'émetteur et celui
        // du client) : une valeur au format ne dit pas à quelle partie elle appartient — les
        // repères (« Matricule fiscal ») sont les mêmes. Seul l'anneau 2 (E01) l'établit ;
        // ici, elle est signalée, jamais attribuée (banc des 150 factures, 1er novembre 2026 :
        // le matricule du client lu « conforme » comme celui d'un émetteur étranger).
        let partage = champ.genre == "identifiant"
            && champ.format_code.is_some()
            && grille.champs.iter().enumerate().any(|(k, x)| k != c && x.format_code == champ.format_code);
        let sortie = match textuel::lire(champ, &entree.pack, &plan)? {
            Issue::Conforme(_) if partage => signale(),
            Issue::Conforme(l) => {
                lus.insert(c, l.valeur.clone());
                ChampSortie {
                    valeur: Some(l.valeur),
                    refs: (l.jeton..=l.fin)
                        .map(|k| RefJeton { page: entree.jetons[k].page, ordinal: entree.jetons[k].ordinal })
                        .collect(),
                    statut: "conforme".into(),
                    instances: None,
                }
            }
            Issue::Signale => signale(),
            Issue::Absent => absent(),
        };
        champs.insert(champ.code.clone(), sortie);
    }

    // ---------- L'anneau 2 : l'en-tête, par ses relations avec la base du client ----------
    // Avant les preuves `format` et `ordre`, qui lisent les champs qu'il établit.
    let mut sortie_parties = None;
    let mut statuts_parties: Vec<(String, &str)> = Vec::new();
    let mut une_preuve_parties = false;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(entete::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = if une_preuve_parties {
            // une seule preuve de parties par grille
            "non_evaluable"
        } else {
            une_preuve_parties = true;
            match entete::lire_op(grille, e) {
                Ok(op) => {
                    let r = entete::prouver(&op, entree, &mut champs);
                    for (c, v) in r.lus {
                        lus.insert(c, v);
                    }
                    sortie_parties = r.parties;
                    r.statut
                }
                Err(_) => "non_evaluable",
            }
        };
        statuts_parties.push((p.code.clone(), st));
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
    for (code, st) in statuts_parties {
        preuves.insert(code, st.into());
    }

    // ---------- L'anneau 1 : les lignes, sur la sortie du centre, sans la modifier ----------
    let mut sortie_lignes = None;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lignes::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = if sortie_lignes.is_some() {
            // une seule preuve de lignes par grille
            "non_evaluable"
        } else {
            match lignes::lire_op(grille, e) {
                Ok(op) => {
                    let (l, st) = lignes::prouver(&op, entree, &champs);
                    sortie_lignes = Some(l);
                    st
                }
                Err(_) => "non_evaluable",
            }
        };
        preuves.insert(p.code.clone(), st.into());
    }

    // ---------- L'exonération totale exige son HT ----------
    // Zéro instance : le groupe ne contraint plus le total des bases, et HT + droits = TTC
    // ferme sur n'importe quelle paire de totaux. Sur une facture à deux tranches (0 % et
    // 19 %) qui imprime « 0,000 » et « exonérée », le « Total TTC » passait pour le HT et le
    // net pour le TTC (100/B-15, 2 novembre 2026). Le HT n'est donc retenu que s'il porte
    // son libellé (repères du champ, en base), ou si les lignes le ferment exactement.
    if prouvee {
        if let Some(e) = unique {
            let mut refusee = false;
            for (g, gr) in modele.groupes.iter().enumerate() {
                if !e.g[g].as_ref().is_some_and(|x| x.exoneration) {
                    continue;
                }
                let Some(t) = gr.total_base else { continue };
                let Some(ht) = e.s[t].filter(|v| !v.absent).map(|v| v.v) else { continue };
                let champ = modele.vars[t].champ;
                let ancre = dom
                    .valeurs
                    .get(&ht)
                    .is_some_and(|x| x.occurrences.iter().any(|o| plan.libelle_avant(o.jeton, &reperes[champ])));
                let par_les_lignes = sortie_lignes.as_ref().is_some_and(|l| {
                    l.statut == "prouve"
                        && l.deduites.is_none()
                        && l.remise_globale.is_none()
                        && l.instances.iter().map(|x| x.montant.valeur.parse::<i64>().ok()).sum::<Option<i64>>() == Some(ht)
                });
                refusee |= !ancre && !par_les_lignes;
            }
            if refusee {
                prouvee = false;
                issue = "aucune".into();
                raison = Some("exonération : le total HT ne porte pas son libellé".into());
                for c in champs.values_mut() {
                    if c.statut == "prouve" {
                        c.statut = "signale".into();
                    }
                }
                for (cp, ev) in modele.contraintes.iter().zip(&evals) {
                    if *ev == Eval::Ok {
                        preuves.insert(grille.preuves[cp.preuve].code.clone(), "non_fermee".into());
                    }
                }
            }
        }
    }

    // ---------- L'anneau 3 : les champs nommés, que nulle preuve ne lit ----------
    entete::nommes(entree, &mut champs);

    // ---------- Les lettres : la seconde écriture du total ----------
    let mut contredite = false;
    for p in &grille.preuves {
        let Some(e) = p.expression.as_ref().filter(|e| e.get("op").and_then(|o| o.as_str()) == Some(lettres::OP)) else {
            continue;
        };
        if p.statut.as_deref() == Some("a_traduire") {
            continue;
        }
        let st = match lettres::lire_op(grille, e) {
            Ok(op) => {
                let valeur_prouvee = |c: usize| -> Option<i64> {
                    champs
                        .get(&grille.champs[c].code)
                        .filter(|x| x.statut == "prouve")
                        .and_then(|x| x.valeur.as_deref())
                        .and_then(|v| v.parse().ok())
                };
                let r = lettres::prouver(&op, entree, prouvee.then_some(&valeur_prouvee as &dyn Fn(usize) -> Option<i64>));
                if let Some(c) = r.champ {
                    champs.insert(grille.champs[op.champ].code.clone(), c);
                }
                r.statut
            }
            Err(_) => "non_evaluable",
        };
        contredite |= st == "echec";
        preuves.insert(p.code.clone(), st.into());
    }
    // Les chiffres ferment, les lettres les contredisent : la pièce n'est pas prouvée, elle
    // est signalée. Ses valeurs restent citées, au statut `signale`.
    if contredite && issue == "prouvee" {
        issue = "signalee".into();
        raison = Some("le montant en lettres contredit les chiffres".into());
        for c in champs.values_mut() {
            if c.statut == "prouve" {
                c.statut = "signale".into();
            }
        }
    }

    Ok(Sortie {
        issue,
        solutions: retenues.len(),
        champs,
        preuves,
        combinaisons: s.combinaisons,
        raison,
        lignes: sortie_lignes,
        parties: sortie_parties,
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
