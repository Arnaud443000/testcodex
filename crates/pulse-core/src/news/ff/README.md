# Exemples de l'export hebdomadaire de Forex Factory (lot 28)

**Écrits d'après des extraits de documentation et de forums, non vérifiés sur une vraie réponse** :
le réseau de l'environnement de développement bloque `nfs.faireconomy.media` et `www.forexfactory.com`.
Événements et valeurs inventés (vraisemblables), semaine du dimanche 27 septembre au samedi 3 octobre 2026
(`thisweek`) et suivante (`nextweek`).

Forme supposée (d'après des tiers) : un tableau JSON d'objets `title`, `country` (en fait la **devise** ;
`All` = toutes), `date` (ISO 8601 **avec décalage**, heure de New York), `impact` (`High`, `Medium`, `Low`,
`Holiday`, `Non-Economic`), `forecast`, `previous` (texte, souvent vide). Un événement sans heure est
supposé écrit à `00:00:00` dans son décalage (à confirmer sur une vraie réponse).

Utilisés par les tests de `pulse-core` (`news/ff/tests.rs`) et de `pulse-news` (faux serveur local).
