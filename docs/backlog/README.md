# Backlog produit — index et couverture

> Backlog **v3**, transmis le 16/08/2026, versionné ici le 23/08/2026 et éclaté
> par epic (partie A) et par module (partie B). Le texte est repris sans
> modification ; ce fichier n'ajoute que l'index et une mesure de couverture.
>
> **Pourquoi ce dossier existe.** L'audit du 23/08 a constaté que le code citait
> des user stories dont l'énoncé ne vivait nulle part dans le dépôt. Leur
> conformité n'était donc pas vérifiable — le même mal que les tickets 4.x avant
> le versionnage. C'est réparé.

---

## Ce que « cité » veut dire, et ne veut pas dire

La colonne **Cité** dit qu'un identifiant `US-…` apparaît dans le code, un
commentaire ou une migration. C'est un indice de traçabilité, **pas** un état
d'avancement : une story peut être implémentée sans que son identifiant soit
écrit nulle part, et un identifiant peut traîner dans un commentaire pour une
story à moitié faite.

L'audit story par story — fonctionne / cassé / manquant — est le travail
suivant ; il ne se déduit pas de ce tableau.

---

## Couverture, mesurée

| | Stories | Citées dans le code |
|---|---|---|
| **Partie A** — tronc commun | 37 | 27 |
| **Partie B** — modules sectoriels | 36 | 3 |
| **Total** | **73** | **30** |

Les modules sectoriels sont le gros de l'écart : 33 stories sur 36 n'ont
aucune trace dans le code. C'est cohérent avec l'état du produit — le bâtiment est
le seul secteur construit — mais cela n'avait jamais été chiffré.

---

## Index

Le cadrage commun — comment lire le document, ce que la v3 a changé — vit dans
[`00-preambule.md`](00-preambule.md).

### Partie A — tronc commun

| Groupe | Stories | Citées |
|---|---|---|
| [Epic A1 — Onboarding & profil d'entreprise](a1-onboarding-et-profil-d-entreprise.md) | `US-A1.1`, `US-A1.2` ✗, `US-A1.3`, `US-A1.4` ✗ | 2/4 |
| [Epic A2 — Devis / proposition commerciale & facturation](a2-devis-proposition-commerciale-et-facturation.md) | `US-A2.1`, `US-A2.2` ✗, `US-A2.3` ✗, `US-A2.4` ✗, `US-A2.5`, `US-A2.6` | 3/6 |
| [Epic A3 — Trésorerie & pilotage](a3-tresorerie-et-pilotage.md) | `US-A3.1`, `US-A3.2` ✗, `US-A3.3`, `US-A3.4`, `US-A3.5` | 4/5 |
| [Epic A4 — Équipe, planning & disponibilités](a4-equipe-planning-et-disponibilites.md) | `US-A4.1`, `US-A4.2` ✗, `US-A4.3`, `US-A4.4` | 3/4 |
| [Epic A5 — Rôles, multi-tenant & délégation comptable](a5-roles-multi-tenant-et-delegation-comptable.md) | `US-A5.1`, `US-A5.2`, `US-A5.3` ✗, `US-A5.4`, `US-A5.5` ✗ | 3/5 |
| [Epic A6 — Assistant IA & validation humaine](a6-assistant-ia-et-validation-humaine.md) | `US-A6.1`, `US-A6.2`, `US-A6.3`, `US-A6.4`, `US-A6.5` | 5/5 |
| [Epic A7 — Sécurité, souveraineté & conformité](a7-securite-souverainete-et-conformite.md) | `US-A7.1`, `US-A7.2`, `US-A7.3`, `US-A7.4` | 4/4 |
| [Epic A8 — Accessibilité, mobilité & inclusion](a8-accessibilite-mobilite-et-inclusion.md) | `US-A8.1`, `US-A8.2`, `US-A8.3` ✗, `US-A8.4` | 3/4 |

### Partie B — modules sectoriels

| Groupe | Stories | Citées |
|---|---|---|
| [Module B1 — Bâtiment & travaux (déjà largement construit)](b1-batiment-et-travaux-deja-largement-construit.md) | `US-B1.1` ✗, `US-B1.2` ✗, `US-B1.3` ✗, `US-B1.4` | 1/4 |
| [Module B2 — Commerce & vente au détail](b2-commerce-et-vente-au-detail.md) | `US-B2.1` ✗, `US-B2.2` ✗, `US-B2.3` ✗, `US-B2.4` ✗ | 0/4 |
| [Module B3 — Restauration & CHR (cafés, hôtels, restaurants)](b3-restauration-et-chr-cafes-hotels-restaurants.md) | `US-B3.1` ✗, `US-B3.2` ✗, `US-B3.3` ✗, `US-B3.4` ✗ | 0/4 |
| [Module B4 — Services à la personne](b4-services-a-la-personne.md) | `US-B4.1` ✗, `US-B4.2`, `US-B4.3` ✗, `US-B4.4` ✗ | 1/4 |
| [Module B5 — Professions libérales & conseil](b5-professions-liberales-et-conseil.md) | `US-B5.1` ✗, `US-B5.2` ✗, `US-B5.3` ✗, `US-B5.4` ✗ | 0/4 |
| [Module B6 — Artisanat de service (beauté, bien-être, réparation)](b6-artisanat-de-service-beaute-bien-etre-reparation.md) | `US-B6.1` ✗, `US-B6.2` ✗, `US-B6.3` ✗, `US-B6.4` ✗ | 0/4 |
| [Module B7 — Services aux entreprises (nettoyage, sécurité, maintenance)](b7-services-aux-entreprises-nettoyage-securite-maintenance.md) | `US-B7.1` ✗, `US-B7.2` ✗, `US-B7.3` ✗, `US-B7.4` ✗ | 0/4 |
| [Module B8 — Transport & mobilité indépendante](b8-transport-et-mobilite-independante.md) | `US-B8.1` ✗, `US-B8.2` ✗, `US-B8.3` ✗, `US-B8.4` ✗ | 0/4 |
| [Module B9 — Santé & paramédical libéral](b9-sante-et-paramedical-liberal.md) | `US-B9.1` ✗, `US-B9.2`, `US-B9.3` ✗, `US-B9.4` ✗ | 1/4 |

---

## Les stories sans aucune trace dans le code

**43** sur 73. ✗ dans le tableau ci-dessus.

```
US-A1.2 US-A1.4 US-A2.2 US-A2.3 US-A2.4 US-A3.2 US-A4.2 US-A5.3 US-A5.5 US-A8.3 US-B1.1 US-B1.2 US-B1.3 US-B2.1 US-B2.2 US-B2.3 US-B2.4 US-B3.1 US-B3.2 US-B3.3 US-B3.4 US-B4.1 US-B4.3 US-B4.4 US-B5.1 US-B5.2 US-B5.3 US-B5.4 US-B6.1 US-B6.2 US-B6.3 US-B6.4 US-B7.1 US-B7.2 US-B7.3 US-B7.4 US-B8.1 US-B8.2 US-B8.3 US-B8.4 US-B9.1 US-B9.3 US-B9.4
```

Ne pas en conclure qu'elles sont toutes à faire : certaines sont probablement
implémentées sans que leur identifiant ait été écrit. C'est précisément ce que
l'audit story par story doit trancher.
