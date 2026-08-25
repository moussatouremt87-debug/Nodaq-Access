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
      {
        h2: "Votre métier",
        html: `<p>Chaque métier du bâtiment a son rythme — nodaq s'y plie :</p>
        <ul>
          <li><a href="/metiers/plombier">Plombier</a> · <a href="/metiers/electricien">Électricien</a> · <a href="/metiers/chauffagiste">Chauffagiste</a></li>
          <li><a href="/metiers/macon">Maçon</a> · <a href="/metiers/couvreur">Couvreur</a> · <a href="/metiers/entreprise-renovation">Entreprise de rénovation</a></li>
          <li><a href="/metiers/peintre">Peintre</a> · <a href="/metiers/carreleur">Carreleur</a> · <a href="/metiers/menuisier">Menuisier</a> · <a href="/metiers/paysagiste">Paysagiste</a></li>
        </ul>`,
      },
    ],
    faq: [
      {
        q: "Quand est-ce disponible ?",
        a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026, avant toute disponibilité publique.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Trois formules : Solo à 49 € HT/mois, Équipe à 89 € HT/mois (5 utilisateurs inclus), et l'offre Fondateurs à 29 € HT/mois, garantie à vie pour les 50 premiers inscrits. Le détail est sur nodaq.fr/tarifs.",
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
        a: "Trois formules : Solo à 49 € HT/mois, Équipe à 89 € HT/mois (5 utilisateurs inclus), et l'offre Fondateurs à 29 € HT/mois, garantie à vie pour les 50 premiers inscrits. Le détail est sur nodaq.fr/tarifs.",
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
    a: "Trois formules : Solo à 49 € HT/mois, Équipe à 89 € HT/mois (5 utilisateurs inclus), et l'offre Fondateurs à 29 € HT/mois, garantie à vie pour les 50 premiers inscrits. Le détail est sur nodaq.fr/tarifs.",
  },
  {
    q: "Mes données sont-elles en sécurité ?",
    a: "Les données sont hébergées en France, et aucun envoi (devis, relance) ne part sans votre validation explicite.",
  },
];

PAGES.push(
  {
    slug: "logiciel-gestion-tpe",
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
  // Guides éditoriaux : Article balisé, sources visibles, avertissement.
  const articleld = p.type === "guide" ? {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.h1.replace(/\.$/, ""),
    inLanguage: "fr-FR",
    datePublished: p.datePub || MAJ,
    dateModified: MAJ,
    mainEntityOfPage: url,
    author: { "@type": "Organization", name: "nodaq", url: "https://nodaq.fr/" },
    publisher: {
      "@type": "Organization",
      name: "nodaq",
      url: "https://nodaq.fr/",
      logo: { "@type": "ImageObject", url: "https://nodaq.fr/logo.png" },
    },
  } : null;
  const blocSources = p.sources?.length
    ? `<section>\n    <h2>Sources</h2>\n    <ul>\n      ${p.sources.map((s) => `<li><a href="${s.href}" rel="nofollow noopener">${esc(s.label)}</a></li>`).join("\n      ")}\n    </ul>\n    <p style="font-size:.85rem;color:var(--muted)">Contenu informatif, à jour au ${MAJ}. Les règles évoluent : vérifiez les textes en vigueur — ceci ne constitue pas un conseil juridique.</p>\n  </section>`
    : "";

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
  ${blocSources}
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
${articleld ? `<script type="application/ld+json">\n${jsonld(articleld)}\n</script>` : ""}
</body>
</html>
`;
}

// ── Phase 3 : pages métiers (/metiers/<slug>) ──────────────────────────────
// Même produit pour tous — la différenciation est dans le QUOTIDIEN du
// métier (des faits de terrain, pas des fonctionnalités inventées), le
// scénario illustratif et la FAQ métier. Les capacités citées sont celles
// vérifiées à l'inventaire du code : devis dictés, photo de facture
// extraite/classée, heures pointées → estimation de marge, campagnes de
// relance sur mandat, contrats récurrents facturés à échéance, affectations
// d'équipe et absences.
const METIERS = [
  {
    slug: "plombier",
    nom: "plombier",
    titre: "Logiciel de gestion pour plombier : devis dictés, marge, impayés | nodaq",
    desc: "Le copilote de gestion des plombiers : devis dictés entre deux interventions, factures photographiées, marge par chantier et relances d'impayés sur votre mandat.",
    h1: "Le logiciel de gestion pensé pour les plombiers.",
    reponse:
      "Un plombier jongle entre dépannages urgents et chantiers planifiés — la gestion se fait dans les creux. Avec nodaq, le devis se dicte au pied de la chaudière, la facture du grossiste se photographie, la relance d'un impayé se déclenche d'un clic. Vous validez tout ; nodaq prépare tout.",
    quotidien: `<p>Des journées hachées : un dépannage qui s'intercale, un chantier de salle de bains qui attend, un devis promis « ce soir » qui glisse au week-end. Les fournitures pèsent lourd dans le prix, et le temps passé à chiffrer un chauffe-eau ou une rénovation complète est du temps non facturé.</p>`,
    exemple: `<p>Fuite chez un client à 8 h, chantier de salle d'eau à 10 h. Entre les deux, dans le fourgon : le devis du prochain chantier se dicte en une minute, avec les tarifs de l'entreprise. À midi, la facture du grossiste est photographiée — lue et classée. Le soir, une campagne de relance attend son mandat pour une facture de dépannage impayée depuis trois semaines : un clic.</p>`,
    faqMetier: {
      q: "Je fais surtout du dépannage, avec beaucoup de petites factures — est-ce adapté ?",
      a: "Oui : chaque intervention peut devenir une affaire ou se rattacher à un client, la facture suit son échéance, et les campagnes de relance se préparent dès qu'un paiement tarde — vous gardez la main sur chaque envoi.",
    },
    proches: ["chauffagiste", "electricien"],
  },
  {
    slug: "electricien",
    nom: "électricien",
    titre: "Logiciel de gestion pour électricien : devis, chantiers, impayés | nodaq",
    desc: "Le copilote de gestion des électriciens : devis dictés, suivi par chantier (neuf et rénovation), heures de l'équipe, relances d'impayés sur votre mandat.",
    h1: "Le logiciel de gestion pensé pour les électriciens.",
    reponse:
      "Entre le neuf, la rénovation et les mises aux normes, un électricien mène plusieurs chantiers de front — et les devis s'empilent le soir. Avec nodaq, vous dictez le devis en sortant du rendez-vous, suivez chaque chantier avec ses heures, et déclenchez les relances d'impayés d'un clic. Rien ne part sans vous.",
    quotidien: `<p>Des chantiers en parallèle — un tableau à reprendre ici, une rénovation complète là — et des devis qui demandent du détail : postes nombreux, fournitures précises, variantes demandées par le client. Les heures de l'équipe se dispersent entre les chantiers, et la rentabilité réelle de chacun reste floue jusqu'au bilan.</p>`,
    exemple: `<p>Visite d'une maison à rénover en fin de journée. Sur le parking, l'électricien dicte le devis pièce par pièce : nodaq structure les postes avec ses tarifs, il relit et envoie le soir même — pas le dimanche. Dans la semaine, les heures des deux salariés se confirment en un récapitulatif ; l'estimation de marge du chantier suit, chantier par chantier.</p>`,
    faqMetier: {
      q: "Je travaille avec deux salariés sur plusieurs chantiers — peut-on suivre qui fait quoi ?",
      a: "Oui : les membres de l'équipe s'affectent aux affaires, leurs heures se pointent par chantier (récapitulatif hebdomadaire à confirmer, ou à la voix), et chaque heure alimente l'estimation de marge du chantier concerné.",
    },
    proches: ["plombier", "chauffagiste"],
  },
  {
    slug: "peintre",
    nom: "peintre en bâtiment",
    titre: "Logiciel de gestion pour peintre en bâtiment : devis, suivi, impayés | nodaq",
    desc: "Le copilote de gestion des peintres : devis dictés après la visite, chantiers courts enchaînés, factures suivies jusqu'au paiement, relances sur votre mandat.",
    h1: "Le logiciel de gestion pensé pour les peintres en bâtiment.",
    reponse:
      "Des chantiers courts qui s'enchaînent, des devis au métré à rendre vite, des paiements qui traînent d'un chantier sur l'autre : la gestion d'un peintre se joue à la cadence. Avec nodaq, le devis se dicte après la visite, chaque facture suit son échéance, et la relance se déclenche d'un clic quand un client tarde.",
    quotidien: `<p>Celui qui rend son devis le premier prend souvent le chantier — mais les devis se chiffrent le soir, après les heures de peinture. Les chantiers durent quelques jours : un retard de paiement sur deux ou trois chantiers d'affilée, et c'est la trésorerie du mois qui se tend.</p>`,
    exemple: `<p>Visite d'un appartement mardi soir : trois pièces, plafonds compris. Le devis se dicte dans la voiture — surfaces, préparation, deux couches — et part le soir même. Le chantier suivant est facturé vendredi ; à l'échéance dépassée, la campagne de relance est prête : le peintre donne son mandat entre deux chantiers.</p>`,
    faqMetier: {
      q: "Mes chantiers durent trois jours — est-ce que l'outil n'est pas trop lourd pour ça ?",
      a: "Non : dicter un devis prend une minute, une facture se crée depuis le devis accepté, et le suivi (échéance, relance, encaissement) est automatique jusqu'à votre validation. L'outil suit votre cadence, pas l'inverse.",
    },
    proches: ["carreleur", "menuisier"],
  },
  {
    slug: "couvreur",
    nom: "couvreur",
    titre: "Logiciel de gestion pour couvreur : devis, urgences, chantiers | nodaq",
    desc: "Le copilote de gestion des couvreurs : devis dictés après la visite de toiture, urgences facturées sans retard, chantiers suivis malgré la météo.",
    h1: "Le logiciel de gestion pensé pour les couvreurs.",
    reponse:
      "Le métier de couvreur se plie à la météo : des chantiers qui s'arrêtent et reprennent, des urgences après un coup de vent, des devis à rendre pendant que le client regarde encore son plafond. Avec nodaq, le devis se dicte en redescendant de l'échelle, l'urgence se facture sans attendre, et chaque chantier garde son fil malgré les interruptions.",
    quotidien: `<p>Une tempête remplit le carnet de demandes en une nuit — et c'est précisément la semaine où il n'y a pas une heure pour chiffrer. Les chantiers s'interrompent avec la pluie, reprennent, s'entremêlent ; les acomptes et les factures de fin de chantier se perdent facilement dans ce désordre imposé par le ciel.</p>`,
    exemple: `<p>Lundi matin après un week-end venté : quatre appels pour des tuiles envolées. Entre deux bâchages, chaque devis se dicte sur place — nodaq les met en forme, le couvreur les relit le soir et les envoie d'un coup. Le chantier de réfection en cours, arrêté deux jours pour pluie, garde ses heures et ses documents rattachés : rien ne se perd dans l'interruption.</p>`,
    faqMetier: {
      q: "Mes chantiers s'arrêtent et reprennent au gré de la météo — le suivi tient-il ?",
      a: "Oui : une affaire reste ouverte tant que vous ne la clôturez pas. Heures, documents photographiés et factures s'y rattachent au fil de l'eau, même avec des interruptions — et le cockpit vous montre où en est chaque chantier.",
    },
    proches: ["macon", "entreprise-renovation"],
  },
  {
    slug: "macon",
    nom: "maçon",
    titre: "Logiciel de gestion pour maçon : chantiers longs, acomptes, marge | nodaq",
    desc: "Le copilote de gestion des maçons : chantiers longs facturés au fil de l'avancement, acomptes suivis, heures de l'équipe pointées, marge suivie en continu.",
    h1: "Le logiciel de gestion pensé pour les maçons.",
    reponse:
      "Le gros œuvre, ce sont des chantiers longs, des équipes, des acomptes et une facturation au fil de l'avancement — le tout avec des montants qui ne pardonnent pas l'à-peu-près. Avec nodaq, chaque chantier se facture par étapes depuis l'affaire, les heures de l'équipe se pointent par semaine, et l'estimation de marge suit pendant le chantier, pas après.",
    quotidien: `<p>Un chantier de plusieurs mois engage l'entreprise : de la main-d'œuvre chaque semaine, des factures à émettre au fil de l'avancement pour tenir la trésorerie, un client qui paie parfois avec retard alors que les salaires, eux, tombent chaque mois. La rentabilité réelle ne peut pas attendre la fin du chantier pour être connue.</p>`,
    exemple: `<p>Extension de 40 m² sur quatre mois, à trois. Chaque vendredi, le récapitulatif d'heures se confirme en une minute ; l'estimation de marge du chantier s'ajuste. À chaque étape franchie, une facture part depuis l'affaire — et à la première échéance dépassée, la campagne de relance attend le mandat du chef d'entreprise, pas l'inverse.</p>`,
    faqMetier: {
      q: "Je facture mes chantiers en plusieurs fois — c'est possible ?",
      a: "Oui : une affaire peut donner lieu à plusieurs factures au fil de l'avancement, chacune suivie jusqu'à son paiement, avec les encaissements rattachés au chantier.",
    },
    proches: ["entreprise-renovation", "couvreur"],
  },
  {
    slug: "menuisier",
    nom: "menuisier",
    titre: "Logiciel de gestion pour menuisier : sur-mesure, acomptes, pose | nodaq",
    desc: "Le copilote de gestion des menuisiers : devis de fabrication sur mesure dictés, acomptes avant commande, heures d'atelier et de pose suivies par affaire.",
    h1: "Le logiciel de gestion pensé pour les menuisiers.",
    reponse:
      "Entre l'atelier et la pose, un menuisier avance de l'argent : les fournitures d'un ouvrage sur mesure se commandent bien avant la facture finale. Avec nodaq, le devis se dicte au retour de la prise de cotes, l'acompte se facture avant de commander, et les heures d'atelier comme de pose se rattachent à l'affaire — la marge se suit en continu.",
    quotidien: `<p>Un escalier ou un agencement sur mesure, c'est des semaines entre la prise de cotes et la pose — et des fournitures payées longtemps avant d'être facturées au client. Sans acompte encaissé au bon moment, c'est l'entreprise qui finance le chantier du client. Et les heures d'atelier, moins visibles que la pose, sont celles qu'on oublie de compter.</p>`,
    exemple: `<p>Prise de cotes pour une bibliothèque sur mesure le jeudi. Le devis se dicte au retour — fabrication, finition, pose — et part le soir. À l'acceptation, une facture d'acompte est émise avant la commande du bois. Trois semaines d'atelier plus tard, les heures pointées montrent que la fabrication a pris plus que prévu : le menuisier le sait avant la pose, pas après.</p>`,
    faqMetier: {
      q: "Puis-je facturer un acompte à la commande ?",
      a: "Oui : un devis accepté devient une affaire, et vous émettez les factures à votre rythme — acompte à la commande, solde à la pose — chacune suivie jusqu'au paiement.",
    },
    proches: ["peintre", "carreleur"],
  },
  {
    slug: "chauffagiste",
    nom: "chauffagiste",
    titre: "Logiciel de gestion pour chauffagiste : contrats d'entretien, urgences | nodaq",
    desc: "Le copilote de gestion des chauffagistes : contrats d'entretien facturés à échéance, urgences d'hiver absorbées, devis dictés, relances sur votre mandat.",
    h1: "Le logiciel de gestion pensé pour les chauffagistes.",
    reponse:
      "Le métier de chauffagiste vit en deux saisons : l'hiver des urgences et l'année des contrats d'entretien. Avec nodaq, vos contrats génèrent leurs factures à échéance sans ressaisie, les dépannages se facturent dans la foulée, et les devis de remplacement se dictent entre deux interventions. Chaque envoi attend votre validation.",
    quotidien: `<p>De novembre à février, les pannes s'enchaînent et la paperasse s'accumule — précisément quand il n'y a pas le temps. Le reste de l'année, ce sont les entretiens sous contrat : récurrents, prévisibles, mais fastidieux à facturer un par un. Deux rythmes opposés, une seule gestion.</p>`,
    exemple: `<p>Janvier, trois dépannages dans la journée. Chacun devient une facture le soir même, dictée en quelques mots. Pendant ce temps, les contrats d'entretien du mois ont généré leurs factures à leur échéance — le chauffagiste les a validées d'un coup au café du matin. Et le devis de remplacement de chaudière promis la veille est parti avant la deuxième intervention.</p>`,
    faqMetier: {
      q: "J'ai des contrats d'entretien annuels — la facturation peut-elle suivre toute seule ?",
      a: "Vos contrats récurrents sont enregistrés avec leur échéance, et nodaq prépare leurs factures à date. Vous validez — rien n'est émis sans vous — et chaque facture suit ensuite son paiement.",
    },
    proches: ["plombier", "electricien"],
  },
  {
    slug: "carreleur",
    nom: "carreleur",
    titre: "Logiciel de gestion pour carreleur : métrés, sous-traitance, paiements | nodaq",
    desc: "Le copilote de gestion des carreleurs : devis au métré dictés, chantiers en propre ou en sous-traitance, factures suivies jusqu'au paiement.",
    h1: "Le logiciel de gestion pensé pour les carreleurs.",
    reponse:
      "Le carreleur travaille souvent sur deux fronts : ses propres clients, et la sous-traitance pour des entreprises générales — où les délais de paiement s'allongent. Avec nodaq, le devis au métré se dicte après la visite, chaque chantier garde ses heures et ses documents, et les factures — au particulier comme au donneur d'ordre — sont suivies jusqu'au paiement, relance comprise.",
    quotidien: `<p>Chez le particulier, tout va vite : visite, métré, devis, chantier. En sous-traitance, tout va lentement : le chantier est fini depuis des semaines que la facture court toujours. Relancer un donneur d'ordre demande du doigté — mais ne pas relancer coûte la trésorerie.</p>`,
    exemple: `<p>Une salle de bains de 14 m² chez un particulier, dictée en devis mardi, posée la semaine suivante, payée à quinze jours. En parallèle, un chantier en sous-traitance facturé depuis 45 jours : la campagne de relance est prête, courtoise et factuelle — le carreleur donne son mandat, l'appel est passé en journée, le paiement suit.</p>`,
    faqMetier: {
      q: "Je fais de la sous-traitance — puis-je relancer un donneur d'ordre sans me fâcher ?",
      a: "La relance est préparée par nodaq, factuelle et courtoise, et rien ne part sans votre mandat. Vous choisissez quand relancer, qui relancer, et vous pouvez écarter un client d'un clic.",
    },
    proches: ["peintre", "macon"],
  },
  {
    slug: "paysagiste",
    nom: "paysagiste",
    titre: "Logiciel de gestion pour paysagiste : contrats d'entretien, saisons | nodaq",
    desc: "Le copilote de gestion des paysagistes : contrats d'entretien facturés à échéance, chantiers de création suivis avec les heures d'équipe, relances sur mandat.",
    h1: "Le logiciel de gestion pensé pour les paysagistes.",
    reponse:
      "Création au printemps, entretien toute l'année : le paysagiste cumule chantiers ponctuels et contrats récurrents, avec des équipes sur le terrain. Avec nodaq, les contrats d'entretien génèrent leurs factures à échéance, les chantiers de création gardent heures et documents rattachés, et l'estimation de marge suit chaque affaire — pendant la saison, pas après.",
    quotidien: `<p>La belle saison concentre tout : les chantiers de création, les tontes sous contrat, les équipes à répartir — et la facturation qui devrait suivre chaque semaine mais attend l'automne. Les contrats d'entretien, eux, méritent d'être facturés à l'heure dite : c'est la trésorerie stable de l'entreprise.</p>`,
    exemple: `<p>Avril : deux créations de jardin en cours, trois équipes, et quarante contrats de tonte qui démarrent. Les factures d'entretien du mois se génèrent à leur échéance — validées en une fois. Sur la création la plus grosse, les heures pointées de la semaine font glisser l'estimation de marge : le paysagiste resserre le planning avant que la saison n'avale la rentabilité.</p>`,
    faqMetier: {
      q: "J'ai des dizaines de contrats d'entretien — comment éviter la ressaisie chaque mois ?",
      a: "Chaque contrat récurrent est enregistré une fois, avec son montant et sa cadence. nodaq prépare les factures à échéance ; vous les validez en une passe, et elles suivent ensuite leur paiement.",
    },
    proches: ["macon", "entreprise-renovation"],
  },
  {
    slug: "entreprise-renovation",
    nom: "entreprise de rénovation",
    titre: "Logiciel de gestion pour entreprise de rénovation : multi-corps, marge | nodaq",
    desc: "Le copilote des entreprises de rénovation : chantiers multi-corps suivis de bout en bout, équipes affectées, facturation par étapes, marge suivie en continu.",
    h1: "Le logiciel de gestion pensé pour les entreprises de rénovation.",
    reponse:
      "Une rénovation complète, c'est tous les corps d'état à coordonner, des semaines de chantier, une équipe à répartir et une facturation par étapes. Avec nodaq, chaque chantier rassemble son devis, ses heures, ses documents et ses factures ; l'équipe s'affecte par affaire ; et l'estimation de marge se suit pendant le chantier — là où elle peut encore être défendue.",
    quotidien: `<p>Le dirigeant d'une entreprise de rénovation passe ses journées à arbitrer : quelle équipe sur quel chantier, quel lot commence quand, quelle étape facturer. Chaque chantier est un petit projet — et la marge se joue dans mille détails que personne ne consigne quand tout va vite.</p>`,
    exemple: `<p>Rénovation complète d'un appartement en huit semaines : démolition, plomberie, électricité, plâtrerie, peinture. Les deux équipes sont affectées à l'affaire, leurs heures confirmées chaque semaine. À chaque lot terminé, une facture d'étape part — validée par le dirigeant. À mi-chantier, l'estimation de marge tient : il le sait, au lieu de l'espérer.</p>`,
    faqMetier: {
      q: "Je gère plusieurs chantiers et plusieurs équipes en même temps — l'outil suit ?",
      a: "Oui : chaque affaire a ses membres affectés, ses heures, ses documents et ses factures. Le cockpit montre l'ensemble des chantiers en cours, et les absences de l'équipe se déclarent en un mot.",
    },
    proches: ["macon", "couvreur"],
  },
];

function construirePageMetier(m) {
  return {
    slug: `metiers/${m.slug}`,
    title: m.titre,
    description: m.desc,
    h1: m.h1,
    reponse: m.reponse,
    sections: [
      { h2: `Le quotidien d'un ${m.nom}`, html: m.quotidien },
      {
        h2: "Ce que nodaq change",
        html: `<ul>
          <li><a href="/devis-ia">Devis dictés à la voix</a>, chiffrés avec vos tarifs — jamais un prix inventé par l'IA.</li>
          <li>Factures fournisseurs <strong>photographiées</strong>, lues et classées au bon endroit.</li>
          <li><a href="/calcul-marge-chantier">Marge par chantier</a> réévaluée à chaque heure pointée, comparée à votre seuil de rentabilité.</li>
          <li><a href="/relance-facture-impayee">Campagnes de relance</a> d'impayés préparées par nodaq, déclenchées sur votre mandat.</li>
          <li><a href="/suivi-tresorerie-tpe">Trésorerie lisible</a> : cockpit, échéancier, prévisionnel à 8 semaines.</li>
        </ul>`,
      },
      { h2: "Exemple concret (scénario illustratif)", html: m.exemple },
    ],
    faq: [
      m.faqMetier,
      {
        q: "Quand est-ce disponible ?",
        a: "nodaq est en développement actif. Le programme fondateurs ouvre l'accès prioritaire dès le 1er octobre 2026, avant toute disponibilité publique.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Trois formules : Solo à 49 € HT/mois, Équipe à 89 € HT/mois (5 utilisateurs inclus), et l'offre Fondateurs à 29 € HT/mois, garantie à vie pour les 50 premiers inscrits. Le détail est sur nodaq.fr/tarifs.",
      },
    ],
    freres: [
      ...m.proches.map((s) => {
        const p = METIERS.find((x) => x.slug === s);
        return { href: `/metiers/${p.slug}`, label: `Pour un ${p.nom}` };
      }),
      { href: "/logiciel-batiment", label: "Le logiciel bâtiment" },
    ],
  };
}

PAGES.push(...METIERS.map(construirePageMetier));

// ── Phase 4, lot 1 : guides éditoriaux (/guides/<slug>) ────────────────────
// Faits réglementaires vérifiés par recherche (sources en bas de page) ;
// les capacités nodaq citées sont celles de l'inventaire du code. Les
// guides « meilleur logiciel » et comparatifs attendent le go du fondateur
// (publicité comparative encadrée).
const GUIDES = [
  {
    slug: "guides/delai-paiement-facture",
    type: "guide",
    datePub: "2026-08-24",
    title: "Délai de paiement d'une facture entre professionnels : les règles | nodaq",
    description:
      "30 jours par défaut, 60 jours maximum, pénalités de retard et indemnité forfaitaire de 40 € : les règles des délais de paiement entre professionnels, expliquées simplement.",
    h1: "Délai de paiement d'une facture : ce que dit la loi entre professionnels.",
    reponse:
      "Entre professionnels, une facture est payable sous 30 jours par défaut. Le contrat peut prévoir jusqu'à 60 jours à compter de la facture (ou 45 jours fin de mois). Au-delà, des pénalités de retard courent automatiquement, et une indemnité forfaitaire de 40 € de frais de recouvrement est due par facture en retard — sans relance préalable nécessaire.",
    sections: [
      {
        h2: "Les trois délais à connaître",
        html: `<ul>
          <li><strong>30 jours</strong> — le délai par défaut, à compter de la réception de la marchandise ou de l'exécution de la prestation, quand le contrat ne dit rien.</li>
          <li><strong>60 jours date de facture</strong> — le plafond que les parties peuvent convenir au contrat.</li>
          <li><strong>45 jours fin de mois</strong> — l'alternative possible si elle est expressément prévue au contrat.</li>
        </ul>`,
      },
      {
        h2: "Ce qui court automatiquement en cas de retard",
        html: `<p>Dès le lendemain de l'échéance, deux choses sont dues <strong>sans relance préalable</strong> : les <strong>pénalités de retard</strong> au taux prévu dans vos conditions générales (avec un minimum légal), et l'<strong>indemnité forfaitaire de 40 €</strong> pour frais de recouvrement — par facture en retard, une seule fois par facture. Le taux des pénalités et cette indemnité doivent figurer sur vos factures et dans vos CGV.</p>`,
      },
      {
        h2: "En pratique : les artisans attendent plus longtemps",
        html: `<p>Le droit est une chose, le terrain une autre : en France, une facture est payée en moyenne à <strong>44 jours</strong> pour environ 36 convenus (chiffres sourcés sur <a href="/">notre page d'accueil</a>). Ce sont les plus petites entreprises qui portent ce décalage — la trésorerie d'une TPE ne peut pas absorber deux ou trois retards en même temps.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Chaque facture émise entre dans <a href="/facturation-tpe">l'échéancier</a> avec sa date, le cockpit montre ce qui est en retard, et une <a href="/relance-facture-impayee">campagne de relance</a> se prépare dès qu'une échéance passe — déclenchée uniquement sur votre mandat.</p>`,
      },
    ],
    faq: [
      {
        q: "L'indemnité de 40 € s'applique-t-elle à chaque jour de retard ?",
        a: "Non : elle est due une seule fois par facture en retard, en plus des pénalités de retard qui, elles, courent dans le temps.",
      },
      {
        q: "Dois-je mentionner les pénalités sur mes factures ?",
        a: "Oui : le taux des pénalités de retard et le montant de l'indemnité forfaitaire de 40 € doivent figurer sur vos factures et dans vos conditions générales de vente.",
      },
    ],
    sources: [
      { href: "https://www.justice.fr/fiche/delais-paiement-entre-professionnels-penalites-retard", label: "Justice.fr — Délais de paiement entre professionnels et pénalités de retard" },
    ],
    freres: [
      { href: "/guides/comment-relancer-facture-impayee", label: "Comment relancer une facture impayée" },
      { href: "/facturation-tpe", label: "La facturation dans nodaq" },
    ],
  },
  {
    slug: "guides/comment-relancer-facture-impayee",
    type: "guide",
    datePub: "2026-08-24",
    title: "Comment relancer une facture impayée : étapes, ton et outils | nodaq",
    description:
      "Relance amiable, mise en demeure, injonction de payer : les étapes pour relancer une facture impayée sans abîmer la relation client, et ce que la loi prévoit (40 €, pénalités).",
    h1: "Comment relancer une facture impayée, étape par étape.",
    reponse:
      "La bonne relance est précoce, factuelle et courtoise : la plupart des retards sont des oublis. Commencez par une relance amiable dès l'échéance dépassée, rappelez les pénalités et l'indemnité de 40 € qui courent de plein droit, puis graduez — seconde relance, mise en demeure, et en dernier recours l'injonction de payer. Le plus important : ne pas attendre.",
    sections: [
      {
        h2: "1. La relance amiable, tout de suite",
        html: `<p>Dès quelques jours après l'échéance : un message court, factuel, sans reproche — numéro de facture, montant, date d'échéance, moyen de payer. Un appel téléphonique fonctionne souvent mieux qu'un e-mail : il lève l'ambiguïté en une conversation, et la plupart des « impayés » se règlent là.</p>`,
      },
      {
        h2: "2. La seconde relance, plus ferme",
        html: `<p>Sans réponse sous une à deux semaines : rappelez que des <strong>pénalités de retard</strong> et l'<strong>indemnité forfaitaire de 40 €</strong> sont dues de plein droit depuis l'échéance (voir notre guide des <a href="/guides/delai-paiement-facture">délais de paiement</a>). Restez professionnel : l'objectif est d'être payé, pas d'avoir raison.</p>`,
      },
      {
        h2: "3. La mise en demeure",
        html: `<p>Si les relances restent lettre morte : une <strong>mise en demeure</strong> par lettre recommandée avec accusé de réception, qui récapitule la créance et fixe un dernier délai. C'est un préalable utile aux étapes judiciaires, et son sérieux suffit souvent à débloquer le paiement.</p>`,
      },
      {
        h2: "4. En dernier recours : l'injonction de payer",
        html: `<p>Pour une créance non contestée, la procédure d'<strong>injonction de payer</strong> devant le tribunal de commerce est simple et peu coûteuse. À ce stade, faites-vous accompagner — et pesez le coût relationnel et commercial face au montant en jeu.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>nodaq surveille vos échéances et prépare des <a href="/relance-facture-impayee">campagnes de relance téléphonique</a> — courtoises, factuelles, dans une fenêtre horaire que vous choisissez. Aucun appel ne part sans votre mandat, donné en un clic, et un lien de paiement peut être envoyé pendant l'appel.</p>`,
      },
    ],
    faq: [
      {
        q: "À partir de quand puis-je relancer ?",
        a: "Dès le lendemain de l'échéance. Pénalités et indemnité de 40 € sont dues de plein droit sans relance préalable — la relance sert surtout à obtenir le paiement vite et sans conflit.",
      },
      {
        q: "La relance téléphonique est-elle plus efficace que l'e-mail ?",
        a: "Un appel lève l'ambiguïté immédiatement et traite l'objection en direct — c'est pour cela que nodaq a fait du téléphone son canal de relance, toujours sous votre mandat.",
      },
    ],
    sources: [
      { href: "https://www.justice.fr/fiche/delais-paiement-entre-professionnels-penalites-retard", label: "Justice.fr — Délais de paiement entre professionnels et pénalités de retard" },
    ],
    freres: [
      { href: "/guides/delai-paiement-facture", label: "Les délais de paiement" },
      { href: "/relance-facture-impayee", label: "La relance dans nodaq" },
    ],
  },
  {
    slug: "guides/comment-faire-devis-batiment",
    type: "guide",
    datePub: "2026-08-24",
    title: "Comment faire un devis bâtiment : mentions obligatoires et méthode | nodaq",
    description:
      "Les mentions obligatoires d'un devis bâtiment (dont l'assurance décennale depuis 2014), la structure d'un bon devis et une méthode pour le produire vite — sans y passer la soirée.",
    h1: "Comment faire un devis bâtiment dans les règles — et vite.",
    reponse:
      "Un devis bâtiment engage : il doit identifier l'entreprise et le client, détailler chaque poste (désignation, quantité, prix unitaire, main-d'œuvre), afficher TVA et totaux, la durée de validité — et, pour les métiers de la construction, mentionner l'assurance professionnelle avec les coordonnées de l'assureur, obligatoire depuis la loi du 18 juin 2014. Le reste est une affaire de méthode et de rapidité : le premier devis rendu prend souvent le chantier.",
    sections: [
      {
        h2: "Les mentions qui doivent y figurer",
        html: `<ul>
          <li>Identité complète de l'entreprise (raison sociale, adresse, SIREN/SIRET) et du client.</li>
          <li>Date du devis et <strong>durée de validité</strong> de l'offre.</li>
          <li>Le détail par poste : désignation, quantité, prix unitaire HT, main-d'œuvre.</li>
          <li>Taux de TVA applicable(s), total HT et TTC.</li>
          <li>Conditions de paiement (acompte, échéances).</li>
          <li><strong>Assurance professionnelle</strong> : pour les activités de construction soumises à la décennale, le devis doit mentionner l'assurance souscrite, les coordonnées de l'assureur et la zone de couverture — obligation issue de la loi n° 2014-626 du 18 juin 2014.</li>
        </ul>`,
      },
      {
        h2: "La méthode : chiffrer depuis ses tarifs, pas de tête",
        html: `<p>Les devis les plus fiables partent d'un <strong>catalogue de tarifs</strong> entretenu — fournitures et main-d'œuvre — plutôt que d'un chiffrage de mémoire, variable d'un soir à l'autre. Un tarif se fixe une fois, se corrige quand les prix bougent, et chaque devis l'applique : le chiffrage devient cohérent d'un chantier à l'autre, et défendable devant le client.</p>`,
      },
      {
        h2: "La rapidité est un avantage commercial",
        html: `<p>Beaucoup de chantiers se gagnent à la vitesse de réponse : le client qui a trois artisans en visite signe souvent avec celui qui rend son devis le premier. C'est là que la dictée change le métier : décrire le chantier à voix haute en sortant de la visite, relire le soir, envoyer — au lieu d'y passer le week-end.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Avec nodaq, le devis se <a href="/devis-ia">dicte à la voix</a> et se chiffre depuis vos tarifs — jamais un prix inventé par l'IA. Vous relisez, corrigez, envoyez ; le client peut accepter en ligne, et le devis accepté devient un chantier suivi de bout en bout.</p>`,
      },
    ],
    faq: [
      {
        q: "Le devis est-il obligatoire dans le bâtiment ?",
        a: "Il est obligatoire dans de nombreux cas (notamment travaux et dépannage chez les particuliers au-delà de certains seuils) et toujours recommandé : signé, il vaut engagement contractuel sur le prix et le contenu.",
      },
      {
        q: "Que risque-t-on sans la mention d'assurance décennale ?",
        a: "L'obligation de mention est légale pour les activités concernées ; son absence expose à des sanctions et fragilise la confiance du client. Les coordonnées de l'assureur et la zone de couverture doivent figurer sur devis et factures.",
      },
    ],
    sources: [
      { href: "https://www.capeb.fr/actualites/nouvelle-mention-obligatoire-sur-les-devis-et-les-factures-l-assurance-professionnelle", label: "CAPEB — La mention obligatoire d'assurance professionnelle sur devis et factures" },
    ],
    freres: [
      { href: "/devis-ia", label: "Les devis à la voix dans nodaq" },
      { href: "/logiciel-batiment", label: "Le logiciel bâtiment" },
    ],
  },
  {
    slug: "guides/comment-calculer-marge-chantier",
    type: "guide",
    datePub: "2026-08-24",
    title: "Comment calculer la marge d'un chantier : méthode complète | nodaq",
    description:
      "Prix de vente, déboursé sec, coût horaire chargé, frais généraux : la méthode pour calculer la marge d'un chantier — et pourquoi il faut la suivre pendant, pas après.",
    h1: "Comment calculer la marge d'un chantier, sans se mentir.",
    reponse:
      "La marge d'un chantier, c'est le prix vendu moins tous les coûts : fournitures, main-d'œuvre au coût horaire chargé (salaire + charges, pas le salaire net), sous-traitance, et une quote-part de frais généraux. L'erreur classique est double : compter la main-d'œuvre au salaire net, et découvrir le résultat à la fin. La marge se calcule sur des chiffres réels, pendant le chantier.",
    sections: [
      {
        h2: "1. Partir du prix vendu hors taxes",
        html: `<p>La référence est le montant HT du devis accepté — pas le TTC, pas « ce qu'on pense facturer ». Les avenants signés s'y ajoutent ; les gestes commerciaux s'en déduisent.</p>`,
      },
      {
        h2: "2. Compter la main-d'œuvre au coût chargé",
        html: `<p>Une heure de salarié coûte le <strong>salaire brut plus les charges patronales</strong> — souvent 1,4 à 1,8 fois le net selon les situations — plus les temps improductifs (trajets, préparation). C'est ce <strong>coût horaire chargé</strong>, propre à chaque membre de l'équipe, qui doit valoriser les heures pointées sur le chantier. Le calculer une fois, puis pointer les heures : c'est la moitié de la vérité de votre marge.</p>`,
      },
      {
        h2: "3. Ajouter fournitures, sous-traitance et frais généraux",
        html: `<p>Les fournitures se rattachent au chantier à leur coût réel (factures fournisseurs, pas le prix « de tête »). La sous-traitance de même. Enfin, chaque chantier doit porter une <strong>quote-part de frais généraux</strong> — local, véhicules, assurances, logiciels — sinon l'entreprise « gagne » sur chaque chantier et perd à la fin de l'année.</p>`,
      },
      {
        h2: "4. Suivre pendant, pas après",
        html: `<p>Un chantier qui dérape se rattrape à mi-parcours — par un avenant, un resserrement du planning — jamais au bilan. D'où l'importance d'une marge <strong>réévaluée au fil des heures pointées</strong>, comparée à votre <strong>seuil de rentabilité</strong>, et honnête sur ce qu'elle ne sait pas encore : tant que tous les coûts ne sont pas enregistrés, c'est une estimation haute, et il faut la lire comme telle.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>nodaq applique exactement cette méthode : les <a href="/calcul-marge-chantier">heures pointées sont valorisées au coût horaire chargé de chaque membre</a>, l'estimation de marge se réévalue en continu et se compare à votre seuil de rentabilité — en vous disant précisément ce qui manque pour passer de l'estimation à la marge exacte. Jamais un chiffre inventé.</p>`,
      },
    ],
    faq: [
      {
        q: "Quelle est l'erreur la plus fréquente ?",
        a: "Compter la main-d'œuvre au salaire net plutôt qu'au coût chargé : l'écart fait paraître rentables des chantiers qui ne le sont pas.",
      },
      {
        q: "Marge brute ou marge nette ?",
        a: "La marge brute (prix vendu moins coûts directs du chantier) sert à piloter chantier par chantier ; la marge nette intègre les frais généraux et dit si l'entreprise gagne sa vie. Il faut les deux.",
      },
    ],
    sources: [],
    freres: [
      { href: "/calcul-marge-chantier", label: "La marge de chantier dans nodaq" },
      { href: "/guides/delai-paiement-facture", label: "Les délais de paiement" },
    ],
  },
];

const GUIDES_LOT2 = [
  {
    slug: "guides/calcul-prix-main-oeuvre",
    type: "guide",
    datePub: "2026-08-24",
    title: "Calculer son prix de main-d'œuvre : du coût chargé au taux horaire vendu | nodaq",
    description:
      "Salaire brut, charges patronales, temps improductifs, frais généraux : la méthode pour calculer un coût horaire chargé, puis fixer un taux horaire vendu qui protège votre marge.",
    h1: "Comment calculer son prix de main-d'œuvre, pas à pas.",
    reponse:
      "Le prix de main-d'œuvre se construit en deux temps : d'abord le coût horaire chargé (salaire brut + charges patronales, divisé par les heures réellement productives), puis le taux vendu, qui ajoute une quote-part de frais généraux et la marge. Vendre au coût chargé, c'est travailler gratuitement ; vendre au salaire net, c'est perdre de l'argent à chaque heure.",
    sections: [
      {
        h2: "1. Le coût horaire chargé",
        html: `<p>Partez du <strong>salaire brut annuel</strong>, ajoutez les <strong>charges patronales</strong>, puis divisez par les <strong>heures productives</strong> — pas les heures payées : congés, formation, trajets, préparation et temps d'atelier non facturables réduisent sensiblement le nombre d'heures réellement vendables dans l'année. C'est ce ratio qui surprend : le coût d'une heure productive est bien plus élevé que le salaire horaire.</p>`,
      },
      {
        h2: "2. La quote-part de frais généraux",
        html: `<p>Local, véhicules, carburant, assurances (dont la décennale), outillage, logiciels, comptable : ces coûts existent que vous vendiez ou non. Rapportez-les aux heures productives de l'équipe pour obtenir un montant par heure — il s'ajoute au coût chargé.</p>`,
      },
      {
        h2: "3. Le taux vendu : ajouter la marge",
        html: `<p>Le taux horaire vendu = coût chargé + quote-part de frais généraux + <strong>marge</strong>. La marge n'est pas du luxe : elle finance les imprévus, les investissements et votre rémunération de dirigeant. Un taux « aligné sur le voisin » sans ce calcul est un pari, pas un prix.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Dans nodaq, chaque membre de l'équipe a son <strong>coût horaire chargé</strong>, et les heures pointées sont valorisées à ce coût dans <a href="/calcul-marge-chantier">l'estimation de marge de chaque chantier</a> — vous voyez immédiatement si vos taux vendus tiennent la route sur le terrain.</p>`,
      },
    ],
    faq: [
      {
        q: "Quel écart entre salaire net et coût réel d'une heure ?",
        a: "Selon les charges et la part d'heures improductives, une heure productive coûte couramment du simple au double du salaire horaire net — d'où l'importance de faire le calcul pour votre entreprise plutôt que d'appliquer un ratio entendu ailleurs.",
      },
      {
        q: "Faut-il un taux différent par salarié ?",
        a: "Le coût chargé, oui — il varie avec chaque salaire. Le taux vendu peut rester unique ou varier par qualification : l'essentiel est que chacun couvre le coût réel de l'heure qu'il facture.",
      },
    ],
    sources: [],
    freres: [
      { href: "/guides/comment-calculer-marge-chantier", label: "Calculer la marge d'un chantier" },
      { href: "/guides/calcul-cout-chantier", label: "Calculer le coût d'un chantier" },
    ],
  },
  {
    slug: "guides/calcul-cout-chantier",
    type: "guide",
    datePub: "2026-08-24",
    title: "Calculer le coût d'un chantier : déboursé sec, frais, prix de vente | nodaq",
    description:
      "Déboursé sec (fournitures + main-d'œuvre), frais de chantier, frais généraux, marge : la méthode complète pour calculer le coût d'un chantier et en tirer un prix de vente.",
    h1: "Comment calculer le coût d'un chantier avant de le vendre.",
    reponse:
      "Le coût d'un chantier se construit par couches : le déboursé sec (fournitures au prix d'achat + main-d'œuvre au coût chargé), les frais de chantier (location de matériel, évacuation, déplacements), puis une quote-part de frais généraux. Le prix de vente ajoute la marge par-dessus. Chiffrer en dessous d'une de ces couches, c'est financer le chantier de son client.",
    sections: [
      {
        h2: "1. Le déboursé sec",
        html: `<p>C'est le cœur du chiffrage : les <strong>fournitures au prix d'achat réel</strong> (tarifs fournisseurs à jour, pas de mémoire) et les <strong>heures prévues × coût horaire chargé</strong> de ceux qui les feront (voir notre guide du <a href="/guides/calcul-prix-main-oeuvre">prix de main-d'œuvre</a>). Un déboursé sec honnête suppose des tarifs entretenus.</p>`,
      },
      {
        h2: "2. Les frais de chantier",
        html: `<p>Propres à ce chantier : location d'engins ou d'échafaudage, benne et évacuation, déplacements et péages, hébergement si le chantier est loin, consommables. Faciles à oublier au devis, impossibles à éviter sur le terrain.</p>`,
      },
      {
        h2: "3. Frais généraux et marge",
        html: `<p>Ajoutez la <strong>quote-part de frais généraux</strong> de l'entreprise, puis la <strong>marge</strong>. L'ordre importe : la marge se calcule sur un coût complet. Une « marge » posée sur le seul déboursé sec est en réalité déjà entamée par tout ce qui n'a pas été compté.</p>`,
      },
      {
        h2: "4. Après la vente : confronter le prévu au réel",
        html: `<p>Le chiffrage est une hypothèse ; le chantier est la réalité. Comparer les heures réellement pointées au prévu, chantier après chantier, est le meilleur outil pour chiffrer juste la fois suivante — c'est ainsi que les entreprises apprennent leurs vrais temps.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Le <a href="/devis-ia">devis se dicte</a> et se chiffre depuis vos tarifs entretenus au catalogue ; pendant le chantier, les heures pointées confrontent le prévu au réel dans <a href="/calcul-marge-chantier">l'estimation de marge</a> — vous savez si le chiffrage tient pendant qu'il est encore temps d'agir.</p>`,
      },
    ],
    faq: [
      {
        q: "Quelle est l'erreur de chiffrage la plus courante ?",
        a: "Sous-estimer les heures — par optimisme ou par méconnaissance de ses temps réels. Le pointage des heures par chantier est le seul remède durable : il transforme chaque chantier en donnée pour le suivant.",
      },
    ],
    sources: [],
    freres: [
      { href: "/guides/calcul-prix-main-oeuvre", label: "Le prix de main-d'œuvre" },
      { href: "/guides/comment-calculer-marge-chantier", label: "La marge d'un chantier" },
    ],
  },
  {
    slug: "guides/comment-suivre-tresorerie-tpe",
    type: "guide",
    datePub: "2026-08-24",
    title: "Comment suivre la trésorerie d'une TPE sans tableur ni comptable | nodaq",
    description:
      "Les trois horizons du suivi de trésorerie d'une TPE — aujourd'hui, les 8 prochaines semaines, l'année — et la méthode pour ne plus piloter de tête.",
    h1: "Comment suivre la trésorerie d'une TPE, simplement.",
    reponse:
      "La trésorerie d'une TPE se suit sur trois horizons : ce qu'il y a en banque aujourd'hui, ce qui va entrer et sortir dans les prochaines semaines (factures en attente, échéances fiscales, charges récurrentes), et la tendance de l'année. Le piège classique : confondre le solde en banque avec la santé de l'entreprise, alors que l'URSSAF et la TVA du mois prochain sont déjà engagées.",
    sections: [
      {
        h2: "1. Aujourd'hui : le solde ne dit pas tout",
        html: `<p>Un solde confortable peut cacher une TVA à reverser, des salaires à venir et un fournisseur à payer. Le bon réflexe est de lire le solde <strong>avec</strong> ce qui est déjà engagé — c'est la différence entre « ce que j'ai » et « ce qui est à moi ».</p>`,
      },
      {
        h2: "2. Les prochaines semaines : le prévisionnel",
        html: `<p>Un prévisionnel utile croise quatre flux : les <strong>factures clients en attente</strong> (au montant résiduel réel), les <strong>échéances fiscales et sociales</strong>, les <strong>charges récurrentes</strong> (loyer, salaires, assurances, abonnements) et le <strong>solde bancaire de départ</strong>. Sur 6 à 8 semaines, cela suffit à voir venir un creux — et à agir : accélérer une relance, décaler une dépense.</p>`,
      },
      {
        h2: "3. L'année : la tendance",
        html: `<p>Mois après mois, la question devient : l'activité génère-t-elle de la trésorerie ou en consomme-t-elle ? Un chiffre d'affaires en hausse avec une trésorerie en baisse signale presque toujours un problème de délais de paiement — voir notre guide des <a href="/guides/delai-paiement-facture">délais de paiement</a> — ou de marge.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Le <a href="/suivi-tresorerie-tpe">cockpit nodaq</a> assemble exactement ces flux : trésorerie disponible (compte bancaire connecté), factures en attente au résiduel réel, échéancier, charges récurrentes, et un <strong>prévisionnel à 8 semaines</strong> — honnête quand une donnée manque, plutôt qu'un zéro inventé.</p>`,
      },
    ],
    faq: [
      {
        q: "À quelle fréquence regarder sa trésorerie ?",
        a: "Un regard hebdomadaire sur le prévisionnel suffit à une TPE — à condition que les données (factures, encaissements, charges) soient à jour en continu, ce qui est précisément le travail de l'outil, pas du dirigeant.",
      },
    ],
    sources: [],
    freres: [
      { href: "/suivi-tresorerie-tpe", label: "La trésorerie dans nodaq" },
      { href: "/guides/delai-paiement-facture", label: "Les délais de paiement" },
    ],
  },
  {
    slug: "guides/comment-facturer-un-chantier",
    type: "guide",
    datePub: "2026-08-24",
    title: "Comment facturer un chantier : acompte, avancement, solde | nodaq",
    description:
      "Acompte à la commande, factures d'avancement, facture de solde : comment facturer un chantier pour protéger sa trésorerie, et les mentions à ne pas oublier.",
    h1: "Comment facturer un chantier sans étrangler sa trésorerie.",
    reponse:
      "Sur un chantier de plusieurs semaines, facturer une seule fois à la fin, c'est financer le chantier à la place du client. La bonne pratique : un acompte à la commande, des factures au fil de l'avancement pour les chantiers longs, et une facture de solde à la réception — chacune portant les mentions obligatoires et suivie jusqu'à son paiement.",
    sections: [
      {
        h2: "1. L'acompte à la commande",
        html: `<p>Il engage le client, finance les premières fournitures et teste sa capacité à payer. Prévu au devis (pourcentage et moment), il se facture dès l'acceptation — particulièrement indispensable quand les fournitures se commandent en amont, comme en menuiserie ou en chauffage.</p>`,
      },
      {
        h2: "2. Les factures d'avancement pour les chantiers longs",
        html: `<p>Au-delà de quelques semaines, découpez : une facture à chaque étape franchie (fin du gros œuvre, hors d'eau, fin d'un lot…). Le rythme se prévoit au devis pour que le client ne le découvre pas en cours de route. Chaque facture suit alors sa propre échéance — et se relance individuellement si besoin.</p>`,
      },
      {
        h2: "3. Le solde à la réception",
        html: `<p>La facture de solde clôt le chantier : elle reprend le marché, les avenants signés, et déduit acomptes et situations déjà réglés. C'est aussi le moment de vérité de la <a href="/guides/comment-calculer-marge-chantier">marge réelle</a> du chantier.</p>`,
      },
      {
        h2: "Les mentions, à chaque facture",
        html: `<p>Chaque facture — acompte compris — porte les mentions obligatoires : identités, numéro et date, détail, TVA, échéance, taux des pénalités de retard et indemnité forfaitaire de 40 € (voir notre guide des <a href="/guides/delai-paiement-facture">délais de paiement</a>), et la mention d'assurance professionnelle pour les activités concernées.</p>`,
      },
      {
        h2: "Comment nodaq vous aide",
        html: `<p>Dans nodaq, un devis accepté devient un chantier, et <a href="/facturation-tpe">chaque facture s'émet depuis l'affaire</a> — acompte, avancement, solde — avec une numérotation propre, un PDF archivé, et un suivi jusqu'à l'encaissement, relance comprise. Les heures pointées facturables peuvent alimenter la facture.</p>`,
      },
    ],
    faq: [
      {
        q: "Quel pourcentage d'acompte demander ?",
        a: "Il n'y a pas de règle unique : l'usage varie selon le métier et le poids des fournitures. L'essentiel est de le prévoir clairement au devis, et de le facturer réellement à l'acceptation.",
      },
    ],
    sources: [],
    freres: [
      { href: "/facturation-tpe", label: "La facturation dans nodaq" },
      { href: "/guides/delai-paiement-facture", label: "Les délais de paiement" },
    ],
  },
  {
    slug: "guides/logiciel-gestion-artisan",
    type: "guide",
    datePub: "2026-08-24",
    title: "Choisir un logiciel de gestion artisan : les 7 critères qui comptent | nodaq",
    description:
      "Rapidité du devis, suivi des paiements, marge par chantier, validation humaine, hébergement des données : les critères pour choisir un logiciel de gestion quand on est artisan.",
    h1: "Comment choisir un logiciel de gestion quand on est artisan.",
    reponse:
      "Le bon logiciel de gestion d'artisan se juge sur le terrain, pas en démo : la vitesse à produire un devis, le suivi réel des paiements et des relances, la marge par chantier, la place laissée à votre décision, et où vivent vos données. Voici les sept critères à vérifier — quel que soit l'outil que vous choisirez.",
    sections: [
      {
        h2: "Les 7 critères",
        html: `<ol style="padding-left:20px;display:grid;gap:8px">
          <li><strong>Le temps du devis</strong> — combien de minutes entre la visite et l'envoi ? C'est le critère nº 1 : le premier devis rendu prend souvent le chantier.</li>
          <li><strong>Le suivi jusqu'au paiement</strong> — l'outil sait-il ce qui est payé, en retard, à relancer ? Une facturation sans suivi d'encaissement ne protège pas la trésorerie.</li>
          <li><strong>La marge par chantier</strong> — pendant le chantier, pas au bilan. Et honnête : un outil qui affiche une marge « exacte » sans connaître vos coûts vous ment.</li>
          <li><strong>Votre décision au centre</strong> — qui appuie sur « envoyer » ? Un envoi automatique à un client est une relation client déléguée à une machine.</li>
          <li><strong>La saisie sur le terrain</strong> — voix, photo, mobile : la gestion d'artisan se fait dans les creux, pas au bureau.</li>
          <li><strong>Les données</strong> — où sont-elles hébergées, pouvez-vous les récupérer, qui y accède ?</li>
          <li><strong>Le prix complet</strong> — abonnement, coût par salarié, modules cachés, engagement.</li>
        </ol>`,
      },
      {
        h2: "Le piège des fonctionnalités",
        html: `<p>Une liste de fonctionnalités ne dit rien de l'usage réel. La bonne question n'est pas « que sait faire l'outil ? » mais « que ferai-je encore dans trois mois ? ». Un outil utilisé à 20 % qui fait gagner ses soirées bat un outil complet abandonné en janvier.</p>`,
      },
      {
        h2: "Où se situe nodaq",
        html: `<p>nodaq est construit sur ces critères : <a href="/devis-ia">devis dictés</a> en sortant de la visite, <a href="/facturation-tpe">factures suivies jusqu'au paiement</a> avec <a href="/relance-facture-impayee">campagnes de relance sur mandat</a>, <a href="/calcul-marge-chantier">marge honnête</a> réévaluée à chaque heure pointée, validation humaine sur chaque envoi, données hébergées en France — à partir de 29 € HT/mois pour les 50 premiers inscrits (49 € ensuite, voir <a href="/tarifs">les tarifs</a>). À vous de le confronter aux mêmes sept questions que les autres.</p>`,
      },
    ],
    faq: [
      {
        q: "Faut-il un logiciel spécialisé bâtiment ?",
        a: "L'important n'est pas l'étiquette mais l'adéquation aux gestes du métier : devis rapides, suivi par chantier, saisie sur le terrain. Vérifiez ces usages précis plutôt que la catégorie marketing de l'outil.",
      },
    ],
    sources: [],
    freres: [
      { href: "/logiciel-artisan", label: "nodaq pour les artisans" },
      { href: "/logiciel-batiment", label: "Le logiciel bâtiment" },
    ],
  },
];

PAGES.push(...GUIDES, ...GUIDES_LOT2);

// ── Page tarifs — la grille officielle (décision fondateur, août 2026) ─────
// Les prix affichés ici sont la COPIE marketing de la grille seedée par la
// migration 065 (lib/db/migrations/065_tarification.sql), seule source côté
// produit. Toute évolution de la grille met à jour LES DEUX, dans le même lot.
const carteTarif = (nom, prix, sous, traits, misEnAvant) => `
<div style="flex:1;min-width:230px;background:var(--panel);border:1px solid ${misEnAvant ? "rgba(163,230,53,.55)" : "var(--hair)"};border-radius:12px;padding:22px">
  ${misEnAvant ? `<div style="font-family:'JetBrains Mono',monospace;font-size:.72rem;color:var(--lime);margin-bottom:6px">RÉSERVÉE AUX 50 PREMIERS</div>` : ""}
  <div style="font-weight:700;color:var(--text)">${nom}</div>
  <div style="font-size:1.7rem;font-weight:700;color:var(--text);margin:6px 0 2px">${prix}&nbsp;€ <span style="font-size:.85rem;font-weight:400;color:var(--muted)">HT/mois</span></div>
  <div style="font-size:.82rem;color:var(--muted);margin-bottom:12px">${sous}</div>
  <ul style="padding-left:18px;display:grid;gap:6px;font-size:.88rem">
    ${traits.map((t) => `<li>${t}</li>`).join("\n    ")}
  </ul>
</div>`;

PAGES.push({
  slug: "tarifs",
  title: "Tarifs nodaq — Fondateurs 29 €, Solo 49 €, Équipe 89 € HT/mois",
  description:
    "Les formules nodaq : Fondateurs à 29 € HT/mois garanti à vie (50 places), Solo à 49 €, Équipe à 89 € avec 5 utilisateurs inclus. Module relance vocale en option, annuel deux mois offerts, essai 14 jours sans carte.",
  h1: "Des tarifs simples, sans surprise.",
  reponse:
    "Trois formules, tous les prix en HT, sans engagement caché : Solo à 49 € par mois pour le dirigeant seul, Équipe à 89 € pour jusqu'à 5 utilisateurs, et l'offre Fondateurs à 29 € par mois, garantie à vie, réservée aux 50 premiers inscrits. L'essai dure 14 jours, toutes fonctionnalités, sans carte bancaire.",
  sections: [
    {
      h2: "Les trois formules",
      html: `<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:6px">
${carteTarif("Fondateurs", "29", "Garanti à vie tant que vous restez abonné", [
    "<strong>Tout le contenu d'Équipe</strong>, utilisateurs compris",
    "Prix bloqué pour toujours — c'est écrit, et daté",
    "Réservée aux 50 premiers inscrits",
  ], true)}
${carteTarif("Solo", "49", "Le dirigeant, seul aux commandes", [
    "1 utilisateur",
    "Devis, factures et avoirs (PDF + Factur-X), chantiers, cockpit complet",
    "Dictée et lecture de documents, bibliothèque de prix",
    "Relances par e-mail illimitées, WhatsApp en usage normal, lien de paiement",
    "Une demi-heure de main-d'œuvre facturée par mois — c'est le coût réel",
  ], false)}
${carteTarif("Équipe", "89", "L'entreprise qui tourne à plusieurs", [
    "Tout Solo, jusqu'à <strong>5 utilisateurs inclus</strong>",
    "puis 15 € HT/mois par utilisateur supplémentaire",
    "Marge par chantier — aussi pour qui travaille seul",
    "Heures et plannings, accès dédié pour votre comptable",
  ], false)}
</div>`,
    },
    {
      h2: "Le module Relance vocale, en option",
      html: `<p>Sur n'importe quelle formule : <strong>+19 € HT/mois</strong>, avec <strong>10 dossiers de relance inclus</strong> chaque mois, puis 2 € HT par dossier supplémentaire. <strong>Un dossier, c'est un impayé relancé dans le mois</strong> — quel que soit le nombre d'appels : trois rappels au même client ne comptent qu'une fois. Le compteur est visible dans vos réglages, une alerte prévient à 80 % — et <strong>rien ne se coupe en plein mois</strong> : au-delà de 10, les dossiers sont comptés, jamais bloqués. Le module reste désactivé tant que vous ne l'activez pas ; chaque campagne d'appels part sur <a href="/relance-facture-impayee">votre mandat explicite</a>.</p>`,
    },
    {
      h2: "L'annuel : deux mois offerts",
      html: `<p>En réglant à l'année : Solo à <strong>490 € HT</strong>, Équipe à <strong>890 € HT</strong>, module vocal à <strong>190 € HT</strong> — soit dix mois payés sur douze.</p>`,
    },
    {
      h2: "L'essai, et ce qui se passe après",
      html: `<p><strong>14 jours d'essai</strong>, toutes fonctionnalités (aux limites d'Équipe), sans carte bancaire. À l'échéance, si vous ne souscrivez pas, votre espace passe en <strong>lecture seule</strong> : tout reste consultable, <strong>aucune donnée n'est supprimée</strong>, et vous reprenez la main le jour où vous choisissez une formule.</p>`,
    },
  ],
  faq: [
    {
      q: "Le prix Fondateurs est-il vraiment garanti à vie ?",
      a: "Oui : tant que votre abonnement reste actif, le prix ne change jamais — l'engagement est daté dans votre compte. Il est réservé aux 50 premiers inscrits ; une fois les places prises, l'offre ferme.",
    },
    {
      q: "Que deviennent mes données si j'arrête à la fin de l'essai ?",
      a: "Rien n'est supprimé : l'espace passe en lecture seule et tout reste consultable. Vous reprenez la main en choisissant une formule, quand vous voulez.",
    },
    {
      q: "Y a-t-il des frais cachés ou une offre gratuite limitée ?",
      a: "Non. Les prix sont en HT, affichés en entier ici : la seule gratuité est l'essai de 14 jours, et les seuls suppléments sont l'utilisateur au-delà de 5 (15 € HT/mois, en Équipe comme en Fondateurs) et le dossier de relance vocale au-delà de 10 (2 € HT).",
    },
  ],
  freres: [
    { href: "/logiciel-gestion-tpe", label: "Ce que contient nodaq" },
    { href: "/relance-facture-impayee", label: "La relance d'impayés" },
  ],
});

for (const p of PAGES) {
  const sortie = path.join(ici, `${p.slug}.html`);
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, rendre(p));
  console.log(`${p.slug}.html généré${EN_VALIDATION ? " (noindex — validation)" : ""}`);
}
