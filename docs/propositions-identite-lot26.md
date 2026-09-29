# Propositions d'identité visuelle — lot 26

**Rien de ce document n'est appliqué.** La consigne du lot : ne changer ni le logo, ni le nom, ni la palette sans accord. Ce document expose l'état des lieux, ce que je recommande et ce qui attend une décision. Maquette visuelle : `docs/maquettes/identite-lot26.html` (capture : `docs/captures/lot26-identite-propositions.png`).

## État des lieux (vérifié)
- **Icônes de l'application** (`src-tauri/icons/`) : présentes et nettes. `icon.ico` contient 16, 24, 32, 48, 64 et 256 px ; PNG de 30 à 310 px pour le menu Démarrer ; `icon.png` 512 px. Carré très arrondi, dégradé bleu → violet pleine surface, glyphe clair. **Aucune icône manquante ni floue** : je n'ai donc rien remplacé.
- **Favicon** (`public/favicon.svg`) : glyphe en dégradé sur fond nuit `#0B0E27`, 8 barres. Sert seulement dans un navigateur (aperçu de développement).
- **Logo de la barre latérale** (`components/Logo.tsx`) : glyphe dessiné en code (13 barres, halo), + « Pulse » en Light 26 px. La charte le dit elle-même : « version de travail, à remplacer par le fichier officiel ».
- **Écran de démarrage** : il n'y en a pas. Un écran « Pulse » discret existe seulement pendant la vérification du verrou (`LockSplash`).
- Petit décalage sans gravité : le glyphe de l'icône d'application est presque blanc, celui de la barre latérale est en dégradé.

## Ce que je recommande
| Élément | Recommandation | Décision de l'utilisateur ? |
|---|---|---|
| Logo, nom, palette | **Inchangés.** | Non |
| Icône de l'application | Garder l'actuelle (option A). Facultatif : un glyphe **simplifié** (9 barres épaisses) pour les tailles 16 et 24 px du `.ico`, où les traits fins se brouillent. Mon tracé (option C de la maquette) est un essai à faire redessiner proprement. | Oui, seulement si vous voulez C |
| Écran de démarrage | Si vous en voulez un : **minimal** (glyphe + « Pulse », barre de chargement fine), affiché seulement le temps d'ouvrir la base. La signature « Clarté. Discipline. Performance. » y est possible en discret (la charte prévoit un usage ponctuel : c'est le bon endroit). | **Oui** : faut-il un écran de démarrage ? avec ou sans signature ? |
| Logo de la barre latérale | Garder l'actuel, **sans** signature (elle coûte 14 px de hauteur, dont la barre manque déjà à 720 px). Un glyphe seul est prévu pour le jour où l'on ajoutera une barre repliée. | Non |
| Favicon | Garder. | Non |
| Fichier officiel du logo (SVG) | Si vous avez un fichier, il remplace la version dessinée en code (`Logo.tsx`, `favicon.svg`, icônes). | **Oui** : en existe-t-il un ? |

## Comment l'appliquer, si vous validez
1. Écran de démarrage : un composant de plus dans `LockGate` (`App.tsx`), sans changement de données ; texte de la signature dans `src/i18n/fr.ts`.
2. Glyphe simplifié : nouveau SVG source → régénération du `.ico` (16 et 24 px seulement) avec l'outil d'icônes de Tauri ; `.icns` et PNG inchangés.
3. Fichier officiel : remplacer `Logo.tsx` (le composant garde la même interface) et régénérer toutes les icônes depuis ce SVG.

## Non vérifié
Rendu des icônes sur une vraie barre des tâches Windows (claire et sombre), dans le menu Démarrer et à 125 / 150 % de mise à l'échelle : je n'ai vu que les fichiers PNG et le `.ico` sous Linux.
