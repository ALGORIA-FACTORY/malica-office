//! R4 : aucun taux ni montant réglementaire écrit dans le code de production.
//! Les taux de TVA (70000, 130000, 190000 ppm), le timbre (1000) et le FODEC
//! (10000 ppm) n'existent que dans les packs — ici, dans les tests.

use regex::Regex;

const INTERDITS: [i64; 5] = [70000, 130000, 190000, 1000, 10000];

/// Retire les commentaires `//…` et `/* … */`, en respectant les chaînes.
fn sans_commentaires(src: &str) -> String {
    let c: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut chaine = false;
    while i < c.len() {
        if chaine {
            out.push(c[i]);
            if c[i] == '\\' && i + 1 < c.len() {
                out.push(c[i + 1]);
                i += 2;
                continue;
            }
            if c[i] == '"' {
                chaine = false;
            }
            i += 1;
        } else if c[i] == '\'' && c.get(i + 2) == Some(&'\'') {
            // littéral de caractère : '"' ne doit pas ouvrir une chaîne
            out.extend(&c[i..i + 3]);
            i += 3;
        } else if c[i] == '\'' && c.get(i + 1) == Some(&'\\') {
            // littéral échappé ('\'', '\\', '\u{..}') : jusqu'à l'apostrophe fermante
            let fin = (i + 3..c.len()).find(|&k| c[k] == '\'').unwrap_or(c.len() - 1);
            out.extend(&c[i..=fin]);
            i = fin + 1;
        } else if c[i] == '"' {
            chaine = true;
            out.push('"');
            i += 1;
        } else if c[i] == '/' && c.get(i + 1) == Some(&'/') {
            while i < c.len() && c[i] != '\n' {
                i += 1;
            }
        } else if c[i] == '/' && c.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < c.len() && !(c[i] == '*' && c[i + 1] == '/') {
                i += 1;
            }
            i += 2;
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
}

/// Les littéraux numériques interdits d'un source (séparateurs `_` et suffixes de type compris).
fn litteraux_interdits(src: &str) -> Vec<String> {
    let re = Regex::new(r"\b(\d[\d_]*)(?:[iu](?:8|16|32|64|128|size))?\b").unwrap();
    re.captures_iter(&sans_commentaires(src))
        .filter_map(|c| {
            let n: i64 = c[1].replace('_', "").parse().ok()?;
            INTERDITS.contains(&n).then(|| c[0].to_string())
        })
        .collect()
}

/// Les sources `.rs` d'un dossier et de tous ses sous-dossiers.
fn sources_rs(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(sources_rs(&p));
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
    out
}

#[test]
fn le_detecteur_detecte() {
    assert_eq!(litteraux_interdits("let t = 190_000;"), vec!["190_000"]);
    assert_eq!(litteraux_interdits("let t = 1000i64 + 10000;"), vec!["1000i64", "10000"]);
    assert!(litteraux_interdits("// 190000\n/* 1000 */ let x = 1_000_000;").is_empty());
    assert_eq!(litteraux_interdits("let q = '\"'; let t = 70000; // 130000"), vec!["70000"]);
    assert_eq!(litteraux_interdits("let a = '\\''; let b = \"x\"; let t = 130_000;"), vec!["130_000"]);
}

#[test]
fn aucun_taux_ni_montant_reglementaire_dans_src() {
    let dir = format!("{}/src", env!("CARGO_MANIFEST_DIR"));
    let mut fautes = Vec::new();
    let sources = sources_rs(std::path::Path::new(&dir));
    // Tous les sources, sous-dossiers compris (src/lignes/milieu.rs n'était pas lu).
    assert!(sources.iter().any(|p| p.ends_with("lignes/milieu.rs")), "src/lignes/milieu.rs non lu");
    for p in &sources {
        for l in litteraux_interdits(&std::fs::read_to_string(p).unwrap()) {
            fautes.push(format!("{} : {l}", p.display()));
        }
    }
    assert!(fautes.is_empty(), "littéraux réglementaires dans le code : {fautes:?}");
}
