# Retours de test de l'utilisateur

Registre des retours après essai de l'application installée. Chaque retour est daté, qualifié et suivi jusqu'à sa correction. Les futures sessions doivent le lire et le tenir à jour.

## Appréciation générale
- 29/09/2026 — L'utilisateur aime l'interface actuelle (style A+D). **Ne pas la remettre en cause** ; les retours ci-dessous portent sur des défauts précis.
- 29/09/2026 — Build 7 (étape 1, lots 1 à 7) installé et testé par l'utilisateur : « tout marche proprement ». Le retour 8 (dashboard) est levé.

## Bugs et manques

| # | Date | Retour | Cause | Statut |
|---|---|---|---|---|
| 1 | 29/09/2026 | À la création d'un compte, un capital saisi avec espace (« 100 000 », « 10 000 ») donne l'erreur « doit être un nombre positif ». | La saisie était lue avec `Number()`, qui refuse les espaces. | **Corrigé** : `parseDecimalInput` (`src/lib/decimal.ts`) accepte espaces (normales, insécables), virgule ou point, et garde une chaîne décimale exacte. Tests : `decimal.test.ts`. |
| 2 | 29/09/2026 | Impossible de supprimer un compte créé par erreur (5 comptes de test créés). | La suppression n'existait pas. | **Corrigé** : `accounts::delete` (refuse un compte qui contient des trades, dépôts/retraits ou trades manqués) + bouton « Supprimer » avec confirmation dans Paramètres. Tests Rust : 3. |
| 6 | 29/09/2026 (build 5) | Fenêtre agrandie : petits défauts de mise en page (« kwak ») ; la mise en page est bien quand la fenêtre est un peu plus petite. | Non diagnostiqué (probablement grilles/largeurs max au-delà de ~1600 px). | **À faire** : tester à 1920×1080 et plein écran, corriger (largeur max du contenu, grilles). Demander une capture à l'utilisateur si non reproductible. |
| 7 | 29/09/2026 (build 5) | Ajouter un trade est peu intuitif : il faut créer l'actif soi-même (catégorie + taille de lot/multiplicateur). Souhaité : actifs **pré-enregistrés** (les plus tradés), sélection simple avec **barre de recherche** (« sol » → Solana). | Aucun catalogue d'actifs livré ; le multiplicateur est exposé à l'utilisateur. | **À faire (mini-lot)** : catalogue intégré (indices : S&P 500, Nasdaq + 3 autres ; crypto : top 50–100 par capitalisation ; devises : paires majeures ; matières premières/actions courantes) avec multiplicateur par défaut pré-rempli, recherche par symbole ou nom, ajout libre conservé en option avancée. Doit passer par une migration/donnée initiale, sans écraser les actifs de l'utilisateur. |
| 8 | 29/09/2026 (build 5) | Le tableau de bord ne se met pas à jour. | Le build 5 ne contenait pas encore le lot 5 (dashboard réel) : normal. | **À revérifier** sur le build 6. |

## Constats de revue (29/09/2026, après le lot 4)

| # | Constat | Statut |
|---|---|---|
| 3 | Les tags et émotions par défaut sont créés **en anglais** par la migration v2 (« Calm », « FOMO », « Doubt », « Range », « Trend », « High volatility », « Economic news »…). Ils s'affichent tels quels dans le formulaire de trade. | **Corrigé** : migration v3 (renomme uniquement les tags encore à leur nom anglais d'origine ; saute un renommage qui créerait un doublon ; un tag créé à la main portant exactement un nom anglais par défaut est indistinguable et serait renommé). Sessions : « Asie » / « Londres » (la session déduite de l'heure est retrouvée par nom). Mock du navigateur aligné. Test : `v3_renames_untouched_starter_tags_only`. |
| 4 | Dans le formulaire de trade, le placeholder « Facultatif » est tronqué (« Faculta ») dans les champs étroits (Sortie, Stop loss, Take profit). | **Corrigé** : placeholder « Optionnel » et suppression du suffixe superposé. |
| 5 | Le mot « prévu » à côté de Stop loss / Take profit chevauche le placeholder. | **Corrigé** : « prévu » / « réel » passe dans le libellé du champ (« Stop loss (prévu) »). Non vérifié sur un vrai écran Windows. |

## À faire plus tard (idées issues de ces retours)
- Modifier un compte existant (nom, courtier, capital initial) — aujourd'hui seul « supprimer + recréer » existe, et seulement pour un compte vide.
- Archiver un compte qui a de l'historique, au lieu de le laisser impossible à retirer.
