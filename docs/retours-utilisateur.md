# Retours de test de l'utilisateur

Registre des retours après essai de l'application installée. Chaque retour est daté, qualifié et suivi jusqu'à sa correction. Les futures sessions doivent le lire et le tenir à jour.

## Appréciation générale
- 29/09/2026 — L'utilisateur aime l'interface actuelle (style A+D). **Ne pas la remettre en cause** ; les retours ci-dessous portent sur des défauts précis.

## Bugs et manques

| # | Date | Retour | Cause | Statut |
|---|---|---|---|---|
| 1 | 29/09/2026 | À la création d'un compte, un capital saisi avec espace (« 100 000 », « 10 000 ») donne l'erreur « doit être un nombre positif ». | La saisie était lue avec `Number()`, qui refuse les espaces. | **Corrigé** : `parseDecimalInput` (`src/lib/decimal.ts`) accepte espaces (normales, insécables), virgule ou point, et garde une chaîne décimale exacte. Tests : `decimal.test.ts`. |
| 2 | 29/09/2026 | Impossible de supprimer un compte créé par erreur (5 comptes de test créés). | La suppression n'existait pas. | **Corrigé** : `accounts::delete` (refuse un compte qui contient des trades, dépôts/retraits ou trades manqués) + bouton « Supprimer » avec confirmation dans Paramètres. Tests Rust : 3. |

## Constats de revue (29/09/2026, après le lot 4)

| # | Constat | Statut |
|---|---|---|
| 3 | Les tags et émotions par défaut sont créés **en anglais** par la migration v2 (« Calm », « FOMO », « Doubt », « Range », « Trend », « High volatility », « Economic news »…). Ils s'affichent tels quels dans le formulaire de trade. | **À faire** : nouvelle migration v3 qui renomme les libellés par défaut en français (sans toucher aux tags créés ou renommés par l'utilisateur ; ne jamais modifier la migration v2). Adapter aussi `src/lib/mockBackend.ts`. |
| 4 | Dans le formulaire de trade, le placeholder « Facultatif » est tronqué (« Faculta ») dans les champs étroits (Sortie, Stop loss, Take profit). | **À faire** : raccourcir le placeholder ou élargir les champs. |
| 5 | Le mot « prévu » à côté de Stop loss / Take profit chevauche le placeholder. | **À faire** avec le point 4. |

## À faire plus tard (idées issues de ces retours)
- Modifier un compte existant (nom, courtier, capital initial) — aujourd'hui seul « supprimer + recréer » existe, et seulement pour un compte vide.
- Archiver un compte qui a de l'historique, au lieu de le laisser impossible à retirer.
