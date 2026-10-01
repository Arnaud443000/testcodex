// Lot 34 : objectifs de comportement (processus). Typographie française : espace insécable (U+00A0)
// avant : ; ? ! % » et après «. Rattachés à `fr` sous la clé `processGoals`.
import type { ProcessMetric, ProcessPeriodKind, ProcessStatus, RequiredSetting } from '../types/processGoals'

const NB = ' '
const plural = (n: number, one: string, many: string) => `${n}${NB}${n > 1 ? many : one}`

export const frProcessGoals = {
  typeLabel: 'Type d’objectifs',
  subtitle: 'Vos objectifs de comportement, par semaine ou par mois',
  types: { results: 'Résultats', process: 'Comportement' },
  intro:
    'Des objectifs qui ne dépendent que de vous : vos stops, vos limites, vos règles, votre journal. Ils mesurent votre façon de trader, pas vos gains, et ne disent pas quoi faire.',
  closedNote: `Un trade compte dans la période où il est clôturé (jour et heure locaux). Le journal compte les jours de la période qui ont une entrée. Chaque valeur vient du même rapport que les pages Comportement, Discipline et Comparaisons${NB}: mêmes définitions, mêmes seuils.`,
  kindLabel: 'Durée des objectifs',
  kinds: { week: 'Semaine', month: 'Mois' } as Record<ProcessPeriodKind, string>,
  previous: { week: 'Semaine précédente', month: 'Mois précédent' } as Record<ProcessPeriodKind, string>,
  next: { week: 'Semaine suivante', month: 'Mois suivant' } as Record<ProcessPeriodKind, string>,
  backToCurrent: { week: 'Cette semaine', month: 'Ce mois-ci' } as Record<ProcessPeriodKind, string>,
  weekTitle: (week: number) => `Semaine ${week}`,
  weekRange: (from: string, to: string) => `du ${from} au ${to}`,
  periodState: { past: 'Terminée', current: 'En cours', future: 'À venir' },
  periodStateMonth: { past: 'Terminé', current: 'En cours', future: 'À venir' },

  metrics: {
    no_stop_trades: 'Trades sans stop',
    overtrading_days: 'Jours de surtrading',
    revenge_trades: 'Trades de revanche',
    risk_breaches: 'Dépassements du risque max',
    rules_respect_rate: 'Règles respectées',
    plan_follow_rate: 'Plan suivi',
    journal_days: 'Jours de journal',
  } as Record<ProcessMetric, string>,
  /** L'objectif en une phrase, à partir de la cible (nombre entier ou pourcentage déjà formaté). */
  sentence: {
    no_stop_trades: (n: number) => (n === 0 ? 'Aucun trade sans stop' : `Au plus ${plural(n, 'trade', 'trades')} sans stop`),
    overtrading_days: (n: number) => (n === 0 ? 'Aucun jour de surtrading' : `Au plus ${plural(n, 'jour', 'jours')} de surtrading`),
    revenge_trades: (n: number) => (n === 0 ? 'Aucun trade de revanche' : `Au plus ${plural(n, 'trade', 'trades')} de revanche`),
    risk_breaches: (n: number) => (n === 0 ? 'Aucun dépassement du risque max' : `Au plus ${plural(n, 'dépassement', 'dépassements')} du risque max`),
    rules_respect_rate: (pct: string) => `Au moins ${pct} de règles respectées`,
    plan_follow_rate: (pct: string) => `Au moins ${pct} des trades dans le plan`,
    journal_days: (n: number) => `Au moins ${plural(n, 'jour', 'jours')} de journal`,
  },
  help: {
    no_stop_trades: 'Trades clôturés sans stop loss prévu valide : le même test que le score de discipline et l’alerte « sans stop loss ».',
    overtrading_days: `Jours où vous avez dépassé votre limite de trades par jour (page Comportement${NB}; un jour par compte).`,
    revenge_trades: 'Trades pris trop gros trop vite après une perte, selon votre définition de la revanche (page Comportement).',
    risk_breaches: 'Trades dont le risque initial dépasse votre risque max par trade, en % du solde à l’entrée (page Comparaisons).',
    rules_respect_rate: 'Règles respectées sur l’ensemble des règles cochées sur vos trades de la période.',
    plan_follow_rate: 'Trades « dans le plan » parmi ceux dont le plan est renseigné (au moins 5).',
    journal_days: 'Jours de la période qui ont une entrée dans le journal quotidien.',
  } as Record<ProcessMetric, string>,
  /** Pourquoi il n'y a pas de valeur. */
  noData: {
    no_stop_trades: 'Aucun trade clôturé sur la période.',
    overtrading_days: 'Aucun trade clôturé sur la période.',
    revenge_trades: 'Aucun trade clôturé sur la période.',
    risk_breaches: 'Aucun trade mesurable : il faut un trade clôturé avec un stop prévu.',
    rules_respect_rate: 'Aucune règle cochée sur les trades de la période.',
    plan_follow_rate: 'Moins de 5 trades avec le plan renseigné sur la période.',
    journal_days: 'Aucune entrée de journal.',
  } as Record<ProcessMetric, string>,

  statuses: {
    respectedSoFar: 'Respecté jusqu’ici',
    exceeded: 'Dépassé',
    respected: 'Respecté',
    reached: 'Atteint',
    inProgress: 'En cours',
    missed: 'Manqué',
    noData: 'Pas de données',
    settingRequired: 'Réglage requis',
  } as Record<ProcessStatus, string>,
  statusHelp: {
    respectedSoFar: 'Le plafond n’est pas franchi ; la période n’est pas finie.',
    exceeded: 'Le plafond est franchi : c’est définitif pour cette période.',
    respected: 'La période est finie et le plafond n’a pas été franchi.',
    reached: 'La cible est atteinte.',
    inProgress: 'La cible n’est pas encore atteinte ; la période n’est pas finie.',
    missed: 'La période est finie et la cible n’a pas été atteinte.',
    noData: 'Rien à mesurer pour l’instant : ce n’est ni une réussite ni un échec.',
    settingRequired: 'Cet objectif s’appuie sur un seuil de discipline qui n’est pas réglé.',
  } as Record<ProcessStatus, string>,

  ceiling: 'Plafond',
  floor: 'Cible',
  actual: 'Réalisé',
  count: {
    no_stop_trades: (n: number) => plural(n, 'trade', 'trades'),
    overtrading_days: (n: number) => plural(n, 'jour', 'jours'),
    revenge_trades: (n: number) => plural(n, 'trade', 'trades'),
    risk_breaches: (n: number) => plural(n, 'dépassement', 'dépassements'),
    journal_days: (n: number) => plural(n, 'jour', 'jours'),
  } as Record<string, (n: number) => string>,
  ratio: {
    rules_respect_rate: (a: number, b: number) => `${a} ${a > 1 ? 'coches respectées' : 'coche respectée'} sur ${b}`,
    plan_follow_rate: (a: number, b: number) => `${plural(a, 'trade', 'trades')} dans le plan sur ${b}`,
  } as Record<string, (a: number, b: number) => string>,
  tradeCount: (n: number) => (n === 0 ? 'aucun trade clôturé' : `${plural(n, 'trade clôturé', 'trades clôturés')}`),
  streak: (n: number, kind: ProcessPeriodKind) =>
    kind === 'week' ? `${plural(n, 'semaine', 'semaines')} de suite` : `${n}${NB}mois de suite`,
  streakHelp: (kind: ProcessPeriodKind) =>
    kind === 'week'
      ? 'Semaines terminées et réussies juste avant celle-ci, avec cet objectif (52 au plus).'
      : 'Mois terminés et réussis juste avant celui-ci, avec cet objectif (52 au plus).',
  seeTrades: (n: number) => (n === 1 ? 'Voir le trade' : `Voir les ${n}${NB}trades`),
  days: (list: string) => `Jours${NB}: ${list}`,
  settingRequired: {
    maxTradesPerDay: 'Réglez d’abord votre limite de trades par jour : sans elle, le surtrading n’est pas détecté.',
    maxRiskPercent: 'Réglez d’abord votre risque max par trade : sans lui, aucun dépassement n’est mesuré.',
  } as Record<RequiredSetting, string>,
  openSettings: 'Ouvrir les seuils de discipline',
  edit: 'Modifier',
  editLabel: (label: string) => `Modifier l’objectif ${label}`,
  delete: 'Supprimer',
  deleteLabel: (label: string) => `Supprimer l’objectif ${label}`,
  deleteConfirm: 'Supprimer cet objectif de la période ?',
  deleteYes: 'Supprimer',
  cancel: 'Annuler',
  add: 'Ajouter un objectif',
  copy: (label: string) => `Reprendre les objectifs de ${label}`,
  copyLabel: { week: 'la semaine précédente', month: 'du mois précédent' } as Record<ProcessPeriodKind, string>,
  copyDone: (n: number) => (n === 0 ? 'Rien à reprendre.' : `${plural(n, 'objectif', 'objectifs')} dans la période.`),

  empty: {
    title: { week: 'Aucun objectif de comportement cette semaine', month: 'Aucun objectif de comportement ce mois-ci' } as Record<ProcessPeriodKind, string>,
    titleOther: { week: 'Aucun objectif de comportement pour cette semaine', month: 'Aucun objectif de comportement pour ce mois' } as Record<ProcessPeriodKind, string>,
    text: 'Choisissez ce qui dépend de vous. Voici trois objectifs types, à créer en un clic ; vous pourrez les modifier.',
    templatesTitle: 'Objectifs types',
    create: 'Créer',
    createLabel: (sentence: string) => `Créer l’objectif « ${sentence} »`,
    custom: 'Autre objectif…',
  },

  dialog: {
    createTitle: 'Nouvel objectif de comportement',
    editTitle: 'Modifier l’objectif',
    metric: 'Ce que vous mesurez',
    target: { atMost: 'Plafond (au plus)', atLeast: 'Cible (au moins)' },
    unit: {
      no_stop_trades: 'trades',
      overtrading_days: 'jours',
      revenge_trades: 'trades',
      risk_breaches: 'dépassements',
      rules_respect_rate: '%',
      plan_follow_rate: '%',
      journal_days: 'jours',
    } as Record<ProcessMetric, string>,
    targetHelp: {
      count: 'Un nombre entier, de 0 à 10 000. 0 = aucun.',
      percent: 'Un pourcentage, plus de 0 et au plus 100 (virgule acceptée).',
      journalWeek: 'Un nombre de jours, de 1 à 7.',
      journalMonth: 'Un nombre de jours, de 1 à 31.',
    },
    alsoNext: { week: 'Ajouter aussi cet objectif à la semaine suivante', month: 'Ajouter aussi cet objectif au mois suivant' } as Record<ProcessPeriodKind, string>,
    alsoNextHelp: 'La semaine ou le mois suivant garde sa propre cible s’il en a déjà une pour cette mesure.',
    period: (label: string) => `Période${NB}: ${label}`,
    settingWarning: {
      maxTradesPerDay: 'Votre limite de trades par jour n’est pas réglée : l’objectif affichera « Réglage requis ».',
      maxRiskPercent: 'Votre risque max par trade n’est pas réglé : l’objectif affichera « Réglage requis ».',
    } as Record<RequiredSetting, string>,
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    exists: 'Cette mesure a déjà un objectif sur la période : il sera remplacé.',
  },
  errors: {
    empty: 'Indiquez une valeur.',
    notNumber: 'Ce n’est pas un nombre.',
    count: 'Un nombre entier de 0 à 10 000.',
    percent: 'Un pourcentage, plus de 0 et au plus 100.',
    journalWeek: 'Un nombre entier de jours de 1 à 7.',
    journalMonth: 'Un nombre entier de jours de 1 à 31.',
  },
  loadError: (detail: string) => `Impossible de charger les objectifs de comportement : ${detail}`,
  saveError: (detail: string) => `Impossible d’enregistrer : ${detail}`,
  mixedCurrencies: 'Les comptes affichés n’ont pas tous la même devise : choisissez un compte dans la barre du haut.',
  loading: 'Chargement…',

  widget: {
    empty: { week: 'Aucun objectif de comportement cette semaine.', month: 'Aucun objectif de comportement ce mois-ci.' } as Record<ProcessPeriodKind, string>,
    emptyAction: 'Créer un objectif',
    manage: 'Gérer',
    period: { week: 'Cette semaine', month: 'Ce mois-ci' } as Record<ProcessPeriodKind, string>,
  },
}
