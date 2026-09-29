# Pulse

Journal de trading pour Windows, 100 % local (Tauri 2 + React + SQLite).

- Cahier des charges : [`docs/cahier-des-charges.md`](docs/cahier-des-charges.md)
- Charte graphique : [`docs/charte-graphique.md`](docs/charte-graphique.md)
- Maquettes : [`docs/maquettes/`](docs/maquettes/)

## Structure

| Dossier | Rôle |
|---|---|
| `src/` | Interface React + TypeScript + Tailwind (tokens de la charte) |
| `src-tauri/` | Coque Tauri : fenêtre, commandes IPC |
| `crates/pulse-core/` | Cœur Rust sans dépendance UI : SQLite, migrations, logique métier (testable partout) |

Les données sont stockées dans un fichier SQLite (`pulse.db`) dans le dossier de données de l'application. Une sauvegarde est créée automatiquement avant toute migration de schéma (`backups/`).

## Développement

Prérequis : Node 22+, Rust stable, et les [prérequis Tauri](https://tauri.app/start/prerequisites/) de votre système.

```bash
npm ci
npm run tauri dev      # application complète
npm run dev            # interface seule dans un navigateur (API simulée en mémoire)
```

## Vérifications

```bash
npm run typecheck
npm test               # tests de l'interface (vitest)
cargo test -p pulse-core
```

## Installeur Windows

Construit par GitHub Actions (`.github/workflows/build-windows.yml`) : lancer le workflow « Build Windows installer » (bouton *Run workflow*), puis télécharger l'artefact `pulse-windows-installer` (fichier `.exe`).
En local sous Windows : `npm run tauri build` → `target/release/bundle/nsis/`.

## Règles de migration de base de données

Ne jamais modifier une migration déjà livrée : en ajouter une nouvelle à la fin de `MIGRATIONS` dans `crates/pulse-core/src/migrations.rs`.
