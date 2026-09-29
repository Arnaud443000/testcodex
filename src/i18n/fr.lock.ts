/** Textes du verrouillage par mot de passe (lot 22). Rattachés à `fr` sous la clé `lock`. */

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)

export const frLock = {
  screen: {
    title: 'Pulse est verrouillé',
    intro: 'Vos données sont chiffrées sur ce PC. Entrez votre mot de passe pour les ouvrir.',
    passwordLabel: 'Mot de passe',
    show: 'Afficher le mot de passe',
    hide: 'Masquer le mot de passe',
    submit: 'Déverrouiller',
    submitting: 'Vérification…',
    waiting: (wait: string) => `Réessayez dans ${wait}`,
    failures: (n: number) =>
      `${n} ${plural(n, 'essai manqué', 'essais manqués')}. Après 3 erreurs, un délai croissant s’applique entre deux essais. Rien n’est jamais effacé.`,
    lost: 'Mot de passe oublié : vos données ne peuvent pas être récupérées. Il n’existe aucune porte dérobée, aucune question secrète, aucune réinitialisation.',
    simulation: 'Aucun chiffrement réel n’a lieu dans cet aperçu.',
    loading: 'Ouverture de Pulse…',
  },
  errors: {
    locked: 'Pulse est verrouillé : entrez votre mot de passe.',
    wrongPassword: 'Mot de passe incorrect.',
    retryLater: (wait: string) => `Trop d’essais : réessayez dans ${wait}.`,
    notEncrypted: 'La base n’est pas chiffrée.',
    alreadyEncrypted: 'Le verrouillage est déjà activé.',
    corrupt:
      'Le fichier chiffré est abîmé ou a été modifié : il ne peut pas être ouvert. Les copies de sécurité automatiques se trouvent dans le dossier « backups » du dossier de données.',
    unsupportedVersion: 'Ce fichier a été chiffré par une version plus récente de Pulse.',
    passwordTooShort: (n: number) => `Le mot de passe doit contenir au moins ${n} caractères.`,
    passwordTooLong: 'Le mot de passe est trop long (1 024 octets au plus).',
    notConfirmed: 'Cochez « J’ai compris » pour confirmer que vous acceptez ce risque.',
    persistFailed:
      'Les dernières modifications n’ont pas pu être écrites sur le disque (disque plein, droits, antivirus ?). Elles restent en mémoire tant que Pulse reste ouvert.',
    verifyFailed: 'La copie ne s’est pas relue à l’identique : rien n’a été changé, votre base d’origine est intacte.',
    inconsistentFiles:
      'Deux bases ont été trouvées dans le dossier de données (pulse.db et pulse.db.enc) sans opération en cours. Pulse a ouvert pulse.db comme avant et n’a rien supprimé : vérifiez ce dossier.',
    backupPasswordRequired: 'Cette sauvegarde est chiffrée : entrez le mot de passe qui était en vigueur quand elle a été faite.',
    invalidIdle: 'Durée d’inactivité invalide (de 1 à 1 440 minutes).',
    random: 'Le générateur aléatoire du système n’a pas répondu. Réessayez.',
    io: 'Accès au fichier impossible (disque plein, droits, antivirus ?). Rien n’a été changé.',
    mismatch: 'Les deux mots de passe ne sont pas identiques.',
    empty: 'Entrez le mot de passe.',
    unknown: (message: string) => `Erreur : ${message}`,
  },
  settings: {
    title: 'Sécurité : verrouillage par mot de passe',
    intro:
      'Optionnel, désactivé par défaut. Une fois activé, Pulse demande un mot de passe au lancement, et la base (trades, journal, notes, commentaires de l’IA, conversations du coach) ainsi que les captures d’écran sont chiffrées sur le disque avec une clé tirée de ce mot de passe.',
    offState: 'Désactivé : vos données sont enregistrées en clair dans le dossier de Pulse, comme jusqu’ici.',
    onState: 'Activé : la base et les captures sont chiffrées sur le disque.',
    protectsTitle: 'Ce que le verrou protège',
    protects: 'Un PC partagé, un disque volé ou perdu, une copie de vos fichiers.',
    notProtectsTitle: 'Ce qu’il ne protège pas',
    notProtects:
      'Un PC déjà infecté (logiciel espion, enregistreur de frappe), ni quelqu’un qui utilise votre session pendant que Pulse est déverrouillé : la mémoire de Pulse ouvert contient vos données en clair.',
    enableButton: 'Activer le verrouillage…',
    enableTitle: 'Activer le verrouillage',
    newPassword: 'Mot de passe',
    confirmPassword: 'Confirmer le mot de passe',
    policy: (n: number) =>
      `Au moins ${n} caractères. Pulse ne juge pas la « force » d’un mot de passe : une phrase de plusieurs mots, facile à retenir pour vous seul, vaut mieux qu’un mot compliqué. Majuscules, accents et espaces comptent.`,
    lostTitle: 'Mot de passe perdu = données irrécupérables',
    lostBody:
      'Pulse ne garde ni votre mot de passe ni aucune clé de secours. Si vous l’oubliez, personne — ni vous, ni une assistance, ni Pulse — ne pourra plus ouvrir vos données ni vos sauvegardes chiffrées. Il n’existe aucune porte dérobée. Notez-le dans un endroit sûr.',
    understood: 'J’ai compris : si je perds ce mot de passe, mes données sont perdues pour de bon.',
    copies: (n: number) =>
      n === 1
        ? 'Chiffrer aussi la copie de sécurité en clair du dossier « backups » (copie automatique faite avant une migration ou une restauration).'
        : `Chiffrer aussi les ${n} copies de sécurité en clair du dossier « backups » (copies automatiques faites avant une migration ou une restauration).`,
    copiesLeft: (n: number) =>
      `${n} ${plural(n, 'copie de sécurité reste', 'copies de sécurité restent')} en clair dans le dossier « backups » : elles ne sont pas protégées.`,
    enableSubmit: 'Chiffrer et activer',
    enabling: 'Chiffrement et vérification en cours…',
    enabled: 'Verrouillage activé : la base et les captures sont chiffrées. Pulse demandera le mot de passe au prochain lancement.',
    oldBackups:
      'Les sauvegardes faites avant l’activation, ailleurs que dans le dossier de Pulse, restent en clair : supprimez-les si elles ne doivent plus être lisibles.',
    lockNow: 'Verrouiller maintenant',
    idleTitle: 'Verrouiller après une inactivité',
    idleHelp: 'Sans clavier ni souris dans Pulse pendant cette durée, Pulse se verrouille tout seul. Les actualisations automatiques ne comptent pas comme une activité.',
    idleLabel: 'Délai d’inactivité',
    idleNever: 'Jamais (par défaut)',
    idleMinutes: (m: number) => `Après ${m} min`,
    idleSaved: 'Délai enregistré.',
    changeTitle: 'Changer le mot de passe',
    currentPassword: 'Mot de passe actuel',
    newPasswordChange: 'Nouveau mot de passe',
    confirmNewPassword: 'Confirmer le nouveau mot de passe',
    changeSubmit: 'Changer le mot de passe',
    changing: 'Changement en cours…',
    changed: 'Mot de passe changé. Les sauvegardes déjà faites s’ouvrent toujours avec l’ancien.',
    changeNote:
      'La clé qui chiffre vos données ne change pas : quelqu’un qui connaissait l’ancien mot de passe et a gardé une ancienne copie du fichier pourrait encore lire les nouvelles. Pour une nouvelle clé, désactivez puis réactivez le verrouillage.',
    disableTitle: 'Désactiver le verrouillage',
    disableHelp:
      'La base et les captures redeviennent lisibles en clair sur ce PC. Les sauvegardes chiffrées déjà faites restent chiffrées : elles se restaurent avec leur mot de passe.',
    disableSubmit: 'Déchiffrer et désactiver',
    disabling: 'Déchiffrement et vérification en cours…',
    disabled: 'Verrouillage désactivé : les données sont de nouveau enregistrées en clair.',
    exportNote: 'L’export CSV et l’export de configuration de dashboard produisent des fichiers en clair : c’est leur but.',
    cancel: 'Annuler',
    simulation: 'Aucun chiffrement réel dans cet aperçu, et le mot de passe n’est gardé nulle part.',
    on: 'Activé',
    off: 'Désactivé',
    tabsLabel: 'Actions du verrouillage',
  },
  sidebar: { lock: 'Verrouiller', lockHint: 'Verrouiller Pulse maintenant' },
  persist: {
    title: 'Vos dernières modifications ne sont pas enregistrées',
    retry: 'Réessayer',
    retried: 'Enregistré.',
    quit: 'Fermer sans enregistrer',
    quitConfirm: 'Fermer Pulse maintenant ? Les modifications qui ne sont qu’en mémoire seront perdues.',
  },
  data: {
    encryptedBadge: 'Sauvegarde chiffrée',
    backupPasswordLabel: 'Mot de passe de cette sauvegarde',
    backupPasswordHelp: 'Celui qui était en vigueur quand la sauvegarde a été faite (pas forcément celui d’aujourd’hui).',
    open: 'Ouvrir la sauvegarde',
    csvPlain: 'Verrouillage actif : le fichier CSV exporté n’est pas chiffré.',
    backupEncrypted: 'Verrouillage actif : la sauvegarde sera chiffrée et s’ouvrira avec votre mot de passe actuel.',
    restoreIntoPlain: 'Cette sauvegarde est chiffrée ; le verrouillage étant désactivé, elle sera restaurée en clair.',
  },
  wait: (ms: number) => {
    const s = Math.max(1, Math.ceil(ms / 1000))
    if (s < 60) return `${s} s`
    const m = Math.floor(s / 60)
    const r = s % 60
    return r === 0 ? `${m} min` : `${m} min ${r} s`
  },
}
