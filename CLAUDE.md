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
- [x] Lot 8 bis — Compléments du moteur de l'analyse comportementale, sans UI : facteurs externes du journal quotidien (3.4.9), « moyenne après 2 pertes », « variation de taille après une perte », « gain si le plan avait été suivi » (simulation simple) ; commandes Tauri, types TS, faux backend (**Opus, élevé**). Rend caduque la phrase « Absents du moteur : … » du lot 9 ; l'affichage reste à faire (lot 9).

### Étapes 3 à 5
Voir `docs/cahier-des-charges.md` section 5. Points nécessitant **Opus, élevé** : alertes à seuils (à relier aux réglages du lot 8 et aux règles personnelles), coach IA. Le reste : Sonnet, moyen.

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
