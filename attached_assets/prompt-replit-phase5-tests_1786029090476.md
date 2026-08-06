# Prompt Replit — phase 5 : les tests (+ les 4 correctifs)

> À coller tel quel dans l'agent Replit, sur la branche `rls-scope-test`.
> C'est la dernière phase du prompt précédent, plus les quatre points relevés à l'audit.

---

```
Tu es sur la branche rls-scope-test. Les phases 1 à 4 sont faites et le code est bon.
Il manque la phase 5 — les tests — et quatre correctifs relevés en relecture.

Fais les correctifs D'ABORD (ils sont courts), puis la phase 5. Arrête-toi entre les
deux et montre-moi le résultat.

═══════════════════════════════════════════════
CORRECTIFS (avant les tests)
═══════════════════════════════════════════════

A) SEEDS SOUS RLS
   lib/db/src/seed-metier.ts et lib/db/src/seed-platform.ts insèrent dans devis,
   classeur_documents, echeances, team_members et connectors via `db` directement.
   L'application tourne avec app_user et FORCE ROW LEVEL SECURITY est actif : le
   WITH CHECK refusera ces insertions.
   Enveloppe tous ces accès dans withTenant(tenantId, async (tx) => …) et n'utilise
   plus que le `tx`. La lecture de la table `tenants` peut rester sur `db` (elle n'est
   pas soumise au RLS).
   Vérifie en lançant le seed sur une base vide : il doit passer.

B) SUPPRIME artifacts/api-server/src/lib/defaultTenant.ts
   C'est un reliquat de la phase 2. Il renvoie le tenant le plus ancien sans regarder
   la session — exactement ce qu'on ne veut plus. Il n'est plus appelé nulle part.
   Supprime le fichier et vérifie que rien ne casse au typecheck.

C) UNE SEULE COMMANDE D'INSTALLATION DE BASE
   Ajoute dans le package.json racine :
   "db:setup": "node lib/db/scripts/create-app-role.cjs && node lib/db/scripts/migrate-multitenant.cjs && node lib/db/scripts/migrate-rls.cjs && node lib/db/scripts/seed-owner.cjs"
   Et un README court dans lib/db/ qui donne l'ordre et dit lequel tourne avec
   DATABASE_URL (propriétaire) et lequel avec DATABASE_URL_APP.
   Objectif : reproduire l'installation complète sur un autre PostgreSQL sans mémoire.

D) MARQUE LE FAUX AGENT
   routes/chat.ts renvoie encore 5 réponses préenregistrées via AI_REPLIES.
   Ne le remplace pas maintenant, mais ajoute en tête du fichier un commentaire
   // STUB — aucune IA branchée. Ne pas démontrer comme un agent.
   et fais renvoyer par l'API un champ { stub: true } dans la réponse.

═══════════════════════════════════════════════
PHASE 5 — LES TESTS
═══════════════════════════════════════════════

Installe Vitest et configure une base PostgreSQL de test RÉELLE. Pas de mock : le RLS
ne se teste que contre un vrai Postgres. La base de test doit être créée par le même
enchaînement que la production (db:setup), sinon le test ne prouve rien sur la prod.

Les tests à écrire, dans cet ordre d'importance :

1) ISOLATION — le seul test qui compte.
   Pour CHACUNE des 15 tables métier : créer deux tenants A et B avec des lignes
   distinctes, lire sous withTenant(A), vérifier qu'aucune ligne de B ne remonte.

   PUIS, ET C'EST LE POINT CENTRAL : retire temporairement la policy tenant_isolation
   d'une table, relance ce test, et MONTRE-MOI QU'IL DEVIENT ROUGE. Puis remets la
   policy. Un test d'isolation qui reste vert sans policy ne teste rien — c'est
   généralement le signe que l'application tourne encore avec le propriétaire des
   tables. Je veux voir la capture de l'échec.

2) INSERTION CROISÉE — sous withTenant(A), tenter d'insérer une ligne portant le
   tenant_id de B : doit être refusé par le WITH CHECK.

3) FUITE DE CONTEXTE PAR LE POOL — deux requêtes successives sur la même connexion,
   tenants différents : la seconde ne voit rien de la première. C'est le test qui
   valide le troisième argument `true` de set_config.

4) TENANT FALSIFIÉ — envoyer un tenantId dans le corps JSON, dans un header et dans
   un paramètre d'URL : les trois doivent être sans effet, la session fait foi.

5) APPARTENANCE — utilisateur authentifié mais non membre du tenant de sa session
   (supprimer le membership en base entre deux requêtes) : 403.

6) SESSION — cookie absent → 401. Cookie expiré → 401. Cookie signé avec une autre
   clé → 401. Session supprimée en base → 401.

7) RÔLE — un MEMBER sur POST /equipe, /connecteurs, /parametres et
   DELETE /factures/:id → 403. Le même en OWNER → 2xx.

8) GARDE STRUCTURELLE — un test (ou une règle ESLint) qui échoue si une table métier
   est interrogée en dehors de withTenant. Écris-le de façon à ce qu'il détecte un
   `db.select().from(<table métier>)` ajouté demain. Une convention sans mécanisme se
   dégrade en quelques semaines.

9) CI — un workflow GitHub Actions qui lance typecheck + tests sur chaque push, avec
   un service postgres. Le workflow doit exécuter db:setup avant les tests.

RÈGLES
- Ne modifie aucune policy ni aucun middleware pour faire passer un test. Si un test
  échoue, c'est le code qui a un problème — dis-le moi au lieu d'adapter le test.
- Ne remplace pas un test d'intégration par un mock parce que la base est lente.
- Ne déclare pas la phase terminée sans m'avoir montré : la liste des tests verts, ET
  la capture du test d'isolation en rouge avec la policy retirée.
```

---

## Ce que tu vérifies toi-même à la fin

Quatre contrôles, dix minutes, et ils ne se délèguent pas :

`SELECT current_user` au démarrage doit afficher `app_user`. Le cookie, dans les outils
de développement, doit être un identifiant opaque et non une chaîne fixe. Deux comptes
réels sur deux tenants, connexion alternée, parcours des écrans : aucune donnée ne
traverse. Et la capture du test d'isolation en rouge — sans elle, tu n'as qu'une
promesse.

Ensuite seulement : la PR de `rls-scope-test` vers `main`, et le départ sur Scaleway.
