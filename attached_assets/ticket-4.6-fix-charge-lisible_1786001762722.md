# Ticket 4.6 — Fix « Capacité / Performance » : des dates et des euros, plus de ratios

> **Comment l'utiliser** : Claude Code, plan mode d'abord, puis « PROMPT À COLLER ».
> Estimé : **4-5 jours**. Corrige les écrans « Capacité vs charge estimée » et
> « Performance horaire réalisée », qui affichent aujourd'hui des chiffres faux et des
> verdicts inversés.
>
> Maquette de référence : **`maquette-equipe-planning.html`** — elle ne couvre QUE
> l'écran « Équipe & plannings ». La marge, le « ce qu'il reste » et le détail par
> chantier n'y figurent pas : ils appartiennent au cockpit et à la fiche affaire.
> **Une page = une question.**

---

## 1. Ce qui ne va pas aujourd'hui (constaté à l'écran)

| Symptôme observé | Cause |
|---|---|
| « ok » affiché alors que l'équipe est occupée à 14 % | verdict fondé sur `capacité − charge > 0` au lieu d'un taux d'occupation |
| « sous-objectif » en rouge sur des mois à 0 € | jugement rendu sur une **absence de données** |
| 200 €/h affiché | `CA ÷ heures théoriques constantes` — le ratio recopie le CA |
| 453 h de capacité, identiques tous les mois | heures **contractuelles brutes**, sans congés, fériés ni temps non productif |
| « charge estimée » et « heures estimées » | **la même constante** de 65 h, nommée deux fois différemment |
| « taux horaire facturé : 15 €/h » | valeur par défaut sous le coût de revient, et son rôle n'est expliqué nulle part |

## 2. Le principe de la correction

> **Un artisan ne pense ni en pourcentages ni en heures. Il pense en dates et en euros.**

- « Vous êtes occupé **jusqu'au 12 septembre** » remplace « 20 % d'occupation ».
- « **Il vous reste 4 310 €** » remplace « 42 €/h de marge ».
- Les mots **capacité**, **charge**, **écart**, **taux d'occupation**, **€/h**
  disparaissent de l'interface. Ils restent dans le calcul, ils sortent du vocabulaire.
- Une **semaine** est l'unité de temps, pas l'heure. Un patron dit « j'ai trois semaines
  devant moi », jamais « j'ai 270 heures ».
- **Un écran = une question.** Deux questions ici : *ai-je du travail devant moi ?* et
  *combien me reste-t-il une fois tout payé ?*
- **Trois nombres visibles au maximum par bloc.** Le reste est du texte ou du visuel.
- **Le verdict devient une action** : plus de badge « sous-charge », mais
  « 4 devis attendent une réponse — les relancer ».

## 3. Les calculs corrigés

```
── DISPONIBILITÉ (par semaine) ───────────────────────────
jours_ouvrés_semaine  = jours ouvrés réels (fériés déduits)
capacité_jours        = Σ (compagnons actifs × jours ouvrés)
                        − absences saisies
                        × taux de jours réellement facturés   (défaut 0,70)

── TRAVAIL VENDU ─────────────────────────────────────────
jours_vendus = Σ jours estimés des affaires ACCEPTÉES et EN COURS,
               réparties sur leurs semaines de réalisation
               (les devis non signés ne comptent JAMAIS ici)

── L'HORIZON (ce qu'on affiche) ──────────────────────────
horizon = dernière date avant 2 semaines consécutives sans travail vendu
        → « Vous avez du travail jusqu'au <horizon> »
        → si horizon > 8 semaines : « vous êtes complet sur les 2 prochains mois »
        → si aucun travail vendu   : « vous n'avez rien de prévu »

── CE QUI RESTE (par mois et par affaire) ────────────────
reste = facturé − achats imputés − (jours travaillés × coût jour chargé)

  Aucun coût imputé ET aucune facture  → « pas encore de données » (gris)
  Facturé sans coûts imputés           → « incomplet : imputez vos achats »
  JAMAIS de zéro affiché comme un résultat.

── LE POTENTIEL (l'action) ───────────────────────────────
devis_en_attente = affaires au statut DEVIS_ENVOYÉ sans réponse
jours_potentiels = Σ leurs jours estimés
        → « 4 devis attendent une réponse, soit 3 semaines de travail »
```

## 4. Ce qui disparaît de l'écran

Les trois réglages (temps productif, coût horaire, seuil) **quittent la page**. Ils sont
demandés **une seule fois**, à l'installation, en langage courant :

> *« Sur 5 jours payés à un ouvrier, combien sont réellement facturés à un client ? »*
> → curseur, défaut 3,5 jours
> *« Une journée d'ouvrier vous coûte combien, charges comprises ? »*
> → défaut 250 €

Ensuite ils vivent dans les réglages, avec un simple lien en pied de page : *« Les
calculs utilisent vos réglages. Les modifier. »*

## 5. PROMPT À COLLER dans Claude Code

```
Tu corriges les écrans « Capacité vs charge estimée » et « Performance horaire
réalisée », qui affichent des chiffres faux et des verdicts inversés. Lis CLAUDE.md,
le brief de pivot, les tickets 4.1 et 4.5, et ce ticket. La maquette de référence est
maquette-v2-carnet.html. TDD ; rgpd-security-reviewer à la fin.

RÈGLE DE FOND : on affiche des DATES et des EUROS. Les mots capacité, charge, écart,
taux d'occupation et €/h ne doivent plus apparaître dans l'interface. L'unité de temps
affichée est la semaine ou le jour, jamais l'heure.

1) Corriger les calculs (service TS pur, déterministe, testé)
   - Disponibilité en JOURS par semaine : jours ouvrés réels (fériés déduits) ×
     compagnons actifs, moins les absences saisies, × taux de jours facturés
     (paramètre tenant, défaut 0,70). Elle VARIE d'une semaine à l'autre — un test doit
     vérifier qu'une semaine avec un férié ou une absence donne une valeur différente.
   - Travail vendu = jours estimés des affaires ACCEPTÉES et EN COURS uniquement,
     répartis sur leurs semaines. Les devis non signés n'entrent JAMAIS dans ce calcul
     (test explicite).
   - Horizon = dernière date avant 2 semaines consécutives sans travail vendu.
   - Reste = facturé − achats imputés − (jours travaillés × coût jour chargé).
   - ÉTATS EXPLICITES dans le type de retour : COMPLET | INCOMPLET | SANS_DONNEES.
     Interdiction de renvoyer 0 quand la donnée est absente — un test doit échouer si un
     mois sans facture ni coût renvoie un nombre.

2) Refondre l'écran (une seule page, deux blocs)
   - En haut, LA RÉPONSE en une phrase : « Vous avez du travail jusqu'au 12 septembre. »
     Sous-titre : ce qui se passe après.
   - Frise par semaines : une barre par semaine avec le ou les chantiers dedans, et les
     semaines vides en hachuré gris avec « rien de prévu ». Pas de pourcentage, pas de
     colonne « écart », pas de badge de verdict.
   - Encart d'action : « 4 devis attendent une réponse, soit 3 semaines de travail » +
     bouton « Relancer les 4 devis » (passe par pending_actions comme d'habitude).
   - Simulateur « Puis-je prendre ce chantier ? » : deux champs (combien de jours,
     combien de personnes) -> une réponse en toutes lettres avec la date et la raison
     (« Oui, à partir du 18 août — il reste 2 jours libres cette semaine-là »), et la
     mention explicite si un chantier existant devrait être décalé.
   - Bloc « Votre équipe » : qui est où aujourd'hui, qui est absent, avec un bouton de
     dictée « Vincent est malade » qui alimente les absences (ticket 4.5).
   - Bloc « Vos journées » : la SEULE mesure de performance de cet écran — jours
     facturés sur jours payés, comparés à l'objectif du tenant, avec la conversion en
     euros de l'écart. Aucun €/h, aucun ratio, aucun classement individuel.
   - AUCUN bloc financier sur cet écran : la marge, le reste à gagner et le détail par
     chantier vivent dans le cockpit et la fiche affaire. Une page = une question.
   - Les périodes sans données : mention grise « pas encore de données », jamais un
     chiffre, jamais une couleur de verdict.

3) Sortir les réglages de la page
   - Les trois paramètres (jours réellement facturés, coût d'une journée d'ouvrier,
     seuil d'alerte) sont demandés UNE FOIS à l'activation du module, en langage courant
     (« sur 5 jours payés, combien sont facturés à un client ? »), puis vivent dans les
     réglages. Simple lien en pied de page.

4) Seuils et alertes via le moteur de règles (4.4)
   - « moins de 3 semaines de travail devant soi » -> alerte dans le brief du matin.
   - « chantier dont le reste passe sous 10 % du montant » -> alerte.
   - Fournis par le pack, désactivables, jamais codés en dur.

5) Tests (livrables clés)
   - Semaine avec férié / avec absence -> disponibilité différente (pas de constante).
   - Devis non signé -> n'entre pas dans le travail vendu.
   - Mois sans facture ni coût -> état SANS_DONNEES, aucun nombre affiché, aucune
     couleur de verdict (test d'interface).
   - Horizon correct sur des jeux de données : plein, troué, vide.
   - Aucune occurrence des mots « capacité », « charge », « taux d'occupation », « €/h »
     dans les libellés d'interface (test sur le fichier de traductions).

Montre-moi : l'écran refondu sur viewport 390x844 (capture), le test « mois sans données
n'affiche aucun chiffre », le test « devis non signé exclu », et le test de vocabulaire.
```

## 6. Critères d'acceptation

- [ ] Disponibilité calculée en jours, **variable** selon fériés et absences (testé).
- [ ] Travail vendu = affaires acceptées et en cours **uniquement** (testé).
- [ ] Horizon affiché en date, pas en pourcentage.
- [ ] États `COMPLET | INCOMPLET | SANS_DONNEES` explicites ; **aucun zéro affiché comme résultat** (testé).
- [ ] Aucun verdict ni couleur sur un mois sans données.
- [ ] Rouge réservé à l'argent en risque.
- [ ] Réglages sortis de la page, demandés une fois en langage courant.
- [ ] Seuils portés par le moteur de règles (4.4), pas codés en dur.
- [ ] **Test de vocabulaire** : « capacité », « charge », « taux d'occupation », « €/h » absents des libellés.
- [ ] `rgpd-security-reviewer` clean ; CI verte.

## 7. Pièges

- **Garder le pourcentage « juste au cas où ».** Il reviendra dans la lecture de
  l'utilisateur et annulera tout le travail. Si un chiffre technique est utile à
  quelqu'un, il vit dans un écran de détail, pas sur la page principale.
- **Afficher un zéro parce que c'est mathématiquement vrai.** 0 €/h sur un mois vide est
  vrai et faux en même temps : vrai arithmétiquement, faux comme information.
- **Compter les devis non signés dans le travail vendu.** C'est le meilleur moyen de
  faire croire à un patron qu'il est plein alors qu'il ne l'est pas.
- **Laisser les réglages sur la page.** Trois champs modifiables au milieu des résultats
  transforment un tableau de bord en formulaire, et personne ne sait ce qu'ils pilotent.
