//! Le moteur en natif, pour le banc sans IA (`apps/api/src/malica/lecture/banc-sans-ia.ts`,
//! option `--moteur-natif`) : une entrée du contrat sur l'entrée standard, la sortie du
//! contrat sur la sortie standard. Le même code que le WebAssembly ; il sert là où la
//! cible `wasm32` ne s'installe pas, et à mesurer une correction avant de la construire.
use std::io::Read;

fn main() {
    let mut entree = String::new();
    std::io::stdin()
        .read_to_string(&mut entree)
        .expect("entrée standard illisible");
    print!("{}", malica_sudoku::solve(&entree));
}
