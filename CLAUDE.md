# CLAUDE.md — Pulse

Journal de trading pour Windows, 100 % local. L'utilisateur parle **français** : répondre en français, code et identifiants en anglais, libellés d'interface en anglais (la traduction viendra plus tard).

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
3. **Argent et prix** : décimaux exacts, jamais de flottant (voir « Argent, prix et temps » ci-dessous). Les dépôts/retraits sont **toujours exclus** des indicateurs de performance (cahier 3.7.10).
4. **Interface** : couleurs et rayons uniquement via les tokens Tailwind/CSS de la charte ; chiffres tabulaires ; signes `+` / `−` (vrai signe moins) sur tout P&L ; jamais la couleur seule pour porter un sens gain/perte ; états vides soignés partout.
5. **Petits lots** : un lot = un commit clair, tests verts, typecheck vert avant de pousser.
6. **Honnêteté** : dire explicitement ce qui n'a pas été testé (ex. installeur Windows, rendu sur vrai Windows).
7. Travailler sur la branche de développement désignée par la session ; ne pas créer de pull request sans demande.

## Roadmap et avancement

Étapes du cahier des charges (section 5). Cocher au fil de l'eau.

### Étape 1 — Socle : saisir et mesurer
- [x] Lot 1 — Squelette Tauri/React/SQLite, comptes, coque UI A+D, CI, workflow d'installeur (**Sonnet, moyen**)
- [x] Lot 2 — Schéma complet SQLite : trades, tags normalisés, règles, checklist, dépôts/retraits, trades manqués ; décision argent/prix ; migrations testées (**Opus, élevé**)
- [ ] Lot 3 — Moteur de statistiques dans `pulse-core` : PnL brut/net, win rate, R:R, expectancy, profit factor, drawdown, courbe d'équité hors dépôts, segments ; tests à résultats connus (**Opus, élevé**)
- [ ] Lot 4 — Saisie de trade (formulaire maquette `screen-form`), liste, détail (**Sonnet, moyen**)
- [ ] Lot 5 — Dashboard réel branché sur les stats, calendrier, filtres de période (**Sonnet, moyen**)
- [ ] Lot 6 — Import CSV broker (profils, doublons, annulation de lot), export CSV, sauvegarde/restauration (**Sonnet, moyen**)
- [ ] Lot 7 — Règles personnelles + checklist pré-trade (volet déclaratif), dépôts/retraits UI (**Sonnet, moyen**)

### Étapes 2 à 5
Voir `docs/cahier-des-charges.md` section 5. Points nécessitant **Opus, élevé** : score de discipline, détection de patterns comportementaux, alertes à seuils, coach IA. Le reste : Sonnet, moyen.

## Argent, prix et temps (décision du lot 2)

| Donnée | Rust (`pulse-core`) | SQLite | IPC / TypeScript |
|---|---|---|---|
| Montants (capital, frais, dépôts), prix, tailles, multiplicateurs | `rust_decimal::Decimal` (exact, 28 chiffres significatifs) | `TEXT` en notation simple (`'1.0842'`, `'-12.5'`), jamais d'exposant | chaîne JSON, type `Decimal = string` (`src/types/money.ts`) |
| Ratios sans unité (win rate, R, profit factor, Sharpe, % de rendement) | `f64`, calculés **depuis** les décimaux | jamais stockés | `number` |
| Instants | `i64` millisecondes Unix UTC + `tz_offset_min` (décalage local du trader, en minutes) | `INTEGER` + `INTEGER` | `number` |

- **Pourquoi** : `0.1 + 0.2` doit valoir `0.3` ; les prix ont 1 à 8 décimales selon l'actif (indices, forex, crypto) ; un entier « en centimes » ne convient pas aux prix ni aux tailles de lot. Tout calcul d'argent se fait en `Decimal` côté Rust ; l'interface **n'additionne jamais** d'argent, elle affiche (`formatDecimal`, sans passer par un `number`).
- **Écriture** : `money::to_db` (notation simple, jamais `-0`) ; lecture `money::col` / `money::opt_col` ; saisie `money::parse` (refuse `1e5`, `1,5`, `1 000`). La base garde l'échelle saisie (`'1.20'` reste `'1.20'`). Les `CHECK` SQL sur ces colonnes ne sont qu'un garde-fou grossier : la validation fait foi dans `pulse-core`.
- **PnL** : `PnL brut = (sortie − entrée) × sens × taille × multiplicateur`, où `multiplicateur` = valeur, en devise du compte, d'un mouvement de prix de 1,0 pour une taille de 1 (ex. EURUSD en lots sur un compte USD : `100000`). Il est copié de l'instrument sur chaque trade (modifiable), pour que modifier un instrument ne réécrive jamais l'historique. Limite connue : pour une paire dont la devise de cotation n'est pas celle du compte (USDJPY sur compte USD), le multiplicateur est une approximation saisie ; l'import broker (lot 6) pourra le recalculer depuis le PnL du broker.
- **Frais** : positif = coût, négatif = crédit (swap positif). `PnL net = brut − frais`.
- **Temps** : jour et heure « locaux » = instant UTC + `tz_offset_min` du trade (ou du dépôt). Aucune dépendance de fuseau horaire au moment du calcul : un trade reste dans le même jour même si le PC change de fuseau.
- **Devise** : les statistiques ne mélangent jamais deux devises ; une vue consolidée n'est possible qu'entre comptes de même devise.

## Modèle de données (schéma v2)

`accounts`, `instruments` (symbole normalisé, classe d'actif, multiplicateur par défaut), `trades` (données saisies seulement : aucun PnL/R stocké), `tags` (types `setup`, `timeframe`, `session`, `market_condition`, `emotion`, `mistake` ; unicité insensible à la casse et aux espaces ; archivage au lieu de suppression), `trade_tags`, `trade_emotions` (avant/pendant/après), `rules` + `trade_rule_checks`, `checklist_items` + `trade_checklist` (copie remplie, libellés figés), `cash_flows` (dépôts/retraits, montant > 0), `missed_trades` + `missed_trade_tags`. Un trade a au plus un tag de chaque type `setup/timeframe/session/market_condition`. Des déclencheurs SQL empêchent de mélanger émotions et tags ordinaires. Suppression d'un trade : ses lignes filles partent avec lui ; un compte, un instrument, un tag ou une règle utilisés ne peuvent pas être supprimés.

## Décisions déjà prises

- Application 100 % locale, aucun serveur ; IA optionnelle (clé API de l'utilisateur, coffre Windows, jamais en clair).
- Thème **sombre uniquement** en v2.0 ; réglage « Réduire les effets » prévu (charte 7).
- Police Inter embarquée. Pas de mobile.
- Repoussé en fin de projet : alerte news économiques, carte de trade partageable, export PDF.
