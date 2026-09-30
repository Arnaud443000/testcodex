// Lot 35 : pause volontaire. Un rappel bienveillant, jamais un blocage ni un reproche.
// Typographie française : espace insécable (U+00A0) avant : ; ? ! % » et après «.
const NB = '\u00A0'

export const frPause = {
  // Barre du haut
  topbar: {
    button: 'Pause',
    buttonTitle: 'Faire une pause volontaire (un simple rappel : rien n’est bloqué)',
    until: (time: string) => `Pause jusqu’à ${time}`,
    remaining: (n: number) => `${n}${NB}min restantes`,
    remainingLast: 'moins d’une minute',
    remainingShort: (n: number) => `${n}\u00A0min`,
    remainingSuffix: ' restantes',
    endShort: 'Terminer',
    endButton: 'Terminer la pause',
    chipLabel: 'Pause volontaire en cours',
    tomorrow: (time: string) => `demain ${time}`,
  },
  // Choix de la pause (barre du haut, bannière d’alerte, formulaire de trade)
  picker: {
    title: 'Faire une pause',
    intro:
      'Une pause est un rappel : Pulse vous le redit jusqu’à l’heure choisie. Rien n’est bloqué et vous pouvez toujours saisir un trade.',
    lengthLabel: 'Durée',
    lengths: { '15': '15 min', '30': '30 min', '60': '1 h', '120': '2 h', tomorrow: 'Jusqu’à demain matin', custom: 'Autre durée' } as Record<string, string>,
    customLabel: 'Durée en minutes',
    customHint: 'Un nombre entier, de 1 à 480.',
    customError: 'Indiquez un nombre entier de minutes, de 1 à 480.',
    reasonLabel: 'Motif (facultatif)',
    reasons: { loss: 'Une perte', lossStreak: 'Une série de pertes', fatigue: 'Fatigue', emotion: 'Émotion', other: 'Autre' } as Record<string, string>,
    noteLabel: 'Un mot pour vous (facultatif)',
    notePlaceholder: 'Ex. Je respire, je me lève et je reviens.',
    noteCount: (n: number, max: number) => `${n}/${max}`,
    start: 'Commencer la pause',
    cancel: 'Annuler',
    starting: 'Démarrage…',
    startError: (m: string) => `La pause n’a pas pu démarrer${NB}: ${m}`,
    endError: (m: string) => `La pause n’a pas pu être terminée${NB}: ${m}`,
  },
  // Formulaire de trade : un encadré visible, jamais une fenêtre qui empêche d’enregistrer
  form: {
    title: (time: string) => `Vous avez choisi une pause jusqu’à ${time}.`,
    question: `Êtes-vous sûr de vouloir saisir ce trade${NB}?`,
    reassure: 'Vous pouvez l’enregistrer : la pause n’est qu’un rappel, rien n’est bloqué.',
    continue: 'Je continue quand même',
    end: 'Terminer la pause',
    offerTitle: 'Besoin d’une pause avant ce trade ?',
    offerButton: 'Faire une pause',
  },
  // Bannières
  alert: {
    button: 'Faire une pause',
    running: 'Pause en cours',
  },
  suggestion: {
    title: (n: number) => `Vous avez enchaîné ${n} pertes aujourd’hui.`,
    text: 'Voulez-vous faire une pause avant le prochain trade ? C’est une proposition : rien ne démarre sans votre clic.',
    accept: 'Faire une pause',
    later: 'Pas maintenant',
  },
  // Page Comportement
  card: {
    title: 'Pauses',
    subtitle: 'Les trades dont l’heure d’entrée tombe dans une pause volontaire, comparés aux autres, sur la période.',
    empty: 'Aucune pause sur la période. Quand vous en ferez une, Pulse montrera ici ce qui s’est passé en même temps.',
    startButton: 'Faire une pause',
    pauseCount: (n: number) => (n === 1 ? '1 pause commencée' : `${n} pauses commencées`),
    duringCount: (n: number, total: number) => `${n} ${n > 1 ? 'trades pris' : 'trade pris'} pendant une pause, sur ${total}`,
    share: (pct: string) => `soit ${pct} des trades de la période`,
    none: 'Aucun trade n’a été pris pendant une pause sur la période.',
    compareTitle: 'Comparaison avec les autres trades',
    during: 'Pendant une pause',
    others: 'Les autres',
    avgPnl: 'P&L net moyen',
    expectancy: 'Expectancy (R)',
    discipline: 'Score de discipline',
    verdictLine: {
      lower: (what: string, d: string, o: string) => `${what}\u00A0: plus bas pendant une pause que sur les autres trades (${d} contre ${o}).`,
      similar: (what: string, d: string, o: string) => `${what}\u00A0: du même ordre pendant une pause et sur les autres trades (${d} contre ${o}).`,
      higher: (what: string, d: string, o: string) => `${what}\u00A0: plus haut pendant une pause que sur les autres trades (${d} contre ${o}).`,
      notEnoughData: (what: string) => `${what}\u00A0: pas assez de données pour comparer.`,
    },
    sameTime: 'Ces constats se font en même temps\u00A0: l’un n’explique pas l’autre.',
    notEnough: (min: number, d: number, o: number) =>
      `Pas assez de trades pour comparer : il en faut au moins ${min} dans chaque groupe (${d} pendant une pause, ${o} pour les autres).`,
    afterTheFact:
      'Seule l’heure d’entrée compte : un trade saisi après coup avec une heure d’entrée antérieure à la pause n’est pas compté comme pris pendant une pause.',
    listTitle: 'Dernières pauses',
    listEmpty: 'Aucune pause enregistrée.',
    columns: { date: 'Début', planned: 'Prévue', actual: 'Réelle', reason: 'Motif', trades: 'Trades pris' },
    status: { running: 'en cours', completed: 'terminée', endedEarly: 'terminée plus tôt' } as Record<string, string>,
    noReason: '—',
    loadError: (m: string) => `Impossible de charger les pauses${NB}: ${m}`,
  },
  // Page Discipline : un repère
  hint: {
    some: (n: number) => `${n} ${n > 1 ? 'trades pris' : 'trade pris'} pendant une pause sur la période.`,
    link: 'Voir les pauses',
  },
  // Paramètres > Pause volontaire
  settings: {
    title: 'Pause volontaire',
    intro:
      'Après une perte ou une série de pertes, vous pouvez faire une pause de quelques minutes. Pulse vous la rappelle jusqu’à la fin, mais ne bloque jamais rien : vous pouvez toujours saisir un trade.',
    defaultLabel: 'Durée proposée par défaut (minutes)',
    defaultHint: 'De 1 à 480 minutes.',
    suggestLabel: 'Me proposer une pause après une série de pertes',
    suggestCount: 'Nombre de pertes d’affilée',
    suggestOff: 'Désactivé',
    note: 'Pulse ne démarre jamais une pause tout seul : il vous la propose, à vous de cliquer. Les pauses restent sur cet ordinateur : elles ne sont ni exportées, ni envoyées nulle part.',
    saved: 'Enregistré.',
    defaultError: 'Indiquez un nombre entier de minutes, de 1 à 480.',
    saveError: (m: string) => `Enregistrement impossible${NB}: ${m}`,
    loadError: (m: string) => `Impossible de charger les réglages${NB}: ${m}`,
  },
}
