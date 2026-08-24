// Génère les pages SEO/GEO (master plan, phases 2+) à partir d'un modèle
// commun et d'un contenu par page. Usage : node genere-pages-seo.mjs
// (depuis marketing/landing/). Produit <slug>.html, servi sans extension
// par Vercel (cleanUrls) : l'URL canonique est https://nodaq.fr/<slug>.
//
// RÈGLES (master plan + charte du dépôt) :
// - Ne rien inventer : chaque affirmation vient de la copy validée de la
//   landing ou des règles produit publiques (validation humaine avant tout
//   envoi, l'IA ne fixe jamais un prix). Les exemples sont étiquetés
//   « scénario illustratif ».
// - EN_VALIDATION = true ⇒ meta robots noindex sur toutes les pages, et
//   elles restent hors sitemap/llms.txt/maillage d'accueil. Au go-live du
//   fondateur : passer à false, ajouter les URLs au sitemap, à llms.txt et
//   au maillage de la page d'accueil.
// - Charte : #0a0b0f, lime #a3e635 (accent unique), Inter + JetBrains Mono,
//   radius 10px, hairlines. Polices auto-hébergées via fonts.css.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const EN_VALIDATION = false;
const MAJ = "2026-08-24";

const PAGES = [
  {
    slug: "logiciel-batiment",
    title: "Logiciel de gestion bâtiment pour TPE — devis, marge, impayés | nodaq",
    description:
      "nodaq est le copilote de gestion des TPE du bâtiment : devis dictés à la voix, marge par chantier suivie en continu, relances d'impayés déclenchées sur votre mandat.",
    h1: "Le logiciel de gestion pensé pour les artisans du bâtiment.",
    reponse:
      "nodaq est un copilote de gestion pour les TPE du bâtiment : vous dictez vos devis, photographiez vos factures, et validez ce que nodaq prépare — marge par chantier suivie en continu, trésorerie lisible, relances d'impayés déclenchées avec votre accord. Données hébergées en France. Programme fondateurs ouvert le 1er octobre 2026.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Trois gestes, toujours les mêmes : <strong>dictez</strong> (un devis dans le fourgon, entre deux chantiers), <strong>photographiez</strong> (une facture fournisseur, lue automatiquement), <strong>validez</strong> (chaque envoi — devis, relance — part uniquement après votre accord, en un clic). nodaq s'occupe de la préparation ; la décision reste chez vous.</p>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Pour toute TPE qui facture <strong>à l'affaire</strong> plutôt qu'à la période. Le bâtiment est notre premier secteur équipé — plombiers, électriciens, maçons, entreprises de rénovation — mais pas notre seul terrain : événementiel, beauté, création suivent la même logique de chantier ou de mission.</p>`,
      },
      {
        h2: "Fonctionnalités utiles sur un chantier",
        html: `<ul>
          <li><strong>Devis dictés</strong> — votre voix devient un devis prêt à envoyer, avec vos tarifs. <a href="/devis-ia">Voir le détail</a>.</li>
          <li><strong>Marge par chantier</strong> — réévaluée à chaque heure pointée, comparée à votre seuil de rentabilité, avec ce qui manque pour la connaître exactement : vous savez si un chantier tient son prix avant qu'il soit trop tard.</li>
          <li><strong>Trésorerie et échéancier</strong> — le cockpit montre ce qui rentre, ce qui sort et ce qui arrive à échéance.</li>
          <li><strong>Relances d'impayés</strong> — des campagnes de relance téléphonique préparées par nodaq, déclenchées uniquement sur votre mandat. <a href="/relance-facture-impayee">Voir le détail</a>.</li>
          <li><strong>Lecture automatique de factures</strong> — photographiez, nodaq extrait et classe.</li>
        </ul>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Fin de journée, un artisan termine une salle de bains. Dans le fourgon, il dicte le devis du chantier suivant : nodaq le met en forme avec ses tarifs, il le relit et l'envoie avant de rentrer. Il photographie la facture du grossiste — lue et classée au bon endroit. Le cockpit lui montre que l'estimation de marge du chantier en cours a glissé : les heures de la semaine, confirmées ce matin, pèsent plus que prévu. Une campagne de relance est prête pour une facture arrivée à échéance : un clic, le mandat est donné. La soirée reste la sienne.</p>`,
      },
    ],
    faq: [
      {
        q: "Quand est-ce disponible ?",
        a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026, avant toute disponibilité publique.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Le tarif Essentiel démarre à 49 € HT/mois + 9 € HT/mois par salarié. Les 50 premiers inscrits gardent ce tarif à vie.",
      },
      {
        q: "Est-ce fait pour mon métier ?",
        a: "nodaq est pensé pour toute TPE qui facture à l'affaire — le bâtiment est notre premier secteur équipé, pas notre seul terrain.",
      },
      {
        q: "Mes données sont-elles en sécurité ?",
        a: "Les données sont hébergées en France, et aucun envoi (devis, relance) ne part sans votre validation explicite.",
      },
    ],
    freres: [
      { href: "/devis-ia", label: "Créer ses devis à la voix" },
      { href: "/relance-facture-impayee", label: "Relancer une facture impayée" },
    ],
  },
  {
    slug: "devis-ia",
    title: "Créer un devis avec l'IA : dictez, nodaq rédige, vous validez | nodaq",
    description:
      "Dictez votre devis à la voix : nodaq le transforme en document prêt à envoyer, avec vos tarifs. L'IA rédige, elle n'invente jamais un prix. Pour TPE et artisans.",
    h1: "Créez vos devis à la voix — l'IA rédige, vous validez.",
    reponse:
      "Avec nodaq, un devis se dicte : dans le fourgon, sur le chantier, entre deux rendez-vous. L'IA met votre dictée en forme — postes, quantités, mise en page — et le devis est prêt à relire puis envoyer. Les montants viennent de vos tarifs, jamais d'une invention du modèle. Rien ne part sans votre validation.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Vous décrivez le chantier à voix haute, comme vous l'expliqueriez à un collègue. nodaq structure la dictée en postes chiffrés, applique <strong>vos</strong> tarifs, et produit un devis mis en page. Vous relisez, corrigez si besoin, et envoyez — <strong>l'envoi n'est jamais automatique</strong>.</p>`,
      },
      {
        h2: "Pourquoi l'IA ne fixe-t-elle jamais un prix ?",
        html: `<p>C'est une règle de conception, pas une limite technique : un chiffre affiché vient toujours d'un calcul déterministe à partir de vos tarifs, jamais d'une estimation du modèle. L'IA rédige et structure ; les prix restent les vôtres. C'est ce qui rend le devis fiable — et défendable devant votre client.</p>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Pour les dirigeants de TPE qui préparent leurs devis le soir, après les heures de chantier — le temps volé que nodaq veut vous rendre. Bâtiment d'abord, et toute activité qui chiffre à l'affaire.</p>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>« Rénovation salle d'eau : dépose de l'existant, receveur extra-plat 90×90, faïence sur 12 m², reprise plomberie, deux jours de main-d'œuvre à deux. » Dicté en trente secondes. nodaq en fait un devis structuré avec les tarifs enregistrés de l'entreprise ; l'artisan relit, ajuste une quantité, envoie.</p>`,
      },
    ],
    faq: [
      {
        q: "L'IA peut-elle se tromper sur les prix ?",
        a: "Non : les montants ne sont jamais générés par l'IA. Ils viennent de vos tarifs, appliqués par un calcul déterministe. L'IA ne fait que rédiger et structurer.",
      },
      {
        q: "Le devis part-il automatiquement ?",
        a: "Jamais. Vous relisez et validez chaque devis avant envoi — c'est une règle de conception de nodaq.",
      },
      {
        q: "Quand est-ce disponible ?",
        a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026.",
      },
    ],
    freres: [
      { href: "/logiciel-batiment", label: "Le logiciel de gestion bâtiment" },
      { href: "/relance-facture-impayee", label: "Relancer une facture impayée" },
    ],
  },
  {
    slug: "relance-facture-impayee",
    title: "Relancer une facture impayée : préparée par nodaq, envoyée avec votre accord",
    description:
      "nodaq surveille vos échéances et prépare des campagnes de relance téléphonique — aucun appel ne part sans votre mandat, donné en un clic. En France, une facture est payée à 44 jours en moyenne.",
    h1: "Relancez vos impayés — préparé automatiquement, envoyé avec votre accord.",
    reponse:
      "Relancer un client est désagréable, alors on repousse — et l'impayé s'installe. nodaq surveille vos échéances et prépare une campagne de relance téléphonique : vous donnez votre mandat en un clic, ou vous l'écartez. Rien ne part jamais dans votre dos. En France, une facture est payée à 44 jours en moyenne, pour 36 jours convenus.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Chaque facture émise entre dans l'échéancier. À l'approche de l'échéance, nodaq vous prévient ; passée l'échéance, il <strong>prépare une campagne de relance téléphonique</strong> — selon votre règle : fenêtre horaire, nombre de tentatives, ton. Elle apparaît dans vos actions à valider : <strong>un clic pour donner le mandat, un clic pour écarter</strong>. Une fois le mandat donné, l'agent vocal appelle, rappelle la facture et l'échéance, peut envoyer un lien de paiement par SMS pendant l'appel — et s'arrête définitivement si votre client demande à ne plus être appelé.</p>`,
      },
      {
        h2: "Pourquoi valider plutôt qu'automatiser à 100 % ?",
        html: `<p>Parce qu'un client n'est pas une ligne comptable. Vous savez qu'un tel traverse un moment difficile, qu'un autre paie toujours avec dix jours de retard mais paie toujours. nodaq enlève la charge mentale — surveiller, rédiger, ne pas oublier — et vous laisse le discernement.</p>`,
      },
      {
        h2: "L'impayé, un problème français",
        html: `<p>Les chiffres affichés sur <a href="/">notre page d'accueil</a>, sources à l'appui : une facture est payée en moyenne à <strong>44 jours</strong> pour 36 convenus, et les retards de paiement pèsent d'abord sur les plus petites entreprises. Chaque semaine gagnée sur une relance est de la trésorerie qui revient.</p>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Une facture de 4 800 € arrive à échéance un vendredi. Le lundi, nodaq présente une campagne de relance prête : ce client, cette facture, un appel courtois en journée. La dirigeante sait que ce client est fiable mais distrait — elle donne son mandat. L'appel a lieu dans l'après-midi, un lien de paiement est envoyé par SMS pendant la conversation, le règlement arrive le jeudi. Sans nodaq, la relance serait partie « quand j'aurai le temps » : trois semaines plus tard.</p>`,
      },
    ],
    faq: [
      {
        q: "Les relances partent-elles automatiquement ?",
        a: "Non. nodaq prépare la campagne et vous la présente ; aucun appel n'est passé sans votre mandat, donné en un clic. Vous pouvez aussi l'écarter, et votre client peut demander à ne plus être appelé — c'est respecté définitivement.",
      },
      {
        q: "Quand est-ce disponible ?",
        a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Le tarif Essentiel démarre à 49 € HT/mois + 9 € HT/mois par salarié. Les 50 premiers inscrits gardent ce tarif à vie.",
      },
    ],
    freres: [
      { href: "/logiciel-batiment", label: "Le logiciel de gestion bâtiment" },
      { href: "/devis-ia", label: "Créer ses devis à la voix" },
    ],
  },
];

// ── Lot 2 (phase 2, suite) : 7 pages commerciales en VALIDATION (noindex
// par page). Capacités citées = celles visibles dans le produit (captures
// réelles : Chantiers, Devis, Factures, Avoirs, Heures, Marge, Rapports,
// Échéancier fiscal, Charges récurrentes, seuil de rentabilité, taux de
// recouvrement) + copy validée de la landing. Au go du fondateur : retirer
// noindex, ajouter au sitemap + llms.txt + maillage d'accueil.
const FAQ_COMMUNES = [
  {
    q: "Quand est-ce disponible ?",
    a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026, avant toute disponibilité publique.",
  },
  {
    q: "Combien ça coûte ?",
    a: "Le tarif Essentiel démarre à 49 € HT/mois + 9 € HT/mois par salarié. Les 50 premiers inscrits gardent ce tarif à vie.",
  },
  {
    q: "Mes données sont-elles en sécurité ?",
    a: "Les données sont hébergées en France, et aucun envoi (devis, relance) ne part sans votre validation explicite.",
  },
];

PAGES.push(
  {
    slug: "logiciel-gestion-tpe",
    noindex: true,
    title: "Logiciel de gestion pour TPE : devis, factures, marge, trésorerie | nodaq",
    description:
      "nodaq réunit devis dictés, suivi de factures, marge par affaire, heures, trésorerie et relances d'impayés dans un seul copilote pour TPE. Hébergé en France.",
    h1: "Le logiciel de gestion tout-en-un des TPE.",
    reponse:
      "nodaq réunit dans un seul outil ce qu'une TPE gère aujourd'hui entre un tableur, une bannette et la mémoire du dirigeant : devis dictés à la voix, factures suivies jusqu'au paiement, marge par affaire suivie en continu, heures, trésorerie et relances d'impayés — chaque action validée par vous. Hébergé en France.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Trois gestes : <strong>dictez</strong> (un devis, une note), <strong>photographiez</strong> (une facture fournisseur, lue automatiquement), <strong>validez</strong> (tout envoi — devis, relance — part uniquement après votre accord). Le cockpit rassemble le reste : chiffre d'affaires du mois, factures en attente, trésorerie disponible, actions à valider.</p>`,
      },
      {
        h2: "Les modules",
        html: `<ul>
          <li><strong>Devis</strong> — dictés à la voix, chiffrés avec vos tarifs. <a href="/devis-ia">Devis à la voix</a>.</li>
          <li><strong>Factures et avoirs</strong> — suivis jusqu'au paiement, avec échéancier. <a href="/facturation-tpe">Facturation TPE</a>.</li>
          <li><strong>Marge par affaire</strong> — recalculée dès qu'une facture ou une heure est enregistrée. <a href="/calcul-marge-chantier">Calcul de marge</a>.</li>
          <li><strong>Trésorerie</strong> — disponible, échéancier fiscal, charges récurrentes. <a href="/suivi-tresorerie-tpe">Suivi de trésorerie</a>.</li>
          <li><strong>Relances d'impayés</strong> — préparées automatiquement, envoyées avec votre accord. <a href="/relance-facture-impayee">Relance d'impayés</a>.</li>
          <li><strong>Heures et chantiers</strong> — le réel de chaque affaire. <a href="/gestion-chantier">Gestion de chantier</a>.</li>
        </ul>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Pour les TPE de 3 à 15 salariés qui facturent à l'affaire. Le bâtiment est notre premier secteur équipé (<a href="/logiciel-batiment">logiciel bâtiment</a>) ; événementiel, beauté et création suivent la même logique.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Faut-il tout ressaisir depuis mon ancien outil ?",
        a: "Le programme fondateurs sert précisément à construire l'entrée en douceur avec les 50 premières entreprises. Inscrivez-vous et dites-nous d'où vous partez.",
      },
    ],
    freres: [
      { href: "/logiciel-batiment", label: "Logiciel bâtiment" },
      { href: "/logiciel-artisan", label: "Logiciel artisan" },
      { href: "/devis-ia", label: "Devis à la voix" },
    ],
  },
  {
    slug: "logiciel-artisan",
    noindex: true,
    title: "Logiciel de gestion pour artisan : dictez vos devis, suivez votre marge | nodaq",
    description:
      "Un logiciel pensé pour le quotidien d'artisan : devis dictés dans le fourgon, factures photographiées, marge par chantier, relances validées en un clic.",
    h1: "Le logiciel de gestion qui suit le rythme d'un artisan.",
    reponse:
      "La gestion d'un artisan se fait dans les creux : le devis dicté dans le fourgon, la facture fournisseur photographiée sur le chantier, la relance validée entre deux rendez-vous. nodaq est construit pour ces gestes-là — l'IA prépare, vous validez, et la paperasse du soir cesse de manger vos soirées.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Vous <strong>dictez</strong> un devis comme vous l'expliqueriez à un collègue : nodaq le structure avec vos tarifs. Vous <strong>photographiez</strong> une facture : elle est lue, résumée et classée au bon endroit. Vous <strong>validez</strong> ce que nodaq prépare — jamais d'envoi automatique.</p>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Artisans et TPE qui facturent à l'affaire : le bâtiment d'abord — notre premier secteur équipé — et tout métier qui chiffre au chantier ou à la mission. Voir aussi la page <a href="/logiciel-batiment">logiciel bâtiment</a>.</p>`,
      },
      {
        h2: "Ce que vous y gagnez",
        html: `<ul>
          <li>Le devis prêt avant de rentrer, plutôt que le soir à la table de la cuisine. <a href="/devis-ia">Voir les devis à la voix</a>.</li>
          <li>La marge de chaque chantier connue pendant le chantier, pas après. <a href="/calcul-marge-chantier">Voir le calcul de marge</a>.</li>
          <li>Les relances qui partent — parce qu'elles sont préparées et qu'il ne reste qu'un clic. <a href="/relance-facture-impayee">Voir les relances</a>.</li>
        </ul>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Une électricienne enchaîne deux chantiers. Entre les deux, elle dicte le devis du prochain, photographie la facture du grossiste, et valide la relance d'une facture échue. Trois minutes dans le fourgon — trois tâches qui attendaient d'habitude le vendredi soir.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Est-ce fait pour mon métier ?",
        a: "nodaq est pensé pour toute TPE qui facture à l'affaire — le bâtiment est notre premier secteur équipé, pas notre seul terrain.",
      },
    ],
    freres: [
      { href: "/logiciel-gestion-tpe", label: "Le logiciel de gestion TPE" },
      { href: "/logiciel-batiment", label: "Logiciel bâtiment" },
      { href: "/devis-ia", label: "Devis à la voix" },
    ],
  },
  {
    slug: "logiciel-devis-facture",
    noindex: true,
    title: "Logiciel devis et factures pour TPE : du devis dicté à la facture payée | nodaq",
    description:
      "Du devis dicté à la voix jusqu'à la facture suivie et relancée : nodaq couvre le cycle complet, avec validation humaine à chaque envoi. Pour TPE et artisans.",
    h1: "Du devis dicté à la facture payée, sans rupture.",
    reponse:
      "Un devis accepté devient un chantier, un chantier devient des factures, des factures deviennent — parfois trop tard — des paiements. nodaq suit ce fil sans rupture : devis dicté à la voix, facture suivie jusqu'à l'échéance, relance préparée si le paiement tarde. À chaque envoi, c'est vous qui validez.",
    sections: [
      {
        h2: "Le devis : dicté, chiffré avec vos tarifs",
        html: `<p>Vous dictez, l'IA structure et met en page — et n'invente jamais un prix : les montants viennent de vos tarifs, par calcul déterministe. Détail complet sur la page <a href="/devis-ia">devis à la voix</a>.</p>`,
      },
      {
        h2: "La facture : suivie jusqu'au paiement",
        html: `<p>Factures et avoirs sont suivis avec leurs échéances. Le cockpit montre les factures émises, celles en attente et le taux de recouvrement — vous savez en un regard ce qui doit rentrer. Détail sur la page <a href="/facturation-tpe">facturation TPE</a>.</p>`,
      },
      {
        h2: "Et si le paiement tarde",
        html: `<p>nodaq prépare la campagne de relance et vous la présente : un clic pour donner le mandat, un clic pour l'écarter. Détail sur la page <a href="/relance-facture-impayee">relance de factures impayées</a>.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Les envois sont-ils automatiques ?",
        a: "Jamais. Devis comme relances sont préparés par nodaq mais n'appartiennent qu'à vous : chaque envoi passe par votre validation en un clic.",
      },
    ],
    freres: [
      { href: "/devis-ia", label: "Devis à la voix" },
      { href: "/facturation-tpe", label: "Facturation TPE" },
      { href: "/relance-facture-impayee", label: "Relance d'impayés" },
    ],
  },
  {
    slug: "facturation-tpe",
    noindex: true,
    title: "Facturation pour TPE : factures suivies, échéances tenues, relances validées | nodaq",
    description:
      "nodaq suit vos factures et avoirs jusqu'au paiement : échéancier, taux de recouvrement, campagnes de relance préparées par nodaq et déclenchées sur votre mandat.",
    h1: "Une facturation qui ne perd rien en route.",
    reponse:
      "Émettre la facture n'est que la moitié du travail — l'autre moitié est de la voir payée. nodaq suit chaque facture et chaque avoir jusqu'au paiement : échéancier, taux de recouvrement visible au cockpit, et campagnes de relance prêtes dès qu'une échéance passe — déclenchées seulement sur votre mandat.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Chaque facture émise entre dans l'échéancier avec sa date. Le cockpit affiche ce qui est émis, ce qui est en attente et le <strong>taux de recouvrement</strong>. À l'échéance dépassée, la campagne de relance se prépare — <a href="/relance-facture-impayee">un clic pour donner le mandat</a>.</p>`,
      },
      {
        h2: "Les factures fournisseurs aussi",
        html: `<p>Une facture reçue se photographie : nodaq la lit, en extrait l'essentiel (type, montant, contact, date) et la classe au bon endroit du classeur. Fini la bannette qui attend la fin du mois. Et une facture reçue au format électronique Factur-X est lue depuis ses données structurées, sans ressaisie.</p>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Les TPE qui facturent à l'affaire et dont le dirigeant fait la facturation lui-même, souvent le soir. Voir aussi le <a href="/logiciel-gestion-tpe">logiciel de gestion TPE</a> complet.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Que se passe-t-il quand une facture n'est pas payée ?",
        a: "nodaq prépare la relance dès l'échéance dépassée et vous la présente. Elle n'est envoyée qu'après votre validation en un clic — jamais dans votre dos.",
      },
    ],
    freres: [
      { href: "/logiciel-devis-facture", label: "Du devis à la facture" },
      { href: "/relance-facture-impayee", label: "Relance d'impayés" },
      { href: "/suivi-tresorerie-tpe", label: "Suivi de trésorerie" },
    ],
  },
  {
    slug: "suivi-tresorerie-tpe",
    noindex: true,
    title: "Suivi de trésorerie pour TPE : ce qui rentre, ce qui sort, ce qui arrive | nodaq",
    description:
      "Le cockpit nodaq montre la trésorerie disponible, les factures en attente, l'échéancier fiscal et les charges récurrentes d'une TPE — en temps réel, sans tableur.",
    h1: "Votre trésorerie, lisible en un regard.",
    reponse:
      "La trésorerie d'une TPE se pilote souvent de tête, avec un tableur en retard d'un mois. Le cockpit nodaq la rend lisible en continu : trésorerie disponible, chiffre d'affaires du mois, factures en attente, échéancier fiscal et charges récurrentes — alimenté automatiquement par vos factures et vos encaissements.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Chaque facture émise, chaque facture fournisseur photographiée et chaque paiement enregistré alimentent le cockpit. Vous y lisez ce qui est <strong>rentré</strong>, ce qui <strong>doit rentrer</strong> (avec le taux de recouvrement), et ce qui va <strong>sortir</strong> — échéances fiscales et charges récurrentes comprises.</p>`,
      },
      {
        h2: "Pourquoi pas un tableur ?",
        html: `<p>Parce qu'un tableur n'est juste que le jour où on le remplit. Ici la donnée vient du flux réel — <a href="/facturation-tpe">factures</a>, encaissements, <a href="/gestion-chantier">heures et chantiers</a> — sans ressaisie. Les chiffres sourcés de <a href="/">notre page d'accueil</a> montrent ce que coûte le pilotage à l'aveugle.</p>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Mi-mois, une dirigeante regarde son cockpit : 7 440 € encaissés, trois factures en attente, l'échéance d'URSSAF dans douze jours. Elle sait qu'elle peut payer le fournisseur maintenant — ou qu'il faut d'abord relancer la facture échue. La décision prend trente secondes, pas une soirée de tableur.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Dois-je ressaisir mes opérations ?",
        a: "Non : le cockpit est alimenté par vos factures émises, les factures fournisseurs photographiées et les paiements enregistrés dans nodaq.",
      },
    ],
    freres: [
      { href: "/facturation-tpe", label: "Facturation TPE" },
      { href: "/calcul-marge-chantier", label: "Calcul de marge" },
      { href: "/logiciel-gestion-tpe", label: "Le logiciel de gestion TPE" },
    ],
  },
  {
    slug: "calcul-marge-chantier",
    noindex: true,
    title: "Suivre la marge d'un chantier pendant le chantier, pas après coup | nodaq",
    description:
      "nodaq recalcule la marge de chaque chantier dès qu'une facture ou une heure est enregistrée. Vous savez si un chantier est rentable pendant le chantier.",
    h1: "La marge d'un chantier se découvre pendant, pas après.",
    reponse:
      "Trop de chantiers se révèlent non rentables une fois terminés — quand il est trop tard. nodaq réévalue la marge de chaque chantier à chaque heure pointée, la compare à votre seuil de rentabilité, et vous dit précisément ce qui manque pour la connaître exactement. Vous corrigez le tir pendant le chantier.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Le devis fixe le prix de vente. En face, chaque <strong>heure pointée</strong> est valorisée au coût horaire chargé de chaque membre de l'équipe : la marge est réévaluée sans ressaisie, mission par mission. Et nodaq est honnête sur ce qu'il ne sait pas : tant que tous les coûts ne sont pas renseignés, il affiche une <strong>estimation haute</strong> et liste ce qui manque — jamais un faux chiffre exact.</p>`,
      },
      {
        h2: "Le seuil de rentabilité",
        html: `<p>nodaq ne calcule pas votre seuil à votre place — il dépend de vos charges fixes et de votre marge, que vous seul connaissez. Vous le renseignez une fois ; chaque chantier s'y compare ensuite automatiquement.</p>`,
      },
      {
        h2: "Pour qui ?",
        html: `<p>Toute entreprise qui vend à l'affaire : <a href="/logiciel-batiment">bâtiment</a> d'abord, et tout métier où la rentabilité se joue chantier par chantier, mission par mission.</p>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Chantier vendu 12 000 €. À mi-parcours, les heures pointées par l'équipe pèsent déjà plus que prévu : l'estimation de marge glisse vers le seuil de rentabilité. Le dirigeant le voit maintenant — il peut négocier un avenant ou resserrer la fin de chantier, au lieu de le découvrir au bilan.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "D'où viennent les chiffres de la marge ?",
        a: "Du réel : le devis pour le prix de vente, et les heures pointées — valorisées au coût horaire de chaque membre — pour les coûts. Jamais d'une estimation de l'IA : un chiffre affiché vient toujours d'un calcul déterministe, et nodaq dit explicitement ce qui manque pour passer de l'estimation à la marge exacte.",
      },
    ],
    freres: [
      { href: "/gestion-chantier", label: "Gestion de chantier" },
      { href: "/suivi-tresorerie-tpe", label: "Suivi de trésorerie" },
      { href: "/logiciel-batiment", label: "Logiciel bâtiment" },
    ],
  },
  {
    slug: "gestion-chantier",
    noindex: true,
    title: "Gestion de chantier pour TPE : heures, dépenses, marge et facturation | nodaq",
    description:
      "Suivez chaque chantier dans nodaq : heures de l'équipe, factures fournisseurs photographiées et classées, marge suivie en continu et facturation — du devis à l'encaissement.",
    h1: "Chaque chantier suivi, du devis à l'encaissement.",
    reponse:
      "Un chantier, c'est un devis, des heures, des achats, des factures — éparpillés entre des carnets, des photos et un tableur. nodaq les rassemble : les heures de l'équipe pointées par chantier, les factures fournisseurs photographiées et classées, la marge réévaluée à chaque heure enregistrée, et la facturation jusqu'à l'encaissement.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Chaque chantier ouvert regroupe son devis, ses <strong>heures</strong> (rattachées au chantier ou au client), ses <strong>documents</strong> (factures fournisseurs photographiées, classées au classeur) et ses <strong>factures client</strong>. Le cockpit affiche les chantiers en cours et leur état en un regard.</p>`,
      },
      {
        h2: "La marge, pendant le chantier",
        html: `<p>Les heures pointées alimentent la <a href="/calcul-marge-chantier">marge, réévaluée en continu</a> : vous savez si le chantier tient son prix pendant qu'il est encore temps d'agir — et nodaq vous dit ce qui manque pour la connaître exactement.</p>`,
      },
      {
        h2: "Et à la fin",
        html: `<p>La <a href="/facturation-tpe">facturation</a> part du réel du chantier — y compris les heures pointées facturables —, l'échéancier suit le paiement, et la <a href="/relance-facture-impayee">campagne de relance</a> se prépare si le client tarde. Les <strong>rapports</strong> gardent la trace de ce que chaque chantier a vraiment rapporté.</p>`,
      },
    ],
    faq: [
      ...FAQ_COMMUNES,
      {
        q: "Mes salariés peuvent-ils saisir leurs heures ?",
        a: "Les heures s'enregistrent par membre d'équipe — via un récapitulatif hebdomadaire à confirmer ou à la voix — et se rattachent à un chantier ou à un client. Elles alimentent directement l'estimation de marge du chantier.",
      },
    ],
    freres: [
      { href: "/calcul-marge-chantier", label: "Calcul de marge" },
      { href: "/logiciel-batiment", label: "Logiciel bâtiment" },
      { href: "/logiciel-gestion-tpe", label: "Le logiciel de gestion TPE" },
    ],
  }
);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const jsonld = (o) => JSON.stringify(o, null, 2).replace(/</g, "\\u003c");

function rendre(p) {
  const url = `https://nodaq.fr/${p.slug}`;
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Accueil", item: "https://nodaq.fr/" },
      { "@type": "ListItem", position: 2, name: p.h1.replace(/\.$/, ""), item: url },
    ],
  };
  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: p.h1,
    url,
    inLanguage: "fr-FR",
    dateModified: MAJ,
    isPartOf: { "@type": "WebSite", name: "nodaq", url: "https://nodaq.fr/" },
  };
  const faqld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
${EN_VALIDATION || p.noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:site_name" content="nodaq">
<meta property="og:title" content="${esc(p.h1)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:image" content="https://nodaq.fr/og-image.png">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0b0f">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230a0b0f'/><path d='M8 25V7h4l8 12V7h4v18h-4l-8-12v12z' fill='%23a3e635'/><circle cx='9' cy='24' r='2.4' fill='%23d9f99d'/><circle cx='23' cy='8' r='2.4' fill='%23d9f99d'/></svg>">
<link rel="preload" href="/fonts/f02.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts.css">
<style>
:root{--bg:#0a0b0f;--panel:#14161d;--text:#f4f4f5;--muted:#a1a1aa;--lime:#a3e635;--hair:rgba(244,244,245,.10)}
*{margin:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
.shell{max-width:820px;margin:0 auto;padding:0 20px}
a{color:var(--lime)}
header{border-bottom:1px solid var(--hair);padding:16px 0}
header .shell{display:flex;justify-content:space-between;align-items:center}
.logo{font-weight:800;letter-spacing:.08em;color:var(--text);text-decoration:none}
.logo b{color:var(--lime)}
nav.crumb{font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--muted);margin:26px 0 6px}
nav.crumb a{color:var(--muted);text-decoration:none}
nav.crumb a:hover{color:var(--lime)}
h1{font-size:clamp(1.7rem,4.5vw,2.5rem);line-height:1.15;letter-spacing:-.01em;margin:8px 0 18px}
.reponse{font-size:1.08rem;color:var(--text);border-left:3px solid var(--lime);padding:4px 0 4px 18px;margin:0 0 34px}
h2{font-size:1.25rem;margin:38px 0 12px}
section p,section li{color:var(--muted)}
section strong{color:var(--text)}
ul{padding-left:20px;display:grid;gap:8px}
.faq{display:grid;gap:10px;margin-top:14px}
.faq details{background:var(--panel);border:1px solid var(--hair);border-radius:10px;padding:14px 18px}
.faq summary{cursor:pointer;font-weight:600;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq p{margin-top:10px;color:var(--muted)}
.cta{display:block;background:var(--panel);border:1px solid rgba(163,230,53,.4);border-radius:10px;padding:22px;margin:42px 0;text-align:center;text-decoration:none}
.cta strong{display:block;font-size:1.15rem;color:var(--text);margin-bottom:6px}
.cta span{color:var(--muted);font-size:.95rem}
.freres{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 40px}
.freres a{font-family:'JetBrains Mono',monospace;font-size:.82rem;border:1px solid var(--hair);border-radius:10px;padding:8px 14px;text-decoration:none;color:var(--text)}
.freres a:hover{border-color:var(--lime)}
footer{border-top:1px solid var(--hair);padding:24px 0 40px;margin-top:20px}
footer .shell{display:flex;flex-wrap:wrap;gap:16px;font-size:.82rem;color:var(--muted)}
footer a{color:var(--muted);text-decoration:none}
footer a:hover{color:var(--lime)}
.maj{font-family:'JetBrains Mono',monospace;font-size:.75rem;color:var(--muted);margin-top:34px}
</style>
</head>
<body>
<header><div class="shell"><a class="logo" href="/">N<b>O</b>DAQ</a><a href="/#inscription" style="font-size:.85rem">Rejoindre les 1ers utilisateurs</a></div></header>
<main class="shell">
  <nav class="crumb" aria-label="Fil d'Ariane"><a href="/">Accueil</a> / ${esc(p.h1.replace(/\.$/, ""))}</nav>
  <h1>${p.h1}</h1>
  <p class="reponse">${p.reponse}</p>
  ${p.sections.map((s) => `<section>\n  <h2>${esc(s.h2)}</h2>\n  ${s.html}\n</section>`).join("\n")}
  <section>
    <h2>Questions fréquentes</h2>
    <div class="faq">
      ${p.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n      ")}
    </div>
  </section>
  <a class="cta" href="/#inscription"><strong>Découvrir nodaq</strong><span>Programme fondateurs — 50 places, tarif garanti à vie, sans carte bancaire.</span></a>
  <h2 style="font-size:1rem">À lire aussi</h2>
  <div class="freres">
    ${p.freres.map((f) => `<a href="${f.href}">${esc(f.label)}</a>`).join("\n    ")}
    <a href="/">La page d'accueil nodaq</a>
  </div>
  <p class="maj">Dernière mise à jour : ${MAJ}</p>
</main>
<footer><div class="shell">
  <a href="/mentions-legales">Mentions légales</a>
  <a href="/confidentialite">Confidentialité</a>
  <a href="/cgv">CGV</a>
</div></footer>
<script type="application/ld+json">
${jsonld(breadcrumb)}
</script>
<script type="application/ld+json">
${jsonld(webpage)}
</script>
<script type="application/ld+json">
${jsonld(faqld)}
</script>
</body>
</html>
`;
}

for (const p of PAGES) {
  fs.writeFileSync(path.join(ici, `${p.slug}.html`), rendre(p));
  console.log(`${p.slug}.html généré${EN_VALIDATION ? " (noindex — validation)" : ""}`);
}
