/**
 * Textes du suivi prop firm (lot 33), clé `prop` de `fr`. Règle d'or écrite partout : les calculs portent
 * sur les trades CLÔTURÉS seulement et ne remplacent pas le tableau de bord de la firme.
 * Jamais d'ordre (« ne tradez pas ») : des constats et des points « à surveiller ».
 */
export const frProp = {
  title: 'Prop firm',
  subtitle: 'Ce qu’il vous reste avant chaque règle de votre compte prop firm, sur vos trades clôturés.',
  accountLabel: 'Compte prop firm',
  loading: 'Chargement du suivi prop firm…',
  loadError: (detail: string) => `Impossible de lire le suivi de ce compte : ${detail}`,

  // Bandeau permanent (règle d'or du lot).
  golden: {
    title: 'Pulse ne remplace pas le tableau de bord de votre firme.',
    text: 'Ces calculs portent sur vos trades clôturés seulement. La plupart des firmes comptent aussi la perte latente de vos positions ouvertes, que Pulse ne connaît pas : la marge réelle peut être plus faible. Vérifiez toujours chez votre firme, qui fait foi.',
    short: 'Trades clôturés seulement : vérifiez chez votre firme, qui fait foi.',
  },
  openTrades: (n: number) =>
    `${n} ${n > 1 ? 'positions ouvertes sont ignorées' : 'position ouverte est ignorée'} : leur perte latente n’est pas comptée.`,
  cashFlows: (n: number) =>
    `${n} ${n > 1 ? 'dépôts ou retraits sont ignorés' : 'dépôt ou retrait est ignoré'} par ces limites (les firmes n’en ont pas).`,
  beforeStart: (n: number) => `${n} ${n > 1 ? 'trades clôturés avant le début du défi ne comptent pas' : 'trade clôturé avant le début du défi ne compte pas'}.`,

  empty: {
    noAccountTitle: 'Aucun compte prop firm',
    noAccount:
      'Le suivi prop firm s’applique aux comptes de type « Prop firm ». Créez-en un, ou changez le type d’un compte existant, dans Paramètres, section Comptes.',
    noAccountAction: 'Ouvrir Paramètres > Comptes',
    noRulesTitle: 'Aucune règle paramétrée pour ce compte',
    noRules:
      'Chaque firme a ses propres règles : perte journalière maximale, perte maximale totale, objectif de profit, jours de trading minimum, règle de cohérence. Saisissez celles de votre défi : Pulse n’en devine aucune.',
    noRulesAction: 'Paramétrer les règles',
  },

  summary: {
    phase: 'Phase',
    started: (day: string) => `Défi commencé le ${day}`,
    balance: 'Solde (trades clôturés)',
    netPnl: 'Résultat depuis le début',
    initial: 'Capital initial',
    closedTrades: (n: number) => `${n} ${n > 1 ? 'trades clôturés comptés' : 'trade clôturé compté'}`,
    edit: 'Modifier les règles',
    alerts: 'Alertes prop firm',
    alertsHelp: 'Une alerte apparaît quand une règle atteint 70 % (à surveiller), 90 % (critique) puis 100 % (atteinte). Une amélioration ne crée jamais de nouvelle alerte.',
  },

  day: {
    current: (day: string, time: string) => `Jour de trading en cours depuis le ${day} à ${time} (heure de Paris)`,
    reset: (countdown: string, day: string, time: string) => `Remise à zéro dans ${countdown} (le ${day} à ${time}, heure de Paris)`,
    resetShort: (countdown: string, time: string) => `Remise à zéro dans ${countdown} (${time}, heure de Paris)`,
  },

  levels: {
    ok: 'Dans les limites',
    warning: 'À surveiller',
    critical: 'Critique',
    reached: 'Limite atteinte',
  } as Record<'ok' | 'warning' | 'critical' | 'reached', string>,
  consistencyReached: 'Règle dépassée',
  undefinedLevel: 'Non calculable',
  used: (pct: string) => `${pct} utilisé`,
  gaugeAria: (label: string, used: string, status: string) => `${label} : ${used}, ${status}`,
  remaining: (amount: string) => `Reste ${amount}`,
  exceededBy: (amount: string) => `Dépassée de ${amount}`,
  notSet: 'Règle non paramétrée',
  notSetAction: 'Paramétrer',

  cards: {
    dailyLoss: {
      title: 'Perte du jour',
      loss: 'Perte du jour de trading',
      limit: 'Limite',
      refInitial: (pct: string) => `${pct} du capital initial`,
      refDayStart: (pct: string) => `${pct} du solde de début de jour`,
      amount: 'Montant fixe',
      noLimit: 'Le solde de référence n’est pas positif : aucune limite ne peut être calculée.',
      trades: (n: number) => `${n} ${n > 1 ? 'trades clôturés' : 'trade clôturé'} dans ce jour de trading`,
    },
    maxLoss: {
      title: 'Perte maximale',
      static: 'Statique : plancher = capital initial − limite',
      trailing: 'Glissante : plancher = plus haut solde − limite',
      locked: 'Plancher arrêté au capital initial',
      lockNote: 'S’arrête au capital initial une fois atteint',
      floor: 'Plancher',
      peak: 'Plus haut solde',
      balance: 'Solde',
      limit: 'Limite',
      noLimit: 'Le capital initial n’est pas positif : aucune limite ne peut être calculée.',
    },
    profitTarget: {
      title: 'Objectif de profit',
      target: 'Objectif',
      gain: 'Gagné',
      left: (amount: string) => `Encore ${amount}`,
      reached: 'Objectif atteint',
      inProgress: 'En cours',
      progress: (pct: string) => `${pct} de l’objectif`,
      noTarget: 'Le capital initial n’est pas positif : aucun objectif ne peut être calculé.',
    },
    tradingDays: {
      title: 'Jours de trading',
      count: (n: number) => `${n} ${n > 1 ? 'jours de trading' : 'jour de trading'} avec un trade clôturé`,
      minimum: (n: number) => `Minimum demandé : ${n}`,
      missing: (n: number) => `Encore ${n} ${n > 1 ? 'jours' : 'jour'}`,
      done: 'Minimum atteint',
      noMinimum: 'Aucun minimum paramétré : nombre donné pour information.',
    },
    consistency: {
      title: 'Règle de cohérence',
      cap: (pct: string) => `Meilleur jour ≤ ${pct} du profit total`,
      best: 'Meilleur jour',
      bestDay: (day: string, time: string) => `commencé le ${day} à ${time} (heure de Paris)`,
      total: 'Profit total',
      share: (pct: string) => `Meilleur jour : ${pct} du profit total`,
      allowed: (amount: string) => `Le meilleur jour peut peser jusqu’à ${amount}`,
      respected: 'Respectée',
      noProfit: 'Pas de profit total positif : la part du meilleur jour n’est pas calculable.',
      equality: 'L’égalité avec le plafond compte comme respectée.',
    },
  },

  // Éditeur des règles (boîte de dialogue).
  editor: {
    title: (account: string) => `Règles du compte « ${account} »`,
    intro:
      'Saisissez les règles de votre défi telles que votre firme les écrit. Rien n’est deviné. Par exemple : 5 % de perte journalière, 10 % de perte maximale, 8 % d’objectif de profit (des valeurs d’exemple seulement : chaque firme a les siennes).',
    phase: 'Phase (facultatif)',
    phasePlaceholder: 'Évaluation 1, Financé…',
    phaseHelp: 'Texte libre pour vous repérer. Il ne change aucun calcul.',
    startedOn: 'Début du défi',
    startedOnHelp: 'Les trades clôturés avant 00:00 de ce jour (dans le fuseau de la remise à zéro) ne comptent pas.',
    reset: 'Remise à zéro du jour de trading',
    resetTime: 'Heure',
    resetTimeHelp: 'Heure à laquelle votre firme change de jour de trading, au format HH:MM (par exemple 00:00 ou 17:00).',
    resetZone: 'Fuseau',
    resetZoneHelp: 'Seuls Paris et New York sont proposés : Pulse connaît leurs changements d’heure. Tout autre fuseau serait deviné.',
    zones: { paris: 'Paris', newYork: 'New York' } as Record<'paris' | 'newYork', string>,
    modes: { percent: '%', amount: 'Montant' } as Record<'percent' | 'amount', string>,
    modeLabel: 'Unité',
    value: 'Valeur',
    dailyLoss: 'Perte journalière maximale',
    dailyLossHelp: 'Perte nette maximale des trades clôturés dans un même jour de trading.',
    dailyReference: 'Base du pourcentage',
    dailyReferenceHelp: 'Capital initial : la même limite chaque jour. Solde de début de jour : la limite suit votre solde (trades clôturés).',
    references: { initialBalance: 'Capital initial', dayStartBalance: 'Solde de début de jour' } as Record<'initialBalance' | 'dayStartBalance', string>,
    maxLoss: 'Perte maximale totale',
    maxLossHelp: 'Perte maximale depuis le début du défi, en pourcentage du capital initial ou en montant.',
    maxLossKind: 'Type',
    maxLossKindHelp: 'Statique : plancher fixe sous le capital initial. Glissante : le plancher monte avec votre plus haut solde.',
    kinds: { static: 'Statique', trailing: 'Glissante' } as Record<'static' | 'trailing', string>,
    locks: 'Le plancher glissant s’arrête au capital initial',
    locksHelp: 'Une fois le plancher monté jusqu’au capital initial, il ne monte plus.',
    profitTarget: 'Objectif de profit',
    profitTargetHelp: 'Gain à atteindre depuis le début du défi, en pourcentage du capital initial ou en montant.',
    minTradingDays: 'Jours minimum (facultatif)',
    minTradingDaysHelp: 'Nombre de jours de trading distincts ayant au moins un trade clôturé.',
    consistency: 'Règle de cohérence (facultatif)',
    consistencySuffix: '% du profit',
    consistencyHelp: 'Part maximale du profit total que peut peser votre meilleur jour (par exemple 30). L’égalité est respectée.',
    enable: (rule: string) => `Paramétrer « ${rule} »`,
    save: 'Enregistrer les règles',
    saving: 'Enregistrement…',
    cancel: 'Annuler',
    remove: 'Supprimer les règles',
    removeConfirm: 'Supprimer toutes les règles de ce compte ? Vos trades ne sont pas touchés.',
    removeYes: 'Oui, supprimer',
    help: (field: string) => `Aide : ${field}`,
  },

  // Contrôles de saisie (interface) et refus de pulse-core (`prop:<code>[:<champ>]`), qui fait foi.
  errors: {
    required: 'Champ obligatoire.',
    number: 'Saisissez un nombre (par exemple 5 ou 2,5).',
    percent: 'Un pourcentage doit être supérieur à 0 et au plus 100.',
    amount: 'Un montant doit être supérieur à 0.',
    day: 'Date invalide.',
    time: 'Heure invalide : format HH:MM, de 00:00 à 23:59.',
    wholeDays: `Nombre entier de 1 à 1000.`,
    codes: {
      notProp: 'Ce compte n’est pas de type « Prop firm ».',
      phaseLabelTooLong: 'Phase trop longue (60 caractères au plus).',
      invalidStartDay: 'Date de début invalide.',
      invalidMode: 'Unité inconnue.',
      invalidNumber: 'Nombre illisible.',
      percentOutOfRange: 'Un pourcentage doit être supérieur à 0 et au plus 100.',
      amountNotPositive: 'Un montant doit être supérieur à 0.',
      invalidDailyReference: 'Base du pourcentage inconnue.',
      invalidMaxLossKind: 'Type de perte maximale inconnu.',
      invalidResetTime: 'Heure de remise à zéro invalide (HH:MM).',
      unknownZone: 'Fuseau inconnu : seuls Paris et New York sont acceptés.',
      minTradingDaysOutOfRange: 'Jours de trading minimum : de 1 à 1000.',
    } as Record<string, string>,
    fields: {
      dailyLoss: 'perte journalière',
      maxLoss: 'perte maximale',
      profitTarget: 'objectif de profit',
      consistency: 'règle de cohérence',
    } as Record<string, string>,
    withField: (text: string, field: string) => `${text} (${field})`,
  },

  // Alertes (bannière et historique) : constats, jamais un ordre.
  alerts: {
    phase: (label: string) => ` (${label})`,
    dailyLoss: (level: string, phase: string, used: string, remaining: string, reset: string) =>
      `Prop firm${phase} : perte du jour à ${used} de la limite (${level}), ${remaining}. Remise à zéro à ${reset}, heure de Paris. À surveiller ; calcul sur les trades clôturés seulement, à vérifier chez la firme.`,
    maxLoss: (level: string, phase: string, used: string, remaining: string) =>
      `Prop firm${phase} : perte maximale à ${used} de la limite (${level}), ${remaining}. À surveiller ; calcul sur les trades clôturés seulement, à vérifier chez la firme.`,
    consistency: (level: string, phase: string, share: string, cap: string) =>
      `Prop firm${phase} : votre meilleur jour pèse ${share} du profit total, pour un plafond de ${cap} (${level}). À surveiller ; calcul sur les trades clôturés seulement.`,
    remaining: (amount: string) => `reste ${amount}`,
    exceeded: (amount: string) => `dépassée de ${amount}`,
    kinds: { propDailyLoss: 'Prop firm : perte du jour', propMaxLoss: 'Prop firm : perte maximale', propConsistency: 'Prop firm : cohérence' },
  },

  // Widget du tableau de bord.
  widget: {
    title: 'Prop firm',
    noAccount: 'Choisissez un compte prop firm dans les réglages de ce widget ou dans la barre du haut.',
    notProp: 'Ce compte n’est pas un compte prop firm.',
    noRules: 'Aucune règle paramétrée pour ce compte.',
    open: 'Ouvrir le suivi prop firm',
  },
}
