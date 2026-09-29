/**
 * Textes de l'interface. Le français est la langue par défaut.
 * Pour ajouter une langue : créer un objet du même type `Messages` et le
 * renvoyer depuis `useT()` (src/i18n/index.ts).
 */
export const fr = {
  nav: {
    dashboard: 'Tableau de bord',
    trades: 'Trades',
    calendar: 'Calendrier',
    analytics: 'Analyses',
    behavior: 'Comportement',
    journal: 'Journal',
    goals: 'Objectifs',
    settings: 'Paramètres',
  },
  sidebar: {
    user: 'Trader',
    local: 'Local',
    accounts: (n: number) => `${n} ${n > 1 ? 'comptes' : 'compte'}`,
  },
  topbar: {
    account: 'Compte',
    allAccounts: 'Tous les comptes',
    period: 'Période',
    periods: { '1D': '1J', '1W': '1S', '1M': '1M', '3M': '3M', '1Y': '1A', ALL: 'Tout' } as Record<string, string>,
    notifications: 'Notifications',
    newTrade: 'Nouveau trade',
  },
  dashboard: {
    title: 'Tableau de bord',
    subtitle: 'Votre performance de trading en un coup d’œil',
    welcomeTitle: 'Bienvenue dans Pulse',
    welcomeText:
      'Pulse garde tout sur cet ordinateur. Commencez par créer un compte de trading, puis enregistrez vos trades et le processus qui les accompagne.',
    createFirstAccount: 'Créer mon premier compte',
    noTradesTitle: 'Aucun trade enregistré',
    noTradesText:
      'Dès que vous enregistrerez des trades, votre P&L net, votre courbe d’équité, votre score de discipline et vos enseignements apparaîtront ici.',
    addFirstTrade: 'Ajouter mon premier trade',
  },
  placeholder: {
    title: 'Bientôt disponible',
    text: (step: number) =>
      `Cet écran est prévu à l’étape ${step} de la feuille de route. La mise en page, la navigation et le stockage des données qu’il utilisera sont déjà en place.`,
  },
  pages: {
    trades: { title: 'Trades', subtitle: 'Chaque trade, avec le processus qui l’accompagne' },
    calendar: { title: 'Calendrier', subtitle: 'Votre P&L jour par jour' },
    analytics: { title: 'Analyses', subtitle: 'Performance par setup, actif, jour et heure' },
    behavior: { title: 'Comportement', subtitle: 'Ce que votre processus dit de vos résultats' },
    journal: { title: 'Journal', subtitle: 'Votre réflexion quotidienne' },
    goals: { title: 'Objectifs', subtitle: 'Vos cibles mensuelles' },
  },
  settings: {
    title: 'Paramètres',
    subtitle: 'Comptes et informations sur l’application',
    accountsTitle: 'Comptes de trading',
    name: 'Nom',
    namePlaceholder: 'Compte principal',
    type: 'Type',
    kinds: { personal: 'Personnel', prop: 'Prop firm', demo: 'Démo' },
    broker: 'Courtier',
    currency: 'Devise',
    initialCapital: 'Capital initial',
    add: 'Ajouter le compte',
    errNameRequired: 'Le nom du compte est obligatoire.',
    errCapital: 'Le capital initial doit être un nombre positif.',
    errSave: (detail: string) => `Impossible d’enregistrer le compte : ${detail}`,
    aboutTitle: 'À propos',
    version: 'Version',
    dataFolder: 'Dossier des données',
    schema: 'Schéma de la base',
    browserPreview: '(aperçu dans le navigateur)',
  },
}

export type Messages = typeof fr
