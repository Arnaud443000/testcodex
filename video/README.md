# Pulse — film de présentation

Film cinématique de 45 s (« Le battement de ton trading »), construit avec [Remotion](https://www.remotion.dev)
(React + TypeScript). Direction artistique et animatic : [`ANIMATIC.md`](ANIMATIC.md).

## Commandes

```bash
cd video
npm ci

npm run render            # MP4 H.264 1920×1080, 30 i/s → out/pulse-1080p30.mp4
npm run render:vertical   # MP4 H.264 1080×1920, 30 i/s → out/pulse-vertical-1080x1920.mp4
npm run studio            # prévisualisation interactive (Remotion Studio)
npm run stills -- 3.2 15 30   # images clés (secondes) dans out/stills/ ; --vertical pour le 9:16
npm run typecheck
```

`render*` passe par `scripts/render.ts` : sous Linux sans carte graphique, Chromium compose
toutes ses pages dans **un seul** processus GPU logiciel, donc `--concurrency` n'accélère rien.
Le script lance un navigateur par cœur, chacun sur une tranche d'images, puis assemble les
segments sans réencodage et ajoute la bande-son (≈ 12 min pour le 1080p30 sur 4 cœurs).
`render:cli` reste disponible (CLI Remotion standard, adaptée à une machine avec GPU).

Les commandes `render*` régénèrent d'abord le grain (`scripts/grain.ts`) et la bande-son
(`scripts/audio.ts` → `public/audio/pulse.wav`), qui ne sont pas versionnés.

**Master 4K 60 i/s** : la composition est conçue en 1920×1080 ; toute l'animation est exprimée en
temps musicaux, donc le même film se rend à 60 i/s et en 3840×2160 sans retouche :

```bash
npm run render:4k60      # = tsx scripts/render.ts Pulse out/pulse-4k60.mp4 --scale=2 --fps=60
# ou, avec la CLI Remotion : npx remotion render Pulse out/pulse-4k60.mp4 --scale=2 --props=props/60fps.json
```

(compter environ 8 fois le temps du rendu 1080p30 : 2 fois plus d'images, 4 fois plus de pixels).

## Structure

| Fichier | Rôle |
|---|---|
| `src/timeline.ts` | **Source unique du rythme** : 100 BPM, 75 temps, scènes, plans du chaos, coupes, repères audio (`CUES`), nappe (`PAD`), nombre de sous-images de flou de bougé par moment. Lu par la vidéo et par `scripts/audio.ts`. |
| `src/theme.ts` | Tokens de `docs/charte-graphique.md` (couleurs, verre, rayons 24/16/14/10, ombres, Inter). |
| `src/Film.tsx` | Assemblage : plan actif, flou de bougé, aberration chromatique, vignette, grain, audio. |
| `src/scenes/` | `Intro` (0–8), `Chaos` (8–20), `Reveal` (20–25), `Feature` + `cards.tsx` (25–60, six super-pouvoirs), `Local` (60–68), `Outro` (68–75). |
| `src/ui/` | Logo (copie de `src/components/Logo.tsx`, barres animables), cartes de verre, badges, notices, ligne lumineuse, textes à masque. |
| `src/fx/` | Flou de bougé par sous-images, bloom, aberration chromatique, caméra 3D + profondeur de champ, aurore, grain, vignette, tremblement. |
| `scripts/audio.ts` | Synthèse de la bande-son (lub-dub sub-bass, risers, whooshes, clics, glitchs, impact, cadenas, carillon, nappe, réverbération) en WAV 48 kHz. |

Règles suivies : tout le texte est en français ; montants au format de l'app (`+12 480,00 €`, vrai
signe moins) ; couleurs de la charte uniquement ; gain/perte jamais portés par la seule couleur
(signe, libellé, lettres G / P) ; grille de 8 px ; un texte reste lisible au moins 1,2 s (hors
fragments du chaos) ; aucune animation linéaire (courbes et ressorts de `src/lib/`).

## Rendu sous Windows

`remotion.config.ts` utilise le Chromium de l'environnement de développement s'il existe ;
ailleurs (Windows, macOS), Remotion télécharge son propre navigateur au premier rendu.
