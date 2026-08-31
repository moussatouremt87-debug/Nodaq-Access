# Connecteurs sans jargon — plan d’implémentation

## Vue d’ensemble

Remplacer la saisie de secrets par des autorisations hébergées pour Pennylane,
Stripe, Google Drive et Slack. Conserver un mode avancé limité aux seuls cas où
une clé reste légitime, puis guider l’artisan par des résultats métier : inviter
son comptable ou préparer une automatisation sans annoncer qu’elle fonctionne
avant une connexion vérifiée.

## Contexte

L’écran actuel demande aux utilisateurs de créer et copier des clés API, des
secrets OAuth et des webhooks. Ce sont des identifiants de plateforme ou des
outils de développeur. Le produit doit les porter lui-même et laisser le
fournisseur afficher l’écran de consentement.

## Approche

- Ajouter un registre OAuth serveur pour `PENNYLANE`, `STRIPE`,
  `GOOGLE_DRIVE` et `SLACK`, configuré exclusivement par variables
  d’environnement.
- Créer un état OAuth signé, court et lié à la session, au tenant et au
  fournisseur. Le callback reste protégé par la session OWNER existante.
- Valider les réponses externes avec Zod et chiffrer les jetons dans
  `tenant_secrets`. `connectors.config` ne garde que des métadonnées non
  sensibles.
- Exposer la disponibilité de chaque parcours sans révéler quelle variable de
  production manque.
- Restreindre le mode avancé à un jeton Pennylane et une URL Zapier. Les secrets
  sont chiffrés et ne sont jamais relus par l’interface.
- Remplacer la grille technique par des recettes orientées bénéfice. Une recette
  non connectée est `À connecter`, jamais `Active`.
- Ajouter un raccourci vers la vraie invitation `ACCOUNTANT` existante.
- Ne modifier ni Bridge ni le connecteur bancaire.

## Tâches

1. Écrire les tests API rouges : disponibilité, création d’autorisation, état
   signé, callback, chiffrement, mode avancé et déconnexion.
2. Implémenter le registre OAuth, les routes et la persistance chiffrée.
3. Écrire les tests front rouges sur l’absence de secrets grand public, le mode
   avancé, l’invitation comptable et les recettes honnêtes.
4. Recomposer l’écran Connecteurs avec les parcours orientés résultat.
5. Documenter les variables de déploiement et ajouter les gardes structurelles.
6. Vérifier à froid le typecheck, les tests ciblés puis la suite complète sur
   PostgreSQL 16 vierge.

## Critères de réussite

- Aucun client ID, client secret, webhook ou clé Stripe/Google/Slack n’est
  demandé à l’utilisateur.
- Aucun jeton OAuth ou identifiant avancé ne vit en clair dans
  `connectors.config`.
- Un fournisseur non configuré est présenté comme indisponible, sans erreur
  technique après le clic.
- Pennylane, Stripe, Google Drive et Slack démarrent une autorisation externe
  avec état anti-CSRF et callback validé.
- Le raccourci comptable utilise la route d’invitation réelle.
- Les recettes distinguent clairement `À connecter`, `Prête` et `Active`.
- Bridge reste inchangé.

## Risques connus

- Les identifiants OAuth de production doivent être obtenus auprès de chaque
  fournisseur avant activation réelle.
- Une connexion OAuth prouve l’autorisation ; elle ne suffit pas à inventer un
  moteur de synchronisation absent. L’interface ne doit jamais confondre les
  deux.
- Les callbacks dépendent du maintien de la session Nodaq dans le navigateur ;
  une session expirée oblige à recommencer l’autorisation.
