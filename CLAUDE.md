# CLAUDE.md — Pulse

Journal de trading pour Windows, 100 % local. L'utilisateur parle **français** : répondre en français, code et identifiants en anglais. **L'interface est en français** : aucun texte en dur dans les composants, tout passe par `src/i18n/fr.ts` (`useT()`). Les maquettes de `docs/maquettes/` sont en anglais (archive). Les messages d'erreur du cœur Rust affichés à l'utilisateur seront à terme remplacés par des codes d'erreur traduits côté interface.

## Documents de référence (à lire avant de coder)

| Document | Contenu |
|---|---|
| `docs/cahier-des-charges.md` (v2.0) | Fonctionnel complet, modèle de données (section 2), modules 3.x, glossaire des formules (section 7), phasage en 5 étapes (section 5), cadrage technique (section 10) |
| `docs/charte-graphique.md` (v2.0) | Style **A+D** : tokens de couleur, rayons, ombres, composants, dataviz |
| `docs/retours-utilisateur.md` | Retours de test de l'utilisateur et leur statut : à lire, et à tenir à jour à chaque correction |
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
- [x] Lot 3 — Moteur de statistiques dans `pulse-core` : PnL brut/net, win rate, R:R, expectancy, profit factor, drawdown, courbe d'équité hors dépôts, segments ; tests à résultats connus (**Opus, élevé**)
- [x] Lot 4 — Saisie de trade (formulaire maquette `screen-form`), liste, détail (**Sonnet, moyen**)
- [x] Lot 5 — Dashboard réel branché sur les stats, calendrier, filtres de période (**Sonnet, moyen**)
- [x] Lot 6 (réduit) — Export CSV des trades (`export.rs` : `;`, virgule décimale, BOM UTF-8, protection des formules), sauvegarde manuelle et restauration sécurisée (`backup.rs` : VACUUM INTO, validation, copie de sécurité, API de backup SQLite) ; UI dans Paramètres > Données (**Sonnet, moyen**). **L'import CSV broker (profils, doublons, annulation de lot) est repoussé à plus tard** (décision de l'utilisateur, il faudra un vrai export de son broker)
- [x] Lot 7 — Règles personnelles + checklist pré-trade (volet déclaratif), dépôts/retraits UI (**Sonnet, moyen**)

### Étape 2 — Le « pourquoi » et l'analyse comportementale
- [x] Lot 8 — Moteur de l'analyse comportementale dans `pulse-core`, sans UI : score de discipline par trade / jour / période avec détail des composantes (3.4.1, 3.2.9), émotions, séries, plan, premier trade du jour, erreurs récurrentes, respect des règles, patterns (revanche, surtrading, hésitation) (3.4.2 à 3.4.10 sauf 3.4.9), distribution des R, heatmap jour × heure, long/short, risque en % (3.3.8, 3.3.10 à 3.3.12) ; réglages (table `settings`) ; commandes Tauri, types TS, faux backend (**Opus, élevé**)
- [x] Lot 9 (terminé ; voir « Fait » et « Hors périmètre ») — Interface de l'analyse : page « Discipline » (jauge /100, composantes, score par jour, gagnant mal exécuté / perdant bien exécuté), page « Comportement » (émotions, séries, plan, premier trade, erreurs récurrentes cliquables, règles, revanches / surtrading / hésitation), statistiques complémentaires (histogramme des R, heatmap jour × heure, long/short, risque en %), score dans le détail d'un trade, réglages des seuils dans Paramètres (**Sonnet, moyen**)
  - **Fait (lot 9, page Comportement)** : `src/pages/BehaviorPage.tsx` et `src/components/behavior/` — bandeau d'alerte (surtrading / revanche lus dans `get_patterns`, `src/lib/behaviorAlerts.ts`), score de discipline (anneau, composantes, bien / mal exécuté), émotions (avant / pendant / après / tous), séries, plan, premier trade du jour, erreurs récurrentes (par coût / par nombre), distribution des R, risque en %, heatmap, long / short. Bornes de période : `periodRange` (`src/lib/period.tsx`). Aucun calcul en TypeScript. Captures : `docs/captures/lot9-*.png`.
  - **Fait (lot 9, suite)** : réglages des seuils (`BehaviorSettingsPanel`, Paramètres > Seuils de discipline, validation dans `lib/behaviorSettingsForm.ts`, l'effet de chaque seuil sur le score est expliqué, score recalculé après enregistrement) ; page `/discipline` (`DisciplinePage` : jauge, composantes avec poids et couverture « N trades sur M », score par jour en barres cliquables `DayBars`, quatre cases) — la page Comportement ne garde qu'un résumé + lien ; score dans le détail d'un trade (`TradeDisciplineCard`, lecture pure dans `lib/disciplineExplain.ts`, composantes exclues expliquées) ; cartes « Respect des règles » (`get_rule_adherence`) et « Hésitation » (`get_patterns`) sur Comportement ; filtre par erreur : `TradeFilter.mistake` (`{source: tag|rule, id}`, testé dans `trades.rs`), adresse `/trades?mistake=tag:ID|rule:ID` + bandeau retirable, liens « Voir les trades » des erreurs récurrentes (toutes périodes confondues : le filtre ne reprend pas la période du rapport) ; objectif mensuel `discipline_score` (`goals.rs`, cible 1–100, « pas de données » sous 5 trades, **migration v7** = reconstruction de `goals` pour élargir le CHECK, testée avec des objectifs existants). Captures : `docs/captures/lot9b-*.png`.
  - **Hors périmètre du lot 9 (traité à part, nouvelles formules)** : « moyenne après 2 pertes », « variation de taille après une perte », « gain si le plan avait été suivi » (maquette), corrélation facteurs externes / qualité des trades (3.4.9).
- [x] Lot 10 — Trades manqués (saisie, liste, modification), journal quotidien, rappel natif du journal, note de qualité d'exécution (auto + manuelle), mode confiance (conviction × résultat) : `pulse-core` (`journal.rs`, `execution_quality.rs`, `confidence.rs`, `reminder.rs`, `period.rs`, `missed_trades::update`), migration v6 (la v5 est l'archivage des comptes), page Journal (**Sonnet, moyen**)
- [x] Lot 11 — Objectifs mensuels et mode replay d'un trade, sans données de marché externes : `goals.rs`, `replay.rs` (**Sonnet, moyen**)
- [x] Lot 8 bis — Compléments du moteur de l'analyse comportementale, sans UI : facteurs externes du journal quotidien (3.4.9), « moyenne après 2 pertes », « variation de taille après une perte », « gain si le plan avait été suivi » (simulation simple) ; commandes Tauri, types TS, faux backend (**Opus, élevé**). Rend caduque la phrase « Absents du moteur : … » du lot 9 ; l'affichage est fait au lot 8 ter.
- [x] Lot 8 ter — Affichage des quatre analyses du lot 8 bis, sans aucun calcul en TypeScript : page Comportement, carte Séries (« Moyenne après 2 pertes » comparée aux autres trades, « Taille après une perte »), carte Plan (bloc « Simulation » : gain si le plan avait été suivi, tableau des trois scénarios, avertissement), nouvelle carte « Facteurs externes et qualité des trades » (3.4.9, sous les statistiques complémentaires : elle croise journal et discipline/expectancy, donc sa place est avec l'analyse comportementale plutôt que dans l'onglet Journal). Verdicts prudents (« en même temps », jamais « parce que »), « — » + message quand l'échantillon est trop petit, état vide avec lien vers le Journal. Code : `components/behavior/FactorsCard.tsx`, `StreaksCard.tsx`, `PlanCard.tsx`, formats dans `lib/behaviorFormat.ts`, textes `behavior.sequences|simulation|factors` de `fr.ts`, tests `behaviorExtraCards.test.ts`. Captures : `docs/captures/lot9c-*.png` (**Sonnet, moyen**)

### Étape 3 — Garde-fous et dashboard modulaire (lots 12 à 15 terminés)
- [x] Lot 12 — Alertes à seuils (garde-fous, 3.6.1 à 3.6.7) : moteur dans `pulse-core` (`alerts/`), seuils `alerts.*` + réglages `behavior.*` repris, historique et alertes masquées (migration v8), commandes Tauri, types TS, faux backend, bannière dans la coque ; voir « Alertes à seuils (lot 12) » (**Opus, élevé**)
  - **Fait** : `crates/pulse-core/src/alerts/` (moteur pur, seuils, historique ; 22 tests Rust dont la migration v8), commandes `get_active_alerts`, `dismiss_alert`, `get_alert_history`, `get/set_alert_settings` (fin de `src-tauri/src/lib.rs`), types `src/types/alerts.ts`, faux backend `src/lib/mockAlerts.ts` + `mockAlerts` en fin de `mockBackend.ts` (vérifié par `mockAlerts.test.ts` sur les mêmes journaux), bannière `components/AlertBanner.tsx` (textes `alerts` de `fr.ts`, formatage `lib/alertFormat.ts`). Captures : `docs/captures/lot12-*.png`. **Migration v8** (`alert_log`) : à renuméroter si une autre branche ajoute aussi une v8.
- [x] Lot 13 — Dashboard personnalisable (cahier 3.8.1 à 3.8.6 et 3.8.8 ; 3.8.7 et 3.8.9 restent à faire). `pulse-core/src/dashboards.rs` (bibliothèque de 20 widgets, grille de 30 colonnes, validation sans chevauchement, presets **en code** « Essentiel » = l'ancien tableau de bord / « Comportement » / « Analyse », dashboards de l'utilisateur, défaut = réglage `dashboard.default`), **migration v9** (`dashboards`, `dashboard_widgets` ; `kind` sans CHECK pour que la bibliothèque grandisse sans migration ; compte supprimé → widget remis sur « compte global »). Commandes `list_widget_catalog`, `list_dashboard_layouts`, `get_dashboard_layout`, `get_startup_dashboard`, `save_dashboard_layout` (clé absente ou d'un preset = crée une copie), `rename_/delete_/set_default_dashboard_layout`. Interface : `components/dashboard/` (widgets qui réutilisent les commandes existantes, aucun calcul en TypeScript ; `EditableGrid` glisser-déposer + clavier ; bibliothèque avec aperçu ; réglages par widget période / compte / mode), `lib/gridLayout.ts` (compaction sans chevauchement, testée), `lib/widgetScope.ts`, `lib/widgetData.ts` (une requête par rapport et par affichage), faux backend `lib/mockDashboards.ts` (miroir des règles de Rust : à garder aligné). Textes : `src/i18n/fr.dashboard.ts`. Captures : `docs/captures/lot13-*.png` (**Sonnet, moyen**)
- [x] Lot 14 — Quatre analyses d'étape 3, moteur puis interface : vue par actif (3.3.13), frais et commissions cumulés dans le temps (3.3.15), comparaison de stratégies = tags `setup` (3.3.16), système contre discrétionnaire = champ `execution_type` du trade (3.3.17). `stats/analyses.rs`, commandes `get_asset_report` / `get_fee_report` / `get_strategy_report` / `get_execution_report`, page Analyses, faux backend testé. **Aucune migration.** Interprétation détaillée : « Statistiques d'étape 3 » (**Sonnet, moyen**)
- [x] Lot 15 — Page complète des réglages d'alertes, sans toucher au moteur du lot 12 ni aux formules (**Sonnet, moyen**). **Aucune migration, aucun changement Rust.** Voir « Interface des alertes (lot 15) » plus bas.

- [ ] Lot 16 — Quatre analyses complémentaires, moteur puis interface (cahier 3.3.18 à 3.3.21) : coût d'opportunité, comparaison à la même période l'année précédente, temps en position, scaling du capital. `stats/analyses.rs` (fin du fichier), commandes `get_opportunity_report` / `get_year_comparison` / `get_duration_report` / `get_scaling_report`, quatre onglets ajoutés à la page Analyses, faux backend testé. **Aucune migration.** Voir « Analyses complémentaires (lot 16) » (**Sonnet, moyen**)

### Étape 4 — Intelligence et approfondissement (à découper en lots)
Voir `docs/cahier-des-charges.md` section 5 (insights automatiques, IA, comparaisons, verrouillage…).


### Étapes 4 et 5 (suite)
Voir `docs/cahier-des-charges.md` section 5. Points nécessitant **Opus, élevé** : coach IA, insights automatiques, analyse de screenshot par IA. Le reste : Sonnet, moyen.


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

## Moteur de statistiques (lot 3) — interprétation du glossaire

Code : `crates/pulse-core/src/stats/` (`pnl.rs` par trade, `summary.rs` agrégats, `segments.rs`, `load.rs` lecture SQLite, `tests.rs` journaux calculés à la main). Point d'entrée : `stats::report(conn, &StatsQuery)` et `stats::segment_report(conn, &query, SegmentBy::…)`. Une valeur indéfinie vaut `None` (affichée « — »), jamais 0 ni l'infini.

| Formule (glossaire 7) | Choix d'implémentation |
|---|---|
| PnL brut / net | voir « Argent » ; **net** = référence de tous les indicateurs. Trade ouvert : exclu (compté dans `openTradeCount`). |
| Gagnant / perdant / breakeven | signe du PnL **net** (des frais peuvent transformer un trade à plat en perte). |
| R-multiple | `PnL net / risque initial`, risque = `(entrée − SL prévu) × sens × taille × multiplicateur`. Sans frais, identique à la formule du glossaire **avec dénominateur en valeur absolue** (`|entrée − SL|`) : écrite littéralement, la formule donne un signe faux pour un short. Pas de SL prévu, ou SL du mauvais côté / égal à l'entrée → `None`. |
| Win rate | gagnants / trades clôturés (les breakevens comptent au dénominateur). |
| R:R réel | gain moyen / perte moyenne (en argent, net). `None` s'il manque des gains ou des pertes. |
| Expectancy | formule du glossaire, calculée sur les seuls trades ayant un R (`rTradeCount`) ; elle est alors égale au R moyen. Expectancy en argent : `avgNetPnl`. |
| Profit factor | somme des gains / somme des pertes (valeur absolue). Aucune perte → `None` ; l'UI affiche « ∞ » si `totalGains > 0`. |
| Courbe d'équité pure | PnL net cumulé (départ 0), dépôts/retraits exclus ; un point par trade, dans l'ordre de sortie (égalité : id du trade). |
| Rendement %, drawdown % | rendements **pondérés dans le temps** : chaque trade rapporte `PnL net / solde réel juste avant` (capital initial + flux déjà survenus + PnL antérieurs ; un flux au même instant qu'une sortie est appliqué avant). Les rendements sont chaînés : sans flux, c'est exactement « solde / solde de départ » ; avec flux, un dépôt n'apparaît jamais comme de la performance. Solde ≤ 0 → pourcentages `None`. |
| Max drawdown / en cours | plus forte baisse depuis un sommet (le point de départ compte comme sommet), en argent sur le PnL cumulé et en % sur la courbe pondérée. |
| Sharpe | rendements **journaliers** (jours locaux de sortie ayant au moins un trade), écart-type d'échantillon (n − 1), taux sans risque par jour en paramètre (0 par défaut), **non annualisé**. Moins de 2 jours ou écart-type nul → `None`. |

- **Période** : un trade compte dans la période où il est **clôturé** (`exit_time` dans `[from, to)`). Les soldes utilisent toujours tout l'historique des comptes choisis.
- **Calendrier / PnL par jour** : jour local de sortie. **Segments jour de semaine / heure** : heure locale d'**entrée** (moment de la décision). Un trade avec plusieurs erreurs compte dans chacune ; sans tag du type demandé → segment « none », listé en dernier.
- **Débordement** : les calculs en `Decimal` sont vérifiés ; un montant hors limites donne une erreur, jamais un plantage (le profil release est en `panic = "abort"`).

## Analyse comportementale (lot 8) — interprétation

Code : `crates/pulse-core/src/behavior/` (score de discipline, analyses 3.4.x), `stats/distribution.rs` et `stats/risk.rs` (3.3.8, 3.3.10 à 3.3.12), `settings.rs` (réglages). Mêmes principes que le moteur de statistiques : tout est recalculé depuis les données sources, une valeur indéfinie vaut `None`, l'argent reste en `Decimal`, les ratios sont des fractions `f64` (0,25 = 25 %), les dépôts/retraits ne sont jamais de la performance. Sauf mention contraire, un rapport porte sur les **trades clôturés** de la période (sortie dans `[from, to)`) qui passent les filtres de `StatsQuery` ; l'historique (trade précédent, rang dans la journée, solde à l'entrée) se lit **par compte**, sur tous ses trades, ouverts compris : un second compte ne rend pas un trade « de revanche » ni « en surtrading », et le score d'un trade ne dépend pas des comptes affichés.

### Réglages (table `settings`, aucune migration)

| Clé | Sens | Par défaut |
|---|---|---|
| `behavior.max_risk_percent` | risque max par trade, en **% du solde** (`1.5` = 1,5 %), décimal exact | absent → composante « risque » exclue |
| `behavior.max_trades_per_day` | nombre max de trades entrés par jour local | absent → pas de détection de surtrading |
| `behavior.revenge_window_min` | délai après une perte pendant lequel un trade peut être « de revanche » | 60 min |
| `behavior.revenge_size_factor` | facteur d'exposition au-delà duquel c'est une revanche | `1.5` |

Ces seuils seront reliés aux alertes et aux règles personnelles à l'étape 3 (3.6.7, 3.6.9) ; aucun n'est imposé.

### Score de discipline (3.4.1, 3.2.9)

Score d'un trade = `100 × Σ(poids × valeur) / Σ(poids)` sur les **seules composantes qui ont une donnée**. Une composante sans donnée est **exclue et les poids sont renormalisés** ; elle ne compte jamais comme 0. `coverage` = somme des poids présents / 100 (pour afficher « score établi sur 45 % des critères »). Ce score par trade **est** la note de qualité d'exécution calculée (3.2.9) ; la note manuelle 1–5 (`execution_quality`) n'y entre pas (voir plus bas).

| Composante (`key`) | Poids | Valeur de 0 à 1 | Sans donnée (exclue) |
|---|---|---|---|
| Respect du plan (`plan`) | 30 | oui = 1, partiel = 0,5, non = 0 | plan non renseigné |
| Règles personnelles (`rules`) | 25 | règles respectées / règles cochées sur ce trade | aucune règle cochée |
| Checklist pré-trade (`checklist`) | 15 | cases cochées / cases de la copie du trade | pas de checklist remplie |
| Stop loss prévu (`stopLoss`) | 10 | 1 si un SL prévu valide existe, 0 sinon | jamais exclue |
| Risque dans la limite (`risk`) | 10 | 1 si risque initial ≤ limite × solde à l'entrée (comparaison exacte en `Decimal`), 0 sinon | pas de limite réglée ; pas de SL (déjà pénalisé par `stopLoss`, pas de double peine) ; solde à l'entrée ≤ 0 |
| Comportement (`behavior`) | 10 | 0 si le trade est une revanche **ou** du surtrading, 1 sinon | jamais exclue |

- **Revanche (3.4.5)** : `P` = dernier trade **du même compte** sorti au plus tard à l'entrée de `T` (ordre de sortie, égalité : id). `T` est une revanche si `P` est perdant (PnL net < 0), si `T` est entré au plus `revenge_window_min` après la sortie de `P`, et si l'exposition de `T` ≥ `revenge_size_factor` × celle de `P`. Exposition : **risque initial** en argent si les deux trades ont un SL ; sinon, **taille × multiplicateur** si c'est le même instrument ; sinon on ne peut pas comparer → pas de revanche.
- **Surtrading** : rang du trade parmi les trades **entrés** le même jour local sur le même compte (ordre d'entrée, égalité : id, trades ouverts compris) > `max_trades_per_day`.
- **Jour** : moyenne des scores des trades du jour local de **sortie** (comme le calendrier), sans minimum d'échantillon (chaque trade reste explicable).
- **Période / groupe** : moyenne des scores des trades ; **`None` en dessous de 5 trades** (`sampleTooSmall`). Même règle pour le score moyen d'un groupe (premier trade du jour, etc.).
- **Composantes sur la période** : moyenne de la valeur sur les trades où elle est présente, avec leur nombre.
- **Bien / mal exécuté (3.2.9)** : bien exécuté = score ≥ 70. Quatre cases (gagnant bien exécuté, gagnant mal exécuté, perdant bien exécuté, perdant mal exécuté) + breakevens, avec nombre et PnL net.

### Analyses (3.4.2 à 3.4.10)

| Analyse | Choix d'implémentation |
|---|---|
| Émotion et résultat (3.4.2) | segments `SegmentBy::Emotion(moment)` : un groupe par émotion déclarée, par moment (avant / pendant / après) et tous moments confondus (un trade compte une fois par émotion même déclarée à deux moments) ; sans émotion → « none ». Indicateurs = `Summary` du moteur (win rate, PnL net, expectancy = R moyen…). |
| Séries (3.4.3) | dans l'ordre de sortie ; un **breakeven interrompt** la série. Série courante = celle qui finit au dernier trade de la période (`None` si ce dernier est un breakeven ou s'il n'y a aucun trade). Records gagnant / perdant : la plus longue, la plus récente en cas d'égalité. Chaque série : longueur, PnL net, premier / dernier trade. |
| Dans le plan / hors plan (3.4.4) | quatre groupes toujours présents : `yes` (dans le plan), `partial`, `no` (hors plan, au sens du cahier), `none` (non renseigné). |
| Patterns dangereux (3.4.5) | liste des revanches (trade, trade perdant précédent, délai, base et rapport d'exposition) avec le `Summary` de ces trades ; jours de surtrading ; hésitation : trades manqués contre trades pris par setup et par session (part manquée = manqués / (pris + manqués)), trades manqués de la période (`occurred_at`) passant les filtres compte / instrument / sens / tags. |
| Respect des règles (3.4.6) | par règle : cochée N fois, respectée M fois, taux = M / N ; série par mois local de sortie ; **tendance** = taux de la moitié récente − taux de la moitié ancienne des coches (ordre de sortie ; nombre impair : la coche du milieu est ignorée), `None` sous 4 coches. Règles actives jamais cochées listées avec un taux `None` ; règles archivées listées seulement si cochées. |
| Erreurs récurrentes (3.4.7, 3.4.8) | sources : tags d'erreur **et** règles non respectées (« règle non respectée : … »). Par erreur : nombre de trades, part des trades, PnL net cumulé, **coût** = somme des pertes (valeur absolue des PnL nets négatifs), expectancy R, liste des trades (compteur cliquable). Deux classements : par nombre (égalité : coût, puis libellé) et par coût (égalité : nombre, puis libellé). |
| Facteurs externes (3.4.9) | voir « Compléments du moteur » ci-dessous (`get_external_factors`). |
| Premier trade du jour (3.4.10) | rang dans le jour local d'**entrée** (même rang que le surtrading). Groupes `first` / `subsequent` et par rang `1`, `2`, `3`, `4+` : `Summary` + score de discipline moyen (minimum 5 trades). |

### Statistiques complémentaires (3.3.8, 3.3.10 à 3.3.12)

| Statistique | Choix d'implémentation |
|---|---|
| Distribution des R (3.3.8) | classes de 0,5 R, `[a, b)`, de −3 à +5, plus deux classes ouvertes (`< −3`, `≥ 5`) ; toutes les classes sont renvoyées, même vides. Un breakeven (R = 0) tombe dans `[0 ; 0,5)`. R moyen (= expectancy), R médian (moyenne des deux du milieu si nombre pair), trades sans R comptés à part. |
| Heatmap jour × heure | jour de semaine et heure locaux d'**entrée** (comme les segments) ; seules les cases ayant des trades ; nombre, PnL net, win rate, intensité = PnL net / plus grand |PnL net| d'une case, dans [−1, 1]. La heatmap mensuelle (3.3.11) est le calendrier du lot 5. |
| Long / short (3.3.10) | `SegmentBy::Direction`, les deux côtés toujours présents, part des longs en nombre. |
| Risque en % du capital (3.3.12) | `risque initial / solde réel du compte à l'entrée`, solde = capital initial + flux datés au plus tard de l'entrée + PnL net des autres trades sortis au plus tard à l'entrée. Par trade et en agrégat (moyenne, médiane, max, trades sans SL, dépassements de la limite, limite convertie en argent au capital courant). Solde ≤ 0 → `None`. |

### Compléments du moteur (lot 8 bis) : facteurs externes, après 2 pertes, taille après une perte, simulation du plan

Code : `behavior/factors.rs`, `behavior/sequences.rs`, `behavior/simulation.rs` (tests : `behavior/more_tests.rs`, journaux F, G, H calculés à la main). Une commande par rapport, toutes prenant un `StatsQuery` : `get_external_factors`, `get_after_losses`, `get_size_change`, `get_plan_simulation` (`api.getExternalFactors`…). Types : fin de `src/types/behavior.ts` ; faux backend : fin de `src/lib/mockBehavior.ts` et `mockBehaviorExtra` dans `mockBackend.ts`, vérifié par `src/lib/mockBehaviorExtra.test.ts` contre les journaux F et H. Mêmes principes qu'au lot 8 : trades clôturés de la période passant les filtres, historique lu **par compte**, `None` quand il n'y a pas de donnée ou pas assez (jamais 0), argent en `Decimal`, ratios en `f64`. Aucun de ces rapports n'affirme de causalité : ils décrivent ce qui s'est passé **en même temps**, l'interface doit le formuler ainsi (« les jours de mauvais sommeil, votre expectancy était plus basse »), jamais « parce que ».

| Rapport | Choix d'implémentation |
|---|---|
| Facteurs externes (3.4.9) | Source : `journal_entries` (une entrée par jour local, tous comptes confondus). Un trade prend le journal de son jour local d'**entrée** (l'état du trader au moment de décider ; le jour de sortie sert au calendrier, pas ici). Quatre facteurs, toujours renvoyés dans cet ordre : `poorSleep` (sommeil ≤ 2 = présent, 3 à 5 = absent), `highFatigue` (fatigue ≥ 4 présent, 1 à 3 absent), `lateHours` (coché = présent ; une entrée de journal existe mais la case n'est pas cochée = absent), `lowMood` (humeur ≤ 2 présent, 3 à 5 absent). Jour sans journal, ou note non renseignée → **non déclaré** (ni présent ni absent, compté à part en jours et en trades). Par côté (présent / absent) : nombre de **jours** distincts ayant au moins un trade, `Summary` des trades (PnL net, win rate, expectancy R…), score de discipline moyen des trades (minimum 5 trades notés, sinon `None`). Deux comparaisons « présent − absent » : **discipline** (en points) et **expectancy R** (valeur comparable seulement avec au moins 5 trades ayant un R de ce côté), plus l'écart de PnL net moyen par trade (argent, sans verdict : il dépend de la taille). Verdict par comparaison : `notEnoughData` si un côté a moins de **5 jours** ou si une des deux valeurs manque ; sinon `lower` (écart ≤ −10 points / ≤ −0,25 R), `higher` (≥ +10 / ≥ +0,25), `similar` entre les deux. Les écarts sont `None` quand le verdict est `notEnoughData`. |
| Après 2 pertes | Un trade `T` est « après 2 pertes » si les **deux derniers trades de son compte clôturés au plus tard à son entrée** (ordre de sortie, égalité : id ; `T` exclu ; trades ouverts ignorés) sont tous deux perdants (PnL net < 0). Un breakeven ou un gain parmi ces deux-là → non (un breakeven interrompt la série, comme pour les séries). Aucune limite de délai (une série de la veille compte) ; après 3 pertes, le trade suivant compte aussi ; deux trades entrés après la même série comptent tous les deux. L'historique est pris hors période et hors filtres, par compte : un autre compte ne crée jamais la série. Deux groupes : `afterTwoLosses` et `others` (tous les autres trades de la sélection), chacun avec `Summary` et score de discipline moyen (minimum 5). `sampleTooSmall` si un groupe a moins de **5 trades** ; les écarts (après − autres) de win rate et de PnL net moyen sont alors `None` ; l'écart d'expectancy R demande en plus 5 trades avec R de chaque côté ; l'écart de discipline demande 5 trades notés de chaque côté. |
| Taille après une perte | Pour chaque trade `T` de la sélection, `P` = le trade précédent au sens de la revanche (dernier trade du même compte clôturé au plus tard à l'entrée de `T`). Exposition comme pour la revanche : **risque initial** si les deux ont un SL ; sinon **taille × multiplicateur** si même instrument ; sinon **non comparable** (compté à part). Variation = exposition(`T`) / exposition(`P`) − 1 (0,23 = +23 %). Trois groupes selon le résultat de `P` : `afterLoss`, `afterWin`, `afterBreakeven` ; par groupe : nombre de cas comparables, non comparables, hausses (variation > 0), variation **moyenne** et **médiane** (`None` sous **5 cas**), liste des cas (trade, précédent, base, variation). Trades sans précédent comptés dans `noPreviousCount`. `lossVsWin` = moyenne après perte − moyenne après gain (`None` si l'une manque). Aucune fenêtre de temps (contrairement à la revanche). |
| Gain si le plan avait été suivi (3.3.14, version simple) | **Simulation**, jamais un conseil : on retire des trades de la sélection, on ne rejoue pas les sorties. `actual` = tous les trades ; `withoutOffPlan` = sans les trades « hors plan » (`plan = no`) ; `withoutOffPlanOrPartial` = sans les `no` ni les `partial`. Les trades au plan non renseigné sont **gardés** (on ne sait pas). Chaque résultat : nombre de trades, PnL net, win rate, expectancy R, profit factor, max drawdown en argent sur le PnL cumulé des trades gardés (aucun pourcentage : les soldes réels n'ont pas de sens dans une simulation). Chaque scénario : trades retirés, leur PnL net, et `difference` = PnL net simulé − PnL net réel (positif : les trades retirés ont coûté ; négatif : ils ont rapporté). `difference` vaut `None` si aucun trade de la sélection n'a de plan renseigné (`declaredTradeCount = 0`), y compris sans trade ; elle vaut 0 si des plans sont renseignés mais qu'aucun trade n'est retiré. La version complète du cahier (rejouer SL / TP prévus) reste à faire. |

### Points du cahier tranchés dans ce lot

- Pondération du score (point ouvert section 9) : choisie ci-dessus, modifiable plus tard (constantes de `behavior/discipline.rs`).
- La note manuelle d'exécution (1–5) n'entre pas dans le score : le cahier la décrit comme « en complément » ; elle reste affichable à côté.
- « Hors plan » = `planRespecté = non` ; « partiel » est un groupe à part (et vaut 0,5 dans le score).
- Revanche et surtrading détectés sur les données (taille, horaires), pas sur les tags « Trade de revanche » / « Surtrading » que l'utilisateur peut renommer ; ces tags restent comptés dans les erreurs récurrentes.

## Modèle de données (schéma v2 ; comptes : colonne `archived` en v5)

`accounts` (`archived` : 0/1 ; identifiants vides = comptes actifs seulement), `instruments` (symbole normalisé, classe d'actif, multiplicateur par défaut), `trades` (données saisies seulement : aucun PnL/R stocké), `tags` (types `setup`, `timeframe`, `session`, `market_condition`, `emotion`, `mistake` ; unicité insensible à la casse et aux espaces ; archivage au lieu de suppression), `trade_tags`, `trade_emotions` (avant/pendant/après), `rules` + `trade_rule_checks`, `checklist_items` + `trade_checklist` (copie remplie, libellés figés), `cash_flows` (dépôts/retraits, montant > 0), `missed_trades` + `missed_trade_tags`. Un trade a au plus un tag de chaque type `setup/timeframe/session/market_condition`. Des déclencheurs SQL empêchent de mélanger émotions et tags ordinaires. Suppression d'un trade : ses lignes filles partent avec lui ; un compte, un instrument, un tag ou une règle utilisés ne peuvent pas être supprimés.

## Décisions déjà prises

- Tableau de bord et calendrier : commandes `get_dashboard`, `get_calendar`, `get_day_trades` (module `stats::dashboard` de `pulse-core`). La période (1J = aujourd'hui, 1S = 7 jours, 1M = 30, 3M = 90, 1A = 365, jours locaux se terminant aujourd'hui) est comparée à la période de même longueur juste avant ; « Tout » n'a pas de comparaison. L'interface ne calcule rien : elle formate et dessine.
- Analyse comportementale : une commande par rapport, toutes prenant un `StatsQuery` (`get_discipline`, `get_emotions`, `get_streaks`, `get_plan_comparison`, `get_first_trade`, `get_mistakes`, `get_rule_adherence`, `get_patterns`, `get_r_distribution`, `get_heatmap`, `get_long_short`, `get_risk`), plus `get_trade_discipline(id)` et `get/set_behavior_settings`. Types : `src/types/behavior.ts` et `src/types/stats.ts` ; faux backend : `src/lib/mockBehavior.ts` (vérifié contre le journal calculé à la main côté Rust). Les libellés fixes (« Yes », « First trade of the day »…) sont techniques : l'interface traduit par la **clé**.
- Tags par défaut en français depuis la migration v3 (sessions « Asie » / « Londres » / « New York », retrouvées par nom pour la session déduite de l'heure).

- Application 100 % locale, aucun serveur ; IA optionnelle (clé API de l'utilisateur, coffre Windows, jamais en clair).
- Thème **sombre uniquement** en v2.0 ; réglage « Réduire les effets » prévu (charte 7).
- Police Inter embarquée. Pas de mobile.
- Repoussé en fin de projet : alerte news économiques, carte de trade partageable, export PDF.

## Journal, confiance, objectifs, replay (lots 10 et 11)

- **Migration v7** : objectif `discipline_score` (voir lot 9). **Migration v6** (la v5 est l'archivage des comptes) : `journal_entries` (une entrée par jour local `AAAA-MM-JJ`, tous comptes confondus ; un journal entièrement vide est supprimé, jamais stocké) et `goals` (unique par mois + métrique, cible décimale en texte). Les réglages du rappel utilisent la table `settings` existante (`reminder.enabled`, `reminder.time`, `reminder.last_sent_day`).
- **Trades manqués** : table déjà en v2 ; `missed_trades::update` ajouté. Ils ne produisent jamais de P&L et n'entrent dans aucune statistique de performance.
- **Qualité d'exécution** (`execution_quality.rs`) : score 0–100 = moyenne des composantes disponibles (checklist cochée / totale, plan suivi oui 100 / en partie 50 / non 0, règles respectées / cochées) ; la note manuelle 1–5 l'emporte (étoile n = (n − 1) × 25) ; « bien exécuté » à partir de 70. Le rapport croise gagnant / perdant × bien / mal exécuté ; les breakevens sont comptés à part.
- **Confiance** (`confidence.rs`) : groupes de conviction faible 1–3, moyenne 4–7, forte 8–10 ; corrélation de Pearson conviction × R (au moins 3 paires) ; verdict seulement à partir de 10 trades avec R (|r| ≥ 0,3 = prédictive ou inverse). Compare aussi la conviction des trades manqués et des trades pris.
- **Rappel** (`reminder.rs`, boucle d'une minute dans `src-tauri`) : une fois par jour local, après l'heure réglée (20:00 par défaut, activé par défaut), s'il y a eu au moins un trade **entré** dans la journée et qu'il reste du travail (pas de journal, ou trade de saisie rapide incomplet : thèse ou émotions manquantes). Le clic sur la notification n'est pas fiable sous Windows : une bannière dans l'application prend le relais (`get_reminder_pending`). Aucune icône de zone de notification : la notification n'apparaît que si Pulse est ouvert (même réduit).
- **Objectifs** (`goals.rs`) : métriques `net_pnl`, `win_rate` (cible en %), `profit_factor`, `expectancy_r`, `execution_quality` (1–5), `max_drawdown` (plafond), `discipline_score` (0–100). Un trade compte dans le mois local où il est clôturé. Statuts : atteint / en cours / manqué (mois fini, cible non atteinte) / dépassé (plafond franchi) / pas de données (aucun trade clôturé). Métrique `discipline_score` (cible 1–100, moyenne du score du mois, indéfinie sous 5 trades) ajoutée en v7.
- **Replay** (`replay.rs`) : filtre l'historique par note manuelle (à revoir 1–2 ★, bonnes 4–5 ★, sans note), résultat, actif, capture, notes ; « l'échelle des niveaux » d'un trade exprime chaque niveau saisi (stop, objectif, sortie, prix après sortie) en R de prix, frais exclus. Aucune donnée de marché externe.

## Alertes à seuils (lot 12) — interprétation

Code : `crates/pulse-core/src/alerts/` (`mod.rs` évaluation pure, `settings.rs` seuils, `log.rs` historique et alertes masquées, `tests.rs` journaux calculés à la main). Point d'entrée pur : `alerts::evaluate(&Ledger, now, tz_offset_min, &BehaviorSettings, &AlertSettings)` pour **un seul compte** ; enveloppe SQLite : `alerts::active_alerts(conn, account_ids, now, tz_offset_min)` (chaque compte évalué **séparément** ; liste vide = comptes actifs, archivés exclus). Commandes : `get_active_alerts`, `dismiss_alert`, `get_alert_history`, `get_alert_settings` / `set_alert_settings`.

Principes (mêmes que les lots 3 et 8) : tout est recalculé depuis les données sources ; argent en `Decimal` (comparaisons exactes), ratios en `f64` ; dépôts/retraits jamais comptés comme gain ou perte ; **seuil absent = alerte désactivée** ; **jamais d'alerte sans donnée suffisante** (solde de référence ≤ 0, historique trop court, trade précédent non comparable → pas d'alerte, jamais une alerte « par défaut »). Un compte n'influence jamais les alertes d'un autre.

**Instant d'évaluation** : l'évaluation se fait « à l'instant `now` » : un trade entré après `now` est ignoré, un trade sorti après `now` est considéré comme ouvert, un dépôt/retrait daté après `now` est ignoré. **Aujourd'hui** = jour local de `now` avec le décalage `tz_offset_min` fourni par l'appelant (l'interface envoie son décalage, la coque celui du PC). Un trade est « entré aujourd'hui » / « clôturé aujourd'hui » si le jour local de son entrée / sa sortie (avec **son propre** décalage, comme partout) est ce jour-là. **Semaine** = semaine ISO locale (lundi → dimanche) contenant aujourd'hui.

### Seuils (table `settings`, 3.6.7)

Réglages repris du lot 8, **sans doublon** : `behavior.max_trades_per_day` (limite de trades par jour ; absent → alerte désactivée, comme la détection de surtrading), `behavior.revenge_window_min` et `behavior.revenge_size_factor` (définition de la revanche). Ils restent modifiables par `get/set_behavior_settings` (Paramètres > Seuils de discipline). Nouveaux réglages `alerts.*` : ligne absente → **valeur par défaut** ci-dessous ; valeur `off` → alerte désactivée (ce qui permet de couper une alerte dont le défaut est actif).

| Clé | Sens | Par défaut | Valeurs acceptées |
|---|---|---|---|
| `alerts.consecutive_losses` | nombre de pertes d'affilée dans la journée qui déclenche l'alerte | 3 | entier 2 à 20, ou `off` |
| `alerts.burst_max_trades` | nombre **maximum** de trades entrés dans la fenêtre glissante | 3 | entier 1 à 100, ou `off` |
| `alerts.burst_window_min` | durée de la fenêtre glissante, en minutes | 60 | entier 1 à 1440 |
| `alerts.daily_loss_percent` | perte du jour, en % du solde de début de journée (`3` = 3 %) | 3 | décimal > 0 et ≤ 100, ou `off` |
| `alerts.daily_loss_amount` | perte du jour, en argent (devise **de chaque compte**) | désactivé | décimal > 0, ou `off` |
| `alerts.weekly_loss_percent` | perte de la semaine, en % du solde de début de semaine | 6 | décimal > 0 et ≤ 100, ou `off` |
| `alerts.weekly_loss_amount` | perte de la semaine, en argent | désactivé | décimal > 0, ou `off` |
| `alerts.revenge` | alerte de revanche active | `on` | `on` / `off` |
| `alerts.trading_hours` | plage horaire locale autorisée, `HH:MM-HH:MM` (début inclus, fin exclue ; `22:00-02:00` passe minuit) | désactivé | début ≠ fin, ou `off` |
| `alerts.unusual_session` | alerte de session inhabituelle active | `on` | `on` / `off` |
| `alerts.no_stop_loss` | alerte de trade sans stop loss active | `on` | `on` / `off` |

Validation dans `pulse-core` (`alerts::set_settings` refuse tout, n'écrit rien, si une valeur est hors bornes). Les seuils en argent sont communs à tous les comptes et lus dans la devise de chacun (limite connue : pour des comptes de tailles très différentes, préférer les seuils en %).

### Définition de chaque alerte

Gravité : `critical` quand une limite réglée par le trader est **dépassée** (ou que la perte du jour / de la semaine atteint son plafond), ou qu'une position **ouverte** n'a pas de stop ; `warning` sinon. Chaque alerte porte une clé de traduction (`messageKey`), les valeurs utiles, le seuil franchi, l'instant de l'événement déclencheur (`at`) et, le cas échéant, le trade concerné.

| Alerte (`kind`) | Définition exacte | Gravité | Seuil exactement atteint |
|---|---|---|---|
| Pertes consécutives (`consecutiveLosses`, 3.6.1) | trades du compte **clôturés aujourd'hui**, dans l'ordre de sortie (égalité : id) ; `n` = nombre de trades perdants (PnL net < 0) à la fin de cette suite ; un gain ou un breakeven remet à zéro (comme les séries du lot 8). Alerte si `n ≥ seuil`. Les pertes de la veille ne comptent pas (« dans la journée »). | warning | alerte |
| Trades par jour (`tradesPerDay`, 3.6.2) | `n` = trades du compte **entrés aujourd'hui**, ouverts compris. `n = max` → « limite atteinte » ; `n > max` → « limite dépassée » (même sens que le surtrading du lot 8 : le trade de rang `max + 1` est en trop). | atteinte : warning ; dépassée : critical | warning « limite atteinte » |
| Fréquence (`tradesPerWindow`, 3.6.2) | `n` = trades du compte entrés dans `]now − durée ; now]` (tous jours confondus). `n = max` → atteinte, `n > max` → dépassée. Alerte temps réel : des trades saisis après coup, hors de la fenêtre, ne la déclenchent pas. | atteinte : warning ; dépassée : critical | warning « limite atteinte » |
| Stop pour aujourd'hui (`dailyLoss`, 3.6.3) | `perte` = − (somme des PnL nets des trades **clôturés aujourd'hui**) quand cette somme est négative (sinon aucune alerte). Solde de référence `B` = solde réel du compte au **début du jour local** (capital initial + dépôts/retraits + PnL nets de tout ce qui est survenu avant 00:00). Seuil en argent atteint si `perte ≥ montant` ; seuil en % atteint si `perte × 100 ≥ pourcentage × B` (comparaison exacte en `Decimal`), seulement si `B > 0`. Une seule alerte portant les deux indicateurs (`amountReached`, `percentReached`) et `lossPct = perte / B` (`None` si `B ≤ 0`). Les dépôts/retraits du jour ne sont ni un gain ni une perte. | critical | alerte |
| Stop pour la semaine (`weeklyLoss`, 3.6.3) | idem sur les trades clôturés depuis le lundi local ; `B` = solde au début du lundi. | critical | alerte |
| Revanche (`revenge`, 3.6.4) | pour chaque trade **entré aujourd'hui**, ouvert ou clôturé : **exactement la détection du lot 8** (`behavior::Context::revenge` : trade précédent du même compte perdant, entrée dans `revenge_window_min`, exposition ≥ `revenge_size_factor` × celle du trade perdant ; risque initial, sinon taille × multiplicateur sur le même actif, sinon non comparable → pas d'alerte). Le cahier parle de « taille anormale par rapport à la moyenne » : on garde la comparaison au trade perdant du lot 8 pour que la page Comportement et l'alerte disent la même chose. | warning | alerte (rapport = facteur) |
| Hors horaires (`outsideHours`, 3.6.5) | pour chaque trade entré aujourd'hui : heure locale d'entrée (son propre décalage) hors de `alerts.trading_hours`. | warning | l'heure de début est dans la plage, l'heure de fin non |
| Session inhabituelle (`unusualSession`, 3.6.5) | pour chaque trade entré aujourd'hui : sa session = nom de son tag `session` s'il en a un, sinon la session déduite de l'heure (`trade_view::session_for`) ; comparaison insensible à la casse. Historique = trades du compte entrés **avant** lui (ordre d'entrée, égalité : id), tous jours. Il faut au moins **20** trades d'historique ; la session est inhabituelle si elle représente **moins de 10 %** de cet historique (comparaison entière `nombre × 10 < historique`). | warning | 10 % tout juste → habituelle, pas d'alerte |
| Sans stop loss (`noStopLoss`, 3.6.6) | trades du compte **sans SL prévu valide** qui sont **ouverts** (quel que soit le jour d'entrée) ou **entrés aujourd'hui**. Le contrôle « avant validation » existe déjà dans l'aperçu du formulaire (`Preview.stopLoss = missing`). | ouvert : critical ; clôturé : warning | — |

Ordre de la liste : gravité (critical d'abord), puis l'ordre du tableau, puis l'id du trade.

### Identité, historique et alertes masquées (migration v8)

- Chaque alerte a un identifiant stable `id` = `kind:compte:portée` : `consecutiveLosses:1:<dernier trade perdant>`, `tradesPerDay:1:<dernier trade entré>`, `tradesPerWindow:1:<dernier trade entré>`, `dailyLoss:1:<jour>:<amount|percent|amount+percent>`, `weeklyLoss:1:<lundi>:<…>`, `revenge|outsideHours|unusualSession|noStopLoss:1:<trade>`. Une alerte **masquée** (`dismiss_alert`) ne réapparaît jamais sous le même identifiant ; une **aggravation** crée un nouvel identifiant et donc une nouvelle alerte (une perte de plus, un trade de plus au-delà de la limite, le seuil en % franchi en plus du seuil en argent). Quand la situation se résorbe (gain, nouveau jour, stop ajouté), l'alerte disparaît d'elle-même.
- **Migration v8** : table `alert_log` (`alert_id` unique, compte avec suppression en cascade, `kind`, `severity`, `trade_id` sans clé étrangère pour survivre à la suppression du trade, `payload` = l'alerte en JSON telle qu'affichée la première fois, `first_seen_at`, `dismissed_at`). `active_alerts` y inscrit chaque alerte la première fois qu'elle est vue (c'est un **journal d'événements**, pas un cache : les alertes actives sont toujours recalculées) et ne renvoie pas les alertes masquées. `alert_history` relit ce journal (plus récentes d'abord).
- **Quand** : la coque évalue le compte du trade juste après `create_trade` / `update_trade` (inscription dans l'historique à l'instant de la saisie ; une erreur d'évaluation n'empêche jamais l'enregistrement) ; l'interface appelle `get_active_alerts` à l'ouverture, à chaque changement de page, au retour sur la fenêtre et toutes les minutes.
- Interface : bannière dans la coque (`AlertBanner`, même style que la bannière du rappel du journal) avec « Voir le trade », « Masquer » et, depuis le lot 15, « Voir l'historique » ; réglages et historique : voir « Interface des alertes (lot 15) ».

### Laissé pour plus tard (lot 12)

- ~~Page de réglages des seuils `alerts.*`~~ — faite au lot 15 ; les réglages `behavior.*` repris restent aussi modifiables dans Paramètres > Seuils de discipline.
- Avertissement « sans stop loss » **dans le formulaire**, avant validation (3.6.6) : l'aperçu renvoie déjà `stopLoss = missing`, le formulaire n'affiche pour l'instant que le stop du mauvais côté. De même, aucune évaluation « si j'enregistre ce trade » (revanche, limite du jour) avant l'enregistrement.
- Lien **structuré** entre une règle personnelle et un seuil (3.6.9, « règle quantifiable reliée à une alerte ») : toujours aucune colonne (il faudrait une migration). Le lot 15 se limite à la correspondance évidente, sans rien deviner (voir plus bas).
- Aucune notification Windows pour les alertes : seulement la bannière dans l'application.
- Alerte de dépassement du risque max par trade (`behavior.max_risk_percent`, 3.4.11) : non demandée dans 3.6.1 à 3.6.6, facile à ajouter sur le même modèle.

## Interface des alertes (lot 15)

Code : `src/components/AlertSettingsPanel.tsx` (Paramètres > « Alertes et garde-fous », ancre `/settings#alertes`), `src/lib/alertSettingsForm.ts` (lecture et validation pures de la saisie), `src/pages/AlertHistoryPage.tsx` (`/alerts`), `src/lib/alertHistory.ts` (filtre d'affichage), `src/lib/alertRules.ts` + `components/AlertRules.tsx` (règles liées), `AlertBanner`. Textes : clés `alertSettings` et `alertHistory` de `fr.ts`. **Aucun calcul en TypeScript** : les seuils sont validés une seconde fois, et font foi, dans `pulse-core`.

- **Réglages** : une carte par alerte (interrupteur, explication en une phrase, champs, défaut affiché). **Un champ de seuil vide = alerte désactivée** (l'interrupteur s'éteint tout seul ; le rallumer remet une valeur de départ). Interrupteur éteint = `null` / `false`, sans contrôler le champ. Saisies décimales lues à la française (espaces, y compris insécables, et virgule) via `normalizeDecimalInput`. Bornes = celles de `alerts::set_settings` (2–20 pertes, 1–100 trades, fenêtre 1–1440 min, % de perte > 0 et ≤ 100, montant > 0, plage `HH:MM` début ≠ fin, `9:00` et `9h30` acceptés et normalisés en `09:00`).
- **Seuils communs avec le score de discipline** (badge « Réglage commun avec le score de discipline » + note) : `behavior.max_trades_per_day` (carte « Trades par jour ») et la définition de la revanche `behavior.revenge_window_min` / `behavior.revenge_size_factor` (carte « Trade de revanche »). Ils sont enregistrés par `set_behavior_settings` (le risque max est conservé tel quel), les autres par `set_alert_settings`. **Les deux enregistrements ne sont pas atomiques** : le comportement est enregistré d'abord ; si l'enregistrement des alertes échoue ensuite, l'état réel est relu. « Valeurs par défaut » remplit le formulaire sans enregistrer.
- **Historique** : compte et période viennent de la barre du haut (comme les autres pages, période appliquée à la **première apparition** de l'alerte), le type se choisit sur la page. 500 alertes les plus récentes chargées (mention si la limite est atteinte). Chaque ligne : gravité (texte + pastille), date, compte (si plusieurs), explication en clair (`alertMessage`), état masquée / non, lien « Voir le trade » (le lien mène à « introuvable » si le trade a été supprimé depuis : l'historique survit au trade).
- **Règles personnelles (3.6.9)** : aucune règle n'est reliée à un seuil en base, donc **aucune correspondance par mots-clés** (ce serait deviner). Seule correspondance évidente : pour une alerte qui vise **un trade précis** (revanche, hors horaires, session inhabituelle, sans stop loss), les règles que le trader a lui-même **notées « non respectées »** sur ce trade, telles que saisies dans le formulaire. Rien pour les alertes d'ensemble (pertes d'affilée, limites de trades, perte du jour / de la semaine : leur trade n'est que le dernier de la série), ni si aucune règle n'est cochée « non respectée ». Affiché dans l'historique et la bannière.
- **Bannière** : dans le flux normal de la page (aucun élément fixe ou collant, donc aucun chevauchement), au-dessus du contenu ; deux alertes affichées d'abord, les autres repliées ; lien « Voir l'historique » (caché sur la page d'historique).
- Captures : `docs/captures/lot15-*.png` (1280×720, 1440×900, 1920×1080).

## Statistiques d'étape 3 (lot 14) — interprétation

Quatre analyses dans `crates/pulse-core/src/stats/analyses.rs`, toutes calculées **à chaque appel** depuis les trades (rien en cache), avec le même socle que le moteur de statistiques : trades **clôturés** seulement, comptés dans la période où ils sont **clôturés** (`exit_time` dans `[from, to)`), PnL **net** comme référence, dépôts / retraits **jamais** dans les chiffres (ils ne touchent que les soldes), montants en `Decimal`, ratios en `f64`, valeur indéfinie = `None` (« — »), jamais 0 ni l'infini. Chaque analyse prend un `StatsQuery` (comptes, période, sens, actifs, tags : les filtres s'appliquent). Aucune migration : rien de nouveau n'est stocké.

- **Échantillon minimal** : `MIN_SAMPLE = 5` trades clôturés par groupe (même seuil que le score de discipline). En dessous, le groupe est **affiché** mais porte `lowSample = true` (l'interface met un avertissement) ; jamais de « meilleur » ni de verdict sur un petit échantillon. Une comparaison entre deux groupes (système / discrétionnaire) n'est chiffrée (`comparable = true`, écarts) que si **les deux** atteignent le minimum.
- **Part des frais dans le PnL brut** (`feesShareOfGross`) = `frais / PnL brut`, **seulement si le PnL brut est > 0** ; sinon `None`. Raison : la part des frais dans un brut nul ou négatif n'a pas de sens (les frais aggravent une perte, ils ne « mangent » rien). Les frais suivent la convention du modèle : positif = coût, négatif = crédit (swap positif) ; la part peut donc être négative.

### Par actif (3.3.13) — `get_asset_report`
- Un groupe par instrument (identifiant d'instrument, pas le symbole), en réutilisant le découpage `SegmentBy::Instrument`. Ligne : `instrumentId`, `symbol`, `assetClass`, le `Summary` complet (nombre de trades, win rate, **R moyen** = `expectancyR` sur les trades ayant un R — égal à leur R moyen —, PnL brut / frais / net, profit factor…), `feesShareOfGross`, `lowSample`.
- Ordre rendu par le moteur : PnL net décroissant (égalité : symbole). Le **tri par colonne** est un simple réordonnancement d'affichage dans l'interface, sans calcul. Clic sur une ligne : liste des trades filtrée sur cet actif (`/trades?instrument=ID`).
- Aucun trade clôturé → liste vide (état vide dans l'interface).

### Frais et commissions dans le temps (3.3.15) — `get_fee_report`
- Total : `fees` (somme), `grossPnl`, `netPnl`, `feesShareOfGross`, `feesPerTrade` (frais / trades, `None` sans trade), `tradesWithFees` (trades dont les frais sont ≠ 0). Aucun frais saisi → l'interface l'écrit au lieu de dessiner une courbe plate.
- **Courbe cumulée** : un point par trade clôturé, dans l'ordre de sortie (égalité : id), avec `cumulativeFees`, `cumulativeGrossPnl`, `cumulativeNetPnl` (départ 0, le point d'origine est ajouté par l'interface). L'écart brut − net **est** le coût cumulé des frais.
- **Par période** : jour, semaine ou mois selon `granularity` (défaut : mois), sur le **jour local de sortie**. Semaine = du lundi au dimanche, clé = date du lundi (`AAAA-MM-JJ`) ; mois = `AAAA-MM` ; jour = `AAAA-MM-JJ`. Ligne : `key`, `tradeCount`, `grossPnl`, `fees`, `netPnl`, `feesShareOfGross` (règle ci-dessus, propre à la période), `cumulativeFees` (frais cumulés depuis le début de la fenêtre interrogée jusqu'à la fin de la période). Seules les périodes contenant au moins un trade clôturé sont listées (pas de ligne vide), en ordre chronologique.

### Comparaison de stratégies (3.3.16) — `get_strategy_report`
- **Décision : une stratégie = un tag de type `setup`.** Les tags `setup` existent déjà, sont normalisés (unicité, archivage) et un trade en porte **au plus un** : le découpage est donc une vraie partition (pas de double compte, la somme des groupes = le total), ce qui est exactement ce que demande 3.3.16 (« plutôt qu'un mélange global »). Aucun nouveau concept ni table. Les trades sans setup forment le groupe « Sans stratégie » (`key = "none"`, en dernier). Un tag archivé ou renommé apparaît tant qu'il a des trades ; renommer un setup renomme la stratégie.
- **Ce que ce choix ne couvre pas** (2.7 du cahier) : une stratégie n'a ni description ni règles propres, et on ne peut pas grouper plusieurs setups en une stratégie. Si l'utilisateur le veut plus tard, il faudra une table `strategies` + une colonne sur `trades` (migration à part) : décision à lui laisser.
- Ligne : `tagId` (`None` pour « Sans stratégie »), `name`, `Summary` complet, `shareOfTrades` (trades du groupe / trades clôturés de la sélection), `lowSample`, et sa **propre courbe** (`curve` : un point par trade du groupe, dans l'ordre de sortie, PnL net cumulé à partir de 0) pour superposer les stratégies. Ordre rendu : par nom, « Sans stratégie » en dernier ; tri par colonne côté interface.

### Système contre discrétionnaire (3.3.17) — `get_execution_report`
- **Classement d'un trade = son champ existant `execution_type`** (colonne présente depuis la migration v2, saisie par le contrôle « Discrétionnaire / Système » du formulaire de trade). C'est le plus simple : c'est un attribut du trade (le cahier autorise « Stratégie ou Trade »), il ne casse aucune donnée et n'impose pas de choisir une stratégie d'abord.
- **`NULL` = « Non classé »** : jamais deviné, jamais rangé d'office dans une des deux catégories (les trades saisis avant le lot ou en saisie rapide restent non classés). Le rapport a toujours trois blocs : `system`, `discretionary`, `unclassified` (un `Summary` vide, sans trade, si le bloc n'a pas de trade). Chaque bloc porte `summary` et `lowSample`.
- **Écarts** (système − discrétionnaire) : `winRateDelta` (en points de fraction : 0,10 = +10 points), `expectancyRDelta`, `avgNetPnlDelta` (Decimal). `None` si `comparable = false` ou si l'une des deux valeurs est indéfinie. Les non classés n'entrent jamais dans l'écart.
- Le bloc « Non classé » n'est mis en avant dans l'interface que s'il contient des trades, avec un rappel de comment les classer.


### Interface
Page « Analyses » (`/analytics`, qui remplace le placeholder) avec quatre onglets : Par actif, Frais, Stratégies, Système / discrétionnaire. Elle respecte la période et le compte de la barre supérieure. Code : `src/pages/AnalysesPage.tsx`, `src/components/analyses/`, affichage pur (tri, libellés, points à tracer) dans `src/lib/analysesView.ts`, textes dans la clé `analyses` de `fr.ts`. Aucun calcul en TypeScript : l'interface formate, trie et dessine. Les montants agrégés (P&L net, frais, drawdown) sont **arrondis au centime à l'affichage seulement** (sur la chaîne décimale, jamais via un flottant) ; la valeur exacte reste celle de `pulse-core`. Un groupe `lowSample` porte le badge « Échantillon faible » ; « ∞ » s'affiche pour un facteur de profit sans aucune perte. Un clic sur un actif ou une stratégie ouvre la liste des trades filtrée (`/trades?instrument=ID`, `/trades?setup=ID`), **toutes périodes confondues** (comme le filtre par erreur : la liste ne reprend pas la période du rapport). Faux backend : `src/lib/mockAnalyses.ts` (branché dans `mockBackend.ts`), testé contre le même journal F, calculé à la main, que le test Rust `stats/analyses_tests.rs`. Captures : `docs/captures/lot14-*.png` (1440×900 et 1920×1080, états vides et échantillons faibles compris).

## Analyses complémentaires (lot 16) — interprétation

Quatre analyses ajoutées à la **fin** de `crates/pulse-core/src/stats/analyses.rs` (tests : `analyses_tests.rs`, journaux G, H, I, J calculés à la main), avec le même socle que le lot 14 : trades **clôturés** seulement, comptés dans la période où ils sont **clôturés** (`exit_time` dans `[from, to)`), PnL **net** comme référence, dépôts / retraits **jamais** dans un chiffre de performance, montants en `Decimal`, ratios en `f64`, valeur indéfinie = `None` (« — »), jamais 0 ni l'infini. Chaque analyse prend un `StatsQuery` (comptes, période, sens, actifs, tags) sauf la comparaison annuelle (voir plus bas). Échantillon minimal : `MIN_SAMPLE = 5`, le même que partout. **Aucune migration** : tout est recalculé à chaque appel, rien n'est stocké. Aucune de ces analyses ne dit quoi faire : ce sont des constats sur le passé, l'interface l'écrit ainsi.

### Coût d'opportunité (3.3.18) — `get_opportunity_report`
Estimation des gains laissés sur la table en sortant avant le take profit prévu. Données : le **TP prévu** du trade et le champ manuel **prix après sortie** (`trades.price_after_exit`, saisi après coup ; aucun suivi de marché). Le prix après sortie n'est pas dans `TradeFacts` (pour ne pas toucher aux structures partagées) : `opportunity(ledger, prix_après_sortie_par_trade, query)` le reçoit à part, `opportunity_report(conn, query)` le lit en SQL.

- **Trade pris en compte** = clôturé, avec un **TP valide** (du bon côté de l'entrée : `(TP − entrée) × sens > 0`) **et** un prix après sortie. Les autres sont **exclus et comptés** : `tradeCount` (clôturés de la sélection), `eligibleCount`, `excludedCount`, dont `withoutTargetCount` (pas de TP valide) et `withoutPriceAfterCount` (pas de prix après sortie) — un trade qui manque des deux compte dans les deux, donc les deux ne s'additionnent pas. L'interface écrit « N trades sur M pris en compte » et invite à renseigner les données manquantes.
- **Mouvement après la sortie** (`moveAfterExit`, par trade) = `(prix après − sortie) × sens × taille × multiplicateur` : c'est exactement le coût d'opportunité déjà affiché dans le détail d'un trade (`trade_view::opportunity_cost`, réutilisé). Positif : le prix a continué dans le sens du trade ; négatif : il est allé contre.
- **Gain laissé sur la table** (`leftOnTable`, par trade, ≥ 0) = idem mais le prix après sortie est **plafonné au TP prévu** (long : `min(après, TP)`, short : `max(après, TP)`), puis ramené à 0 s'il est négatif. Raison : le TP est ce que le trader comptait prendre ; au-delà, c'est de la spéculation. Un trade sorti au TP ou au-delà laisse 0.
- **Agrégats** : `totalLeftOnTable` (somme), `leftCount` (trades avec un gain laissé > 0), `leftPerEarlyExit` (moyenne sur ces trades, `None` si aucun), `avoidedCount` et `totalAvoided` (trades dont le prix est allé **contre** le trade après la sortie, `moveAfterExit < 0` ; montant en valeur absolue, **non plafonné** : la contrepartie honnête du chiffre précédent, la sortie a aussi évité une perte), `netPnlOfEligible` (PnL net des seuls trades pris en compte, pour situer l'ordre de grandeur). Frais exclus de ces mouvements (ce sont des écarts de prix, pas des résultats).
- `lowSample = true` sous 5 trades pris en compte ; les chiffres restent affichés avec l'avertissement. Liste `trades` des trades pris en compte, plus gros gain laissé d'abord (égalité : id), avec sortie, TP, prix après sortie, `moveAfterExit`, `leftOnTable`, PnL net.
- Aucun trade pris en compte (zéro trade ou aucune donnée) : totaux à 0 mais `leftPerEarlyExit = None` et l'interface affiche un état vide qui explique quoi renseigner. **Estimation, jamais un conseil** : elle dépend d'un prix saisi à la main et suppose qu'on aurait pu sortir au meilleur prix.

### Comparaison avec la même période l'année précédente (3.3.19) — `get_year_comparison`
**Choix : une commande à part, le filtre de période et le tableau de bord ne changent pas.** Elle prend la même requête que `get_dashboard` (`accountIds`, `period` 1J / 1S / 1M / 3M / 1A / Tout, `nowMs`, `tzOffsetMin`) ; la fenêtre courante est **exactement celle du tableau de bord** (jours locaux se terminant aujourd'hui, `Period::days`). L'interface la propose comme un onglet « Année précédente » de la page Analyses, qui suit la période de la barre du haut.

- **Fenêtre de l'an dernier** = les **mêmes dates calendaires** un an plus tôt : premier et dernier jour local de la fenêtre courante décalés d'un an (le 29 février devient le 28 février), puis minuit local à minuit local. Elle peut donc compter 365 ou 366 jours (et pas « 365 jours avant » comme la période précédente du tableau de bord).
- Rendu : `current` et `previous` (deux `Summary` du moteur), leurs bornes, et `comparison` (les mêmes écarts que le tableau de bord : `compare`, réutilisé).
- **« Tout »** : rien ne le précède → pas de comparaison (`available = false`), comme pour le tableau de bord.
- **Année précédente vide** (aucun trade clôturé dans la fenêtre de l'an dernier) : `previousEmpty = true`, `comparison = None` (aucun écart ni pourcentage chiffré contre du vide, jamais « +100 % » ni « ∞ ») et une raison : `historyTooShort` si le tout premier trade du compte est **postérieur** à la fin de cette fenêtre (l'historique ne remonte pas assez), `noTrades` sinon (l'historique existe mais il n'y a rien sur cette période). L'interface affiche le chiffre actuel seul et explique laquelle des deux situations s'applique. Période actuelle vide : `currentEmpty`, mêmes précautions.
- Les filtres sens / actif / tag ne s'appliquent pas (comme le tableau de bord : comptes seulement).

### Temps en position (3.3.20) — `get_duration_report`
- Durée d'un trade = `exit_time − entry_time` en millisecondes, sur les trades **clôturés** de la sélection. Les trades **sans heure de sortie** (ouverts) sont exclus et comptés à part (`openTradeCount`, ceux qui passent les filtres) ; une durée négative (données incohérentes, refusée à la saisie) est exclue et comptée (`invalidCount`).
- Trois groupes selon le signe du PnL **net** (comme partout) : gagnants, perdants, breakevens (affichés à part, hors ratio). Par groupe : nombre, durée **moyenne** et **médiane** (moyenne des deux du milieu si pair), `None` si le groupe est vide, `lowSample` sous 5 trades.
- **Ratio** = durée moyenne des gagnants / durée moyenne des perdants (`avgRatio`), et idem sur les médianes (`medianRatio`). Chiffré seulement si **les deux groupes ont au moins 5 trades** (`comparable`, comme système / discrétionnaire) et si la durée moyenne (ou médiane) des perdants n'est pas nulle ; sinon `None`. Un ratio > 1 veut dire que les gagnants ont duré plus longtemps ; l'interface le formule sans jugement (« ne dit pas si c'est bien ou mal »).

### Scaling du capital (3.3.21) — `get_scaling_report`
La taille de position suit-elle le capital ? On regarde le **risque en % du capital** du lot 8 (`stats::risk::risk`, réutilisé tel quel : risque initial / solde réel du compte à l'entrée, dépôts / retraits **compris dans le solde** parce que le dimensionnement doit suivre le capital réel, alors qu'ils restent exclus de tout PnL) et non la taille brute (un lot n'a pas le même sens d'un actif à l'autre).

- Trades utilisables = clôturés de la sélection **avec un risque en %** (SL valide, solde à l'entrée > 0). Les autres sont comptés (`withoutStopCount`). `points` = la série (trade, sortie, solde à l'entrée, risque initial, risque %), dans l'ordre de sortie.
- **Deux moitiés** : les utilisables dans l'ordre de sortie sont coupés en une moitié ancienne et une moitié récente (nombre impair : le trade du milieu est ignoré, comme la tendance des règles). Il faut **au moins 5 trades utilisables dans chaque moitié** (donc 10 au total, ou 11 en impair) ; sinon `verdict = notEnoughData` et les deux moitiés et les écarts sont `None`.
- Pour chaque moitié : `avgBalance` (solde moyen à l'entrée), `avgRisk` (risque moyen en argent), `avgRiskPct` (moyenne des risques en %). Écarts (récent contre ancien, en fraction, 0,25 = +25 %) : `capitalChange` (solde moyen), `riskChange` (risque moyen en argent), `riskPctChange` (risque % moyen, **relatif** : `récent / ancien − 1`).
- **Verdict prudent**, sur `riskPctChange` : `oversized` (« taille en hausse plus vite que le capital ») si ≥ **+20 %** ; `undersized` (« taille qui n'a pas suivi le capital ») si ≤ **−20 %** ; `stable` entre les deux ; bornes incluses (comparées avec une tolérance de 1e-9, pour que « exactement 20 % » compte). `capitalMoved` = le solde moyen a varié d'au moins **10 %** : sinon l'interface précise que le changement de taille **ne vient pas** de la croissance du compte (le verdict est alors un constat sur le risque pris, pas sur le scaling). Les seuils (`minPerHalf`, `capitalMoveThreshold`, `verdictBand`) sont renvoyés par le moteur pour que l'interface ne les écrive pas en dur. Le mot « sous-dimensionné » n'est jamais un ordre d'augmenter la taille : il décrit ce qui s'est passé.
