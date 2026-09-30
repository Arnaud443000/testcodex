// Copie de crates/pulse-core/catalog/emotions.txt (source unique, lue par pulse-core) : alignement vérifié par emotionCatalog.test.ts.
import type { EmotionCatalogGroup } from '../types/trade'

/** Suggestions d'émotions courantes pour un trader, par famille (lot 30). Le faux backend les sert comme la commande Tauri. */
export const EMOTION_CATALOG: readonly EmotionCatalogGroup[] = [
  {
    key: 'calm',
    label: 'Confiance, calme et concentration',
    emotions: ['Calme', 'Confiance', 'Concentration', 'Sérénité', 'Patience', 'Lucidité', 'Discipline', 'Détermination', 'Sang-froid'],
  },
  {
    key: 'fear',
    label: 'Peur, anxiété et hésitation',
    emotions: ['Peur', 'Anxiété', 'Hésitation', 'Doute', 'Nervosité', 'Stress', 'Appréhension', 'Peur de perdre'],
  },
  {
    key: 'euphoria',
    label: 'Euphorie, excès de confiance et avidité',
    emotions: ['Euphorie', 'Excès de confiance', 'Avidité', 'Toute-puissance', 'Excitation', 'Peur de rater (FOMO)'],
  },
  {
    key: 'anger',
    label: 'Frustration, colère et revanche',
    emotions: ['Frustration', 'Colère', 'Revanche', 'Irritation', 'Besoin de se refaire', 'Rancœur'],
  },
  {
    key: 'tired',
    label: 'Ennui, fatigue et impatience',
    emotions: ['Ennui', 'Fatigue', 'Impatience', 'Distraction', 'Lassitude'],
  },
  {
    key: 'regret',
    label: 'Regret, culpabilité et déception',
    emotions: ['Regret', 'Culpabilité', 'Déception', 'Honte', 'Découragement'],
  },
  {
    key: 'relief',
    label: 'Soulagement et satisfaction',
    emotions: ['Soulagement', 'Satisfaction', 'Fierté', 'Gratitude', 'Indifférence'],
  },
]
