# CLAUDE.md — Pulse

Journal de trading pour Windows, 100 % local. L'utilisateur parle **français** : répondre en français, code et identifiants en anglais. **L'interface est en français** : aucun texte en dur dans les composants, tout passe par `src/i18n/fr.ts` (`useT()`). Les maquettes de `docs/maquettes/` sont en anglais (archive). Les messages d'erreur du cœur Rust affichés à l'utilisateur seront à terme remplacés par des codes d'erreur traduits côté interface.

## Documents de référence (à lire avant de coder)

| Document | Contenu |
|---|---|
| `docs/cahier-des-charges.md` (v2.0) | Fonctionnel complet, modèle de données (section 2), modules 3.x, glossaire des formules (section 7), phasage en 5 étapes (section 5), cadrage technique (section 10) |
| `docs/charte-graphique.md` (v2.0) | Style **A+D** : tokens de couleur, rayons, ombres, composants, dataviz |
| `docs/maquettes/` | Références visuelles (HTML + PNG) : `style-ad`, `screen-form`, `screen-detail`, `screen-behavior`. Les autres styles sont de l'archive |

Le cahier des charges est la source de vérité fonctionnelle. Toute formule (R-multiple, expectancy, profit factor, drawdown, win rate…) suit le **glossaire de la section 7**, implémentée une seule fois.

## Stack et structure

- **Tauri 2** (Windows 10/11 x64) + **React 18 + TypeScript + Tailwind 3** + **SQLite** (`rusqlite`, bundled).
- `crates/pulse-core/` : cœur Rust **sans dépendance UI** (base, migrations, logique métier, stats). Tout ce qui peut y vivre doit y vivre, avec des tests.
- `src-tauri/` : coque Tauri, commandes IPC fines qui appellent `pulse-core`.
- `src/` : interface. `src/lib/api.ts` enveloppe les commandes Tauri et bascule sur un **mock en mémoire** dans un navigateur simple.
- Données : fichier `pulse.db` dans le dossier de données de l'application ; sauvegarde automatique avant migration.

## Commandes

```bash
npm ci
npm run typecheck && npm test && npm run build     # interface
cargo test -p pulse-core                           # cœur Rust
cargo check -p pulse-app                           # coque Tauri (libs WebKit requises sous Linux)
npm run dev                                        # interface seule dans un navigateur
```

Sous Linux, `cargo check -p pulse-app` demande : `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev librsvg2-dev libayatana-appindicator3-dev` (faire `apt-get update` avant). L'installeur Windows se construit uniquement via GitHub Actions (`build-windows.yml`, déclenchement manuel) : ne jamais prétendre l'avoir testé.

## Règles de développement

1. **Migrations** : ne jamais modifier une migration livrée ; ajouter à la fin de `MIGRATIONS` (`crates/pulse-core/src/migrations.rs`). Toute migration est testée (données existantes conservées).
2. **Calculs** : dans `pulse-core`, purs, testés avec des **cas à résultat connu** calculés à la main (une formule du glossaire = au moins un test nominal + cas limites : zéro trade, pas de SL, série vide). Recalculés depuis les données sources, jamais stockés en cache incohérent.
3. **Argent et prix** : décision de représentation à trancher dans le lot « schéma » et documenter ici. Les dépôts/retraits sont **toujours exclus** des indicateurs de performance (cahier 3.7.10).
4. **Interface** : couleurs et rayons uniquement via les tokens Tailwind/CSS de la charte ; chiffres tabulaires ; signes `+` / `−` (vrai signe moins) sur tout P&L ; jamais la couleur seule pour porter un sens gain/perte ; états vides soignés partout.
5. **Petits lots** : un lot = un commit clair, tests verts, typecheck vert avant de pousser.
6. **Honnêteté** : dire explicitement ce qui n'a pas été testé (ex. installeur Windows, rendu sur vrai Windows).
7. Travailler sur la branche de développement désignée par la session ; ne pas créer de pull request sans demande.

## Roadmap et avancement

Étapes du cahier des charges (section 5). Cocher au fil de l'eau.

### Étape 1 — Socle : saisir et mesurer
- [x] Lot 1 — Squelette Tauri/React/SQLite, comptes, coque UI A+D, CI, workflow d'installeur (**Sonnet, moyen**)
- [ ] Lot 2 — Schéma complet SQLite : trades, tags normalisés, règles, checklist, dépôts/retraits, trades manqués ; décision argent/prix ; migrations testées (**Opus, élevé**)
- [ ] Lot 3 — Moteur de statistiques dans `pulse-core` : PnL brut/net, win rate, R:R, expectancy, profit factor, drawdown, courbe d'équité hors dépôts, segments ; tests à résultats connus (**Opus, élevé**)
- [ ] Lot 4 — Saisie de trade (formulaire maquette `screen-form`), liste, détail (**Sonnet, moyen**)
- [ ] Lot 5 — Dashboard réel branché sur les stats, calendrier, filtres de période (**Sonnet, moyen**)
- [ ] Lot 6 — Import CSV broker (profils, doublons, annulation de lot), export CSV, sauvegarde/restauration (**Sonnet, moyen**)
- [ ] Lot 7 — Règles personnelles + checklist pré-trade (volet déclaratif), dépôts/retraits UI (**Sonnet, moyen**)

### Étapes 2 à 5
Voir `docs/cahier-des-charges.md` section 5. Points nécessitant **Opus, élevé** : score de discipline, détection de patterns comportementaux, alertes à seuils, coach IA. Le reste : Sonnet, moyen.

## Décisions déjà prises

- Application 100 % locale, aucun serveur ; IA optionnelle (clé API de l'utilisateur, coffre Windows, jamais en clair).
- Thème **sombre uniquement** en v2.0 ; réglage « Réduire les effets » prévu (charte 7).
- Police Inter embarquée. Pas de mobile.
- Repoussé en fin de projet : alerte news économiques, carte de trade partageable, export PDF.
