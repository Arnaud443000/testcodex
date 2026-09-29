/**
 * Gabarits des insights automatiques (lot 19). Chaque clé correspond à un `messageKey` de pulse-core ;
 * les valeurs arrivent déjà formatées (pourcentages, montants, R) par l'interface (lot 19 bis).
 * Règles de rédaction : constats sur le passé, « en même temps » / « sur la même période », jamais
 * « parce que » ; une piste n'est jamais un ordre.
 */

const trades = (n: number) => `${n} ${n > 1 ? 'trades' : 'trade'}`

export const frInsights = {
  title: 'Insights',
  categories: { trend: 'Tendance', suggestion: 'Suggestion', highlight: 'Point fort' } as Record<'trend' | 'suggestion' | 'highlight', string>,
  priorities: { high: 'Important', medium: 'À regarder', low: 'Pour information' } as Record<'high' | 'medium' | 'low', string>,
  dismiss: 'Masquer',
  seeTrades: 'Voir les trades concernés',
  seeReport: 'Voir le détail',
  empty: 'Aucun insight pour le moment : rien ne se détache nettement de vos données récentes.',
  emptyHint: 'Les insights apparaissent quand un écart est net et repose sur assez de trades.',
  notCausal: 'Ce sont des constats sur ce qui s’est passé en même temps, pas des causes.',
  periodLastTrades: (n: number) => `Sur vos ${trades(n)} les plus récents`,
  periodDays: (days: number) => `Sur les ${days} derniers jours`,
  factors: { poorSleep: 'de mauvais sommeil', highFatigue: 'de forte fatigue', lateHours: 'de coucher tardif', lowMood: 'd’humeur basse' } as Record<string, string>,
  messages: {
    'riskDrift.up': (older: string, recent: string, change: string, half: number) =>
      `Votre risque moyen par trade est passé de ${older} à ${recent} du capital (${change}) : vos ${trades(half)} les plus récents contre les ${half} précédents.`,
    'riskDrift.down': (older: string, recent: string, change: string, half: number) =>
      `Votre risque moyen par trade est passé de ${older} à ${recent} du capital (${change}) : vos ${trades(half)} les plus récents contre les ${half} précédents.`,
    'disciplineTrend.down': (older: string, recent: string, half: number) =>
      `Votre score de discipline moyen est passé de ${older} à ${recent} sur vos ${trades(half)} les plus récents, par rapport aux ${half} précédents.`,
    'disciplineTrend.up': (older: string, recent: string, half: number) =>
      `Votre score de discipline moyen est passé de ${older} à ${recent} sur vos ${trades(half)} les plus récents : il progresse.`,
    planDrop: (older: string, recent: string, half: number) =>
      `Le respect déclaré de votre plan est passé de ${older} à ${recent} sur vos ${trades(half)} les plus récents, par rapport aux ${half} précédents.`,
    ruleAdherenceDrop: (rule: string, trend: string, checks: number) =>
      `La règle « ${rule} » est moins souvent respectée : ${trend} entre la première et la seconde moitié de vos ${checks} coches des 90 derniers jours.`,
    feesUp: (older: string, recent: string, change: string, half: number) =>
      `Vos frais moyens par trade sont passés de ${older} à ${recent} (${change}) sur vos ${trades(half)} les plus récents.`,
    sizeUpAfterLoss: (afterLoss: string, afterWin: string, cases: number) =>
      `Après une perte, votre exposition au trade suivant varie en moyenne de ${afterLoss} (${cases} cas), contre ${afterWin} après un gain.`,
    revengePattern: (count: number, net: string) =>
      `${count} trades de revanche ces 90 derniers jours (pris peu après une perte, avec une exposition plus grande), pour un résultat net de ${net}.`,
    overtradingPattern: (days: number, limit: number) =>
      `${days} jours au-dessus de votre limite de ${limit} ${limit > 1 ? 'trades' : 'trade'} par jour ces 90 derniers jours.`,
    'costlyMistake.tag': (label: string, count: number, cost: string, share: string) =>
      `L’erreur « ${label} » apparaît sur ${trades(count)} ces 90 derniers jours ; ces trades totalisent ${cost} de pertes, soit ${share} de vos pertes.`,
    'costlyMistake.rule': (label: string, count: number, cost: string, share: string) =>
      `La règle « ${label} » a été notée non respectée sur ${trades(count)} ces 90 derniers jours ; ces trades totalisent ${cost} de pertes, soit ${share} de vos pertes.`,
    emotionLower: (emotion: string, group: string, others: string, count: number) =>
      `Les ${trades(count)} où vous avez déclaré « ${emotion} » avant d’entrer ont en même temps une expectancy de ${group}, contre ${others} pour vos autres trades.`,
    factorLower: (factor: string, detail: string) => `Les jours ${factor}, ${detail} (constat sur les mêmes jours, pas une cause).`,
    factorDiscipline: (gap: string) => `votre discipline était plus basse de ${gap}`,
    factorExpectancy: (gap: string) => `votre expectancy était plus basse de ${gap}`,
    'bestSegment.setup': (name: string, value: string, count: number, baseline: string) =>
      `Votre setup « ${name} » se détache : expectancy de ${value} sur ${trades(count)}, contre ${baseline} pour l’ensemble de vos trades.`,
    'bestSegment.session': (name: string, value: string, count: number, baseline: string) =>
      `La session « ${name} » se détache : expectancy de ${value} sur ${trades(count)}, contre ${baseline} pour l’ensemble de vos trades.`,
    'weakSegment.setup': (name: string, value: string, count: number, baseline: string) =>
      `Votre setup « ${name} » est en retrait : expectancy de ${value} sur ${trades(count)}, contre ${baseline} pour l’ensemble de vos trades.`,
    'weakSegment.session': (name: string, value: string, count: number, baseline: string) =>
      `La session « ${name} » est en retrait : expectancy de ${value} sur ${trades(count)}, contre ${baseline} pour l’ensemble de vos trades.`,
  },
  /** Piste fixe affichée sous une suggestion (et sous quelques tendances). Jamais un ordre. */
  suggestions: {
    'riskDrift.up': 'Piste : comparez ce risque à la limite que vous vous êtes fixée, et vérifiez que la hausse est voulue.',
    'disciplineTrend.down': 'Piste : relisez les composantes du score sur ces trades pour voir laquelle a baissé.',
    planDrop: 'Piste : avant d’entrer, notez en une phrase ce que votre plan prévoit pour ce trade.',
    ruleAdherenceDrop: 'Piste : relisez cette règle avant la séance, ou ajoutez-la à votre checklist pré-trade.',
    feesUp: 'Piste : regardez si les actifs, la taille ou le courtier ont changé sur cette période.',
    sizeUpAfterLoss: 'Piste : après une perte, gardez la taille du trade précédent pour le trade suivant.',
    revengePattern: 'Piste : après une perte, une pause fixée à l’avance avant le trade suivant.',
    overtradingPattern: 'Piste : arrêtez la séance quand la limite du jour est atteinte.',
    'costlyMistake.tag': 'Piste : relisez les trades concernés et ajoutez un point de checklist qui vise cette erreur.',
    'costlyMistake.rule': 'Piste : relisez les trades concernés ; cette règle mérite peut-être une place dans votre checklist.',
    emotionLower: 'Piste : quand vous notez cette émotion avant d’entrer, prenez un temps de recul avant de valider.',
    factorLower: 'Piste : ces jours-là, envisagez une taille réduite ou moins de trades.',
    'weakSegment.setup': 'Piste : relisez les trades de ce setup pour voir ce qui les distingue.',
    'weakSegment.session': 'Piste : relisez les trades de cette session pour voir ce qui les distingue.',
  } as Record<string, string>,
}
