# Prompts Replit — tickets 4.11 (analytique) et 4.12 (prospection)

> Deux prompts, à coller **l'un après l'autre**. Le second seulement quand le premier est
> validé. Chacun est découpé en phases : l'agent doit s'arrêter à la fin de chaque phase.

---

# PROMPT 1 — Ticket 4.11 : section analytique

```
Tu vas construire la section analytique : mesurer la performance de l'entreprise, la
comparer dans le temps, l'expliquer à quelqu'un qui n'a jamais fait d'analyse de données,
et permettre au chat d'y répondre SANS JAMAIS INVENTER UN CHIFFRE.

RÈGLES DU DÉPÔT — sans exception
- Tout accès à une table métier passe par withTenant(tenantId, tx => ...).
- Le tenantId vient de la session, JAMAIS du client.
- Zod à toutes les frontières.
- Si tu crées une table : mets à jour BUSINESS_TABLES (migrate-rls.cjs),
  BUSINESS_TABLE_VARS et la boucle d'isolation (rls.test.ts).
- N'affiche jamais un secret.
- 5 phases. Arrêt et validation à la fin de chacune.

TROIS INTERDITS QUI STRUCTURENT TOUTE LA SECTION
1. AUCUNE comparaison avec d'autres entreprises clientes, même anonymisée, même agrégée,
   même « à titre indicatif ». Toutes les comparaisons sont l'entreprise avec elle-même
   dans le temps.
2. AUCUNE mesure de performance individuelle. Les indicateurs s'arrêtent au niveau de
   l'entreprise et de l'affaire. Jamais « Karim a produit 4 200 € ».
3. AUCUN chiffre sous les seuils de données. Pas de zéro, pas de moyenne sur deux points,
   pas de projection.

═══════════════════════════════════════════
PHASE 1 — Moteur de calcul
═══════════════════════════════════════════

1) Implémente ces 13 indicateurs, chacun avec son seuil minimal de données. En dessous du
   seuil, l'API renvoie { donneesInsuffisantes: true } et AUCUN NOMBRE.

   LES QUATRE DE TÊTE
   - horizon_travail        : carnet restant ÷ capacité dispo (absences déduites). Seuil 3 affaires.
   - argent_qui_dort        : factures émises non réglées, RETENUE DE GARANTIE EXCLUE,
                              avec le sous-total > 60 jours. Seuil 1 facture.
   - marge_pour_100_euros   : (CA − achats − main-d'œuvre affectée) ÷ CA. Seuil 3 affaires terminées.
   - delai_paiement_client  : moyenne pondérée jours émission → encaissement. Seuil 5 factures réglées.

   L'ARGENT
   - ca_facture, ca_encaisse (sur la période)
   - resultat_exploitation_estime : borné, marqué « estimé » tant que les charges sont incomplètes

   LE TRAVAIL DEVANT
   - carnet_commandes_euros
   - taux_signature_devis   : signés ÷ envoyés. Seuil 5 devis envoyés.
   - delai_reponse_devis
   - montant_moyen_affaire

   LA PRODUCTION
   - jours_factures_sur_payes : seuil 2 semaines de pointage
   - ecart_devise_realise     : en jours ET en euros. Seuil 3 affaires terminées.

   LE RISQUE
   - concentration_client   : part du plus gros client dans le CA

2) Chaque indicateur retourne : { valeur, unite, periode, nbSources, donneesInsuffisantes }.
   nbSources = le nombre d'objets réellement utilisés dans le calcul. Il est obligatoire.

3) Tout le calcul se fait EN SQL/Drizzle dans withTenant. Aucun calcul côté client.

═══════════════════════════════════════════
PHASE 2 — Comparaisons de périodes
═══════════════════════════════════════════

4) Périodes : mois · trimestre · exercice en cours · 12 mois glissants · période libre.
   Comparaisons : aucune · période précédente · MÊME PÉRIODE L'AN DERNIER · moyenne 12 mois.

5) LE DÉFAUT N'EST PAS « PÉRIODE PRÉCÉDENTE ». Dans le bâtiment, comparer août à juillet
   donne un effondrement chaque année et l'utilisateur croit qu'il va mal alors qu'il
   était en congés.
   Défaut = MÊME PÉRIODE L'AN DERNIER. Si l'historique n'existe pas, défaut = 12 MOIS
   GLISSANTS.

6) TOUJOURS À DATE COMPARABLE. Comparer 7 mois de 2026 à l'année 2025 entière est faux.
   Les deux bornes doivent avoir la même longueur, et l'écran affiche les deux plages
   en clair (« du 1er janvier au 7 août »).
   Écris un test qui échoue si deux bornes de longueurs différentes sont acceptées.

7) Quand la comparaison est impossible : une phrase, pas un tiret dans une case.
   « Pas encore de point de comparaison — il faudra attendre janvier. »

═══════════════════════════════════════════
PHASE 3 — L'écran
═══════════════════════════════════════════

8) LE NOM AFFICHÉ EST DÉJÀ LA PHRASE D'EXPLICATION. Exemples EXACTS à reproduire :
   « Vous avez du travail jusqu'au 12 septembre »
   « 18 400 € dorment chez vos clients » / « dont 21 300 € à plus de 60 jours »
   « Sur 100 € facturés, il vous reste 22 € »
   « Vos clients vous paient en 47 jours »
   « Vous signez 1 devis sur 3 »
   « 3,2 jours facturés sur 5 payés »

9) Chaque indicateur porte au plus trois choses : la phrase chiffrée · une ligne
   « ça veut dire quoi » repliée par défaut · une action réelle quand elle existe
   (« Relancer les 4 factures en retard »). Pas de bouton si aucune action n'existe.

10) FORMES — la forme avant la couleur :
    - un chiffre unique + tendance = TUILE, jamais un graphique à une barre ;
    - les 4 de tête = rangée de tuiles ; celui du jour en chiffre héros ≥ 48 px ;
    - évolution dans le temps = ligne (aire si une seule série) ;
    - comparaison entre périodes = EMPHASE (période courante en couleur, les autres en
      gris), surtout PAS huit couleurs pour huit mois ;
    - répartition par client ou type de chantier = barres horizontales empilées,
      JAMAIS de camembert ; au-delà de 7 catégories, replier la queue dans « Autres ».
    - JAMAIS DE DOUBLE AXE. Deux mesures d'échelles différentes = deux graphiques.

11) PALETTE — surface claire #fcfcfb, série principale bleu #2a78d6 et sa rampe pour les
    magnitudes. Couleurs d'état RÉSERVÉES, jamais utilisées comme « série 4 » :
    bon #0ca30c · attention #fab219 · sérieux #ec835a · critique #d03b3b,
    TOUJOURS accompagnées d'une icône et d'un mot, jamais la couleur seule.
    Le rouge reste réservé à l'argent en risque.

12) MOBILE D'ABORD, 390 px. Tuiles empilées 1 ou 2 par ligne, graphiques pleine largeur,
    pas de légende quand il n'y a qu'une série (le titre suffit), filtres de période sur
    UNE seule ligne au-dessus. Une VUE TABLEAU est toujours accessible.
    Infobulle au survol et à l'appui, cible tactile plus grande que la marque.

13) VOCABULAIRE INTERDIT dans toute étiquette d'interface : « KPI », « ratio »,
    « taux de », « performance », « pilotage », « indicateur avancé ».

═══════════════════════════════════════════
PHASE 4 — Le chat factuel
═══════════════════════════════════════════

14) LE MODÈLE NE CALCULE JAMAIS UN CHIFFRE. Il n'a pas accès aux données : il a accès à
    un outil, exécuté côté serveur dans withTenant.

    get_indicateur({
      id:          énum fermé des 13 indicateurs ci-dessus,
      periode:     'mois' | 'trimestre' | 'exercice' | '12_mois' | { debut, fin },
      comparaison: 'aucune' | 'periode_precedente' | 'meme_periode_n1' | 'moyenne_12_mois'
    })
    → { valeur, unite, periode, comparaison?, nbSources, donneesInsuffisantes }

    Entrée ET sortie validées par Zod. Le modèle reçoit un nombre déjà calculé et se
    contente de le formuler.

15) Quatre règles dans l'invite système :
    a) Toute réponse chiffrée cite LA PÉRIODE et LE NOMBRE DE SOURCES —
       « calculé sur 7 affaires terminées entre janvier et juillet ».
    b) Si donneesInsuffisantes : dire qu'on ne sait pas et expliquer ce qui manque.
       AUCUNE estimation, aucun ordre de grandeur, aucun « environ ».
    c) Si la question ne correspond à aucun indicateur de la liste : le dire.
       Ne pas bricoler une réponse à partir d'autre chose.
    d) Ne JAMAIS comparer à d'autres entreprises, à un secteur ou à une moyenne
       nationale, même si l'utilisateur le demande explicitement. Réponse type :
       « Je ne compare qu'à votre propre historique. »

16) Journalisation : identifiant de l'indicateur, période, durée, statut.
    JAMAIS la question, JAMAIS la réponse, JAMAIS une valeur.

═══════════════════════════════════════════
PHASE 5 — Tests
═══════════════════════════════════════════

17) a) ISOLATION — deux entreprises, mêmes périodes : modifier les données de l'une ne
       change aucun chiffre de l'autre.
    b) SEUILS — sous les seuils, aucun nombre ne fuit dans la réponse de l'API.
    c) COMPARABILITÉ — deux bornes de longueurs différentes sont refusées.
    d) RETENUE DE GARANTIE — n'entre jamais dans « l'argent qui dort ».
    e) ANTI-HALLUCINATION — 10 questions au chat dont 5 portant sur des indicateurs sans
       données. Il doit refuser 5 fois. UN SEUL chiffre inventé = non livrable.
    f) PAS DE COMPARAISON EXTERNE — échec si une réponse ou un écran contient
       « secteur », « moyenne nationale », « autres entreprises », « benchmark ».
    g) VOCABULAIRE — échec si un mot de la liste du point 13 apparaît dans une étiquette.
    h) PAS DE PERFORMANCE INDIVIDUELLE — aucune route n'expose un chiffre rattaché à une
       personne nommée.

CE QUE TU NE DOIS PAS FAIRE
- Ne laisse jamais le modèle calculer, estimer ou arrondir un chiffre lui-même.
- N'affiche jamais un zéro à la place de « pas encore assez de données ».
- Ne mets jamais deux échelles sur un même graphique.
- N'utilise jamais une couleur d'état comme couleur de série.
- Ne compare jamais à autre chose qu'à l'historique de l'entreprise elle-même.
```

---

# PROMPT 2 — Ticket 4.12 : prospection par signaux publics

*(à coller après validation du prompt 1)*

```
Tu vas construire un module de prospection fondé UNIQUEMENT sur des données publiques
ouvertes. Lis d'abord l'encadré légal : il détermine l'architecture, ce n'est pas un
avertissement décoratif.

CADRE LÉGAL — NON NÉGOCIABLE
- Depuis le 11 août 2026, le démarchage TÉLÉPHONIQUE d'un consommateur exige un
  CONSENTEMENT PRÉALABLE. Bloctel a disparu. Sanctions jusqu'à 75 000 € par appel pour
  une personne physique, 375 000 € pour une société.
- Le courriel et le SMS vers un particulier exigent déjà le consentement préalable
  (art. L. 34-5 CPCE).
- La CNIL a sanctionné SOLOCAL MARKETING SERVICES de 900 000 € le 15 mai 2025 pour avoir
  démarché à partir de fichiers achetés à des courtiers en données.
- C'est L'UTILISATEUR de notre logiciel qui prend l'amende, pas nous. Le produit ne doit
  jamais lui rendre une action illégale possible.

DONC, INTERDICTIONS ABSOLUES
- Aucune donnée achetée à un courtier en données.
- Aucune donnée de navigation, de recherche ou de traceur.
- Aucun profilage, aucun score de « probabilité d'achat » sur une personne physique.
- Aucune action courriel, SMS ou téléphone proposée vers un particulier.

Mêmes règles de dépôt que précédemment (withTenant, tenantId de session, Zod, les trois
listes, pas de secret affiché). 5 phases, arrêt et validation à chaque fin de phase.

═══════════════════════════════════════════
PHASE 1 — Sources publiques, en liste blanche
═══════════════════════════════════════════

1) Crée un registre de sources en LISTE BLANCHE, dans un fichier de données dédié.
   Une source non listée ne peut pas être consommée. Un test échoue si du code
   interroge une source absente du registre.

2) Première source : les PERMIS DE CONSTRUIRE (base Sitadel, open data).
   Pars de la page data.gouv.fr du jeu « Base des permis de construire et autres
   autorisations d'urbanisme » et évalue les réutilisations disponibles (il existe des
   API géocodées). MONTRE-MOI ce que tu as trouvé et ce que tu proposes d'utiliser AVANT
   d'écrire du code d'ingestion.
   Si aucune source n'est fiable ou stable, ARRÊTE-TOI ET DIS-LE — ne bricole pas un
   moissonnage de page web.

3) Ingestion : import périodique, géocodage, stockage dans une table de pistes avec
   tenant_id, et TOUJOURS la source et la date d'obtention sur chaque ligne.
   Les pistes ne sont pas des données personnelles enrichies : on stocke le fait public
   (permis, adresse, nature des travaux, date), pas un profil.

4) Sources suivantes, une par une, dans cet ordre : marchés publics (BOAMP, filtrage par
   code CPV, rayon, montant) · mutations immobilières · créations d'entreprises (Sirene).

═══════════════════════════════════════════
PHASE 2 — L'écran « chantiers qui se préparent »
═══════════════════════════════════════════

5) Vue par rayon autour de l'adresse de l'entreprise, réglable. Regroupement par nature
   de travaux. Formulation attendue, en euros, en dates et en phrases :

   « 14 permis accordés dans un rayon de 20 km ces 60 jours.
     4 maisons neuves · 6 extensions · 4 changements de destination.
     Sur une maison neuve, la plomberie intervient en général 4 à 7 mois après le permis.
     Les 4 maisons neuves de mai vous concernent en octobre. »

6) Les délais « métier → mois après permis » sont des DONNÉES rattachées au pack métier,
   dans un fichier de configuration. INTERDIT : un `if` sur un nom de verticale ailleurs
   que dans le chargeur de packs.

7) Chaque piste affiche SA SOURCE ET SA DATE. C'est une exigence de transparence et ça
   permet à l'artisan de juger.

═══════════════════════════════════════════
PHASE 3 — Le verrouillage des canaux (le cœur du ticket)
═══════════════════════════════════════════

8) Chaque piste porte un type de destinataire : PARTICULIER ou PROFESSIONNEL.
   Sur un permis, le maître d'ouvrage peut être un particulier, mais l'architecte, le
   maître d'œuvre ou le promoteur sont des PROFESSIONNELS.

9) Matrice des canaux, appliquée AU NIVEAU DE L'API, pas seulement dans l'interface :

   PARTICULIER    : courrier postal OUI · dépôt/porte-à-porte OUI ·
                    courriel NON · SMS NON · téléphone NON
   PROFESSIONNEL  : courrier OUI · courriel OUI (intérêt légitime, adresse pro, objet lié
                    à la fonction) · téléphone encadré

10) Dans l'interface, les canaux interdits sont DÉSACTIVÉS avec la raison affichée.
    Pas un avertissement en petits caractères : un bouton qu'on ne peut pas cliquer.
    Exemple : « Envoi d'e-mail indisponible : ce contact est un particulier et n'a pas
    donné son accord. Vous pouvez lui écrire par courrier. »

═══════════════════════════════════════════
PHASE 4 — Ce qui rend le module utile
═══════════════════════════════════════════

11) GÉNÉRATION DU COURRIER POSTAL : à partir d'une piste, un courrier prêt à imprimer,
    avec l'identité de l'entreprise, une trame modifiable, et l'adresse. C'est le canal
    qui reste, et il fonctionne bien en local.

12) DEMANDE D'AVIS À LA CLÔTURE — la brique la plus rentable du ticket, à livrer même si
    le reste glisse. Quand une affaire est clôturée ET sa facture réglée, proposer
    l'envoi d'une demande d'avis au client. Un lien, un clic pour lui.
    C'est légal : relation client existante. C'est ce qui fait remonter l'entreprise dans
    les résultats locaux, bien plus que le référencement d'un site.

13) « D'OÙ VIENNENT VOS CLIENTS » : une question posée UNE FOIS à la création d'une
    affaire, liste fermée (bouche-à-oreille, passage, recommandation d'un confrère,
    recherche internet, réseaux sociaux, ancien client, autre), un seul appui, sautable.
    Restitution en euros par origine, à partir de 10 affaires renseignées.

═══════════════════════════════════════════
PHASE 5 — Garde-fous et tests
═══════════════════════════════════════════

14) a) LISTE BLANCHE — test qui échoue si une source hors registre est interrogée.
    b) CANAUX — test qui échoue si une piste PARTICULIER expose une action courriel,
       SMS ou téléphone, y compris via une requête forgée directement sur l'API.
    c) PAS DE PROFILAGE — aucune route ne renvoie de score attribué à une personne
       physique.
    d) SOURCE ET DATE — présentes sur 100 % des pistes.
    e) RIEN SUR LES AUTRES TENANTS — deux entreprises peuvent voir le même permis, c'est
       public et c'est normal. Mais AUCUN écran, AUCUNE API ne doit indiquer que d'autres
       entreprises ont vu ou contacté cette piste : ce serait révéler l'activité d'autres
       clients. Test dédié.
    f) ISOLATION — les pistes et leur statut de traitement sont cloisonnés par tenant.

15) Mets à jour le registre des traitements : nouvelle finalité, sources publiques
    utilisées, base légale intérêt légitime pour le volet professionnel, durée de
    conservation 3 ans.

CE QUE TU NE DOIS PAS FAIRE
- N'achète, n'intègre et ne suggère AUCUN fournisseur de données de navigation ou
  d'intention de recherche.
- Ne propose jamais un appel ou un e-mail vers un particulier.
- N'attribue aucun score de probabilité à une personne physique.
- Ne moissonne aucune page web pour contourner l'absence d'API : arrête-toi et dis-le.
- Ne montre jamais l'activité d'un autre tenant sur une piste partagée.
```

---

## Ce que tu vérifieras toi-même

Sur le **4.11** : ouvre le compte Élec Ondine du jeu de QA — deux affaires seulement.
Tous les indicateurs doivent dire « pas encore assez de données », **aucun chiffre**.
Puis pose au chat cinq questions sur des indicateurs vides : cinq refus. Un seul chiffre
inventé et la fonctionnalité repart en développement.

Sur le **4.12** : ouvre une piste issue d'un permis dont le maître d'ouvrage est un
particulier. Les boutons e-mail, SMS et téléphone doivent être **désactivés**, avec la
raison écrite. Si tu peux cliquer, le module n'est pas livrable — c'est ton client qui
prendrait l'amende.
