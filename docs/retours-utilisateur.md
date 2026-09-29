# Retours de test de l'utilisateur

Registre des retours après essai de l'application installée. Chaque retour est daté, qualifié et suivi jusqu'à sa correction. Les futures sessions doivent le lire et le tenir à jour.

## Appréciation générale
- 29/09/2026 — L'utilisateur aime l'interface actuelle (style A+D). **Ne pas la remettre en cause** ; les retours ci-dessous portent sur des défauts précis.
- 29/09/2026 — Build 7 (étape 1, lots 1 à 7) installé et testé par l'utilisateur : « tout marche proprement ». Le retour 8 (dashboard) est levé.
- 29/09/2026 — Build 10 (lots 1 à 11, lot 9 partiel) installé après désactivation de Smart App Control ; essai avec des trades de test : « ça rend bien, beaucoup de données très intéressantes ». Installeur non signé bloqué par Smart App Control : signature de code à envisager si distribution.

## Bugs et manques

| # | Date | Retour | Cause | Statut |
|---|---|---|---|---|
| 1 | 29/09/2026 | À la création d'un compte, un capital saisi avec espace (« 100 000 », « 10 000 ») donne l'erreur « doit être un nombre positif ». | La saisie était lue avec `Number()`, qui refuse les espaces. | **Corrigé** : `parseDecimalInput` (`src/lib/decimal.ts`) accepte espaces (normales, insécables), virgule ou point, et garde une chaîne décimale exacte. Tests : `decimal.test.ts`. |
| 2 | 29/09/2026 | Impossible de supprimer un compte créé par erreur (5 comptes de test créés). | La suppression n'existait pas. | **Corrigé** : `accounts::delete` (refuse un compte qui contient des trades, dépôts/retraits ou trades manqués) + bouton « Supprimer » avec confirmation dans Paramètres. Tests Rust : 3. |
| 6 | 29/09/2026 (build 5) | Fenêtre agrandie : petits défauts de mise en page (« kwak ») ; la mise en page est bien quand la fenêtre est un peu plus petite. | Reproduit en navigateur headless à 1920 et 2560 px : le contenu s'étirait sur toute la largeur (cartes KPI et tableau très larges, texte minuscule au milieu de grands vides) ; au-delà de 1536 px le formulaire de trade passait en 3 colonnes trop étroites (champ Actif et date coupés). | **Corrigé (à revérifier sur un vrai Windows plein écran)** : contenu centré, largeur max 1480 px (`App.tsx`) ; formulaire limité à 2 colonnes ; menu d'actifs au-dessus des cartes suivantes. Testé en Chromium headless à 1280×720, 1440×900, 1920×1080, 2560×1440 sur Tableau de bord, Trades, formulaire, Calendrier, Paramètres. Reste possible : le graphique « Résultat par jour » laisse du vide sous les barres. |
| 7 | 29/09/2026 (build 5) | Ajouter un trade est peu intuitif : il faut créer l'actif soi-même (catégorie + taille de lot/multiplicateur). Souhaité : actifs **pré-enregistrés** (les plus tradés), sélection simple avec **barre de recherche** (« sol » → Solana). | Aucun catalogue d'actifs livré ; le multiplicateur est exposé à l'utilisateur. | **Corrigé (à revérifier sur un vrai Windows)** : migration v4 = colonne `name` + catalogue de 106 actifs (8 indices, 52 cryptos, 28 paires forex, 6 matières premières, 12 actions US), source unique `crates/pulse-core/catalog/assets.csv` → `scripts/gen-catalog.py` génère le SQL et `src/lib/assetCatalog.ts`. Un actif déjà créé par l'utilisateur garde sa catégorie, son multiplicateur et ses trades (seul son nom est complété). Formulaire : sélecteur avec recherche (symbole ou nom, sans accents ni casse), groupé par classe, clavier ; multiplicateur visible, pré-rempli, modifiable ; « Actif introuvable ? Ajouter un actif personnalisé » conservé. Multiplicateurs = valeurs courantes **à vérifier auprès du courtier**. Tests : `assetSearch.test.ts`, `v4_seeds_catalog_without_touching_existing_instruments`. |
| 8 | 29/09/2026 (build 5) | Le tableau de bord ne se met pas à jour. | Le build 5 ne contenait pas encore le lot 5 (dashboard réel) : normal. | **À revérifier** sur le build 6. |

## Constats de revue (29/09/2026, après le lot 4)

| # | Constat | Statut |
|---|---|---|
| 3 | Les tags et émotions par défaut sont créés **en anglais** par la migration v2 (« Calm », « FOMO », « Doubt », « Range », « Trend », « High volatility », « Economic news »…). Ils s'affichent tels quels dans le formulaire de trade. | **Corrigé** : migration v3 (renomme uniquement les tags encore à leur nom anglais d'origine ; saute un renommage qui créerait un doublon ; un tag créé à la main portant exactement un nom anglais par défaut est indistinguable et serait renommé). Sessions : « Asie » / « Londres » (la session déduite de l'heure est retrouvée par nom). Mock du navigateur aligné. Test : `v3_renames_untouched_starter_tags_only`. |
| 4 | Dans le formulaire de trade, le placeholder « Facultatif » est tronqué (« Faculta ») dans les champs étroits (Sortie, Stop loss, Take profit). | **Corrigé** : placeholder « Optionnel » et suppression du suffixe superposé. |
| 5 | Le mot « prévu » à côté de Stop loss / Take profit chevauche le placeholder. | **Corrigé** : « prévu » / « réel » passe dans le libellé du champ (« Stop loss (prévu) »). Non vérifié sur un vrai écran Windows. |

## Constats de revue (29/09/2026, lot 8) — signalés, non corrigés

| # | Constat | Statut |
|---|---|---|
| 9 | `stats::dashboard::calendar` : `firstWeekday` (jour de semaine du 1er du mois) est décalé d'un jour pour un décalage UTC **négatif** (Amériques) : l'instant passé à `time::weekday` ajoute deux fois le décalage. Sans effet en France (UTC+1/+2). Le faux backend, lui, est juste. | **À corriger** (une ligne ; ajouter un test à UTC−5) |
| 10 | L'aperçu du formulaire (`trade_view::preview`) exprime le risque en % du **capital courant**, alors que le rapport de risque du lot 8 utilise le **solde à l'entrée** : pour un ancien trade modifié, les deux pourcentages peuvent différer. | À trancher au lot 9 (garder « courant » pour un nouveau trade, « à l'entrée » pour un trade existant ?) |

## À faire plus tard (idées issues de ces retours)
- ~~Modifier un compte existant~~ — **fait** (voir « Comptes » ci-dessous).
- ~~Archiver un compte qui a de l'historique~~ — **fait** (voir « Comptes » ci-dessous).

## Comptes : modification et archivage (lot Paramètres, migration v5 provisoire)
- **Modifier** (`accounts::update`) : nom, type, courtier, capital initial ; la **devise** est verrouillée (`currency_locked`) dès que le compte a un trade, un dépôt/retrait ou un trade manqué. Changer le capital d'un compte avec historique demande une **confirmation** expliquant que les rendements en % sont recalculés (rien n'est stocké : recalcul depuis les données sources ; les montants P&L ne changent pas).
- **Archiver / désarchiver** (`accounts::set_archived`, colonne `archived`, migration v5) : un compte archivé sort des sélecteurs, du dashboard, du calendrier, des stats, de la liste des trades et de l'export par défaut (une liste d'identifiants vide = comptes actifs) ; il reste lisible en le nommant explicitement (Paramètres > Comptes archivés > « Consulter les trades »). Refus d'ajouter un trade ou un dépôt/retrait à un compte archivé (`account_archived`). Suppression toujours refusée s'il a de l'historique.
- Tests : Rust (`accounts::edit_tests`, `migrations::v5_…`), TypeScript (`mockAccounts.test.ts`). Non testé : rendu sur un vrai Windows, parcours cliqué complet.

## Lot 9 (page Comportement) — points à vérifier
- Constat 10 (risque courant / à l'entrée) : la page Comportement utilise le risque **à l'entrée** du moteur ; le formulaire garde « capital courant ». Toujours à trancher.
- Sans limite de risque réglée (`behavior.max_risk_percent`), la composante « risque » est exclue du score et aucun dépassement n'est compté ; il n'existe pas encore d'écran pour régler les seuils (voir CLAUDE.md, reste à faire du lot 9).
- Rendu vérifié en Chromium headless (1440×900, 1920×1080) sur le faux backend uniquement ; **pas** sur un vrai Windows / WebView2, ni avec la vraie base SQLite.
