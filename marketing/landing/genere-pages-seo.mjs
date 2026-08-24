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
const EN_VALIDATION = true;
const MAJ = "2026-08-24";

const PAGES = [
  {
    slug: "logiciel-batiment",
    title: "Logiciel de gestion bâtiment pour TPE — devis, marge, impayés | nodaq",
    description:
      "nodaq est le copilote de gestion des TPE du bâtiment : devis dictés à la voix, marge par chantier en temps réel, relances d'impayés validées en un clic.",
    h1: "Le logiciel de gestion pensé pour les artisans du bâtiment.",
    reponse:
      "nodaq est un copilote de gestion pour les TPE du bâtiment : vous dictez vos devis, photographiez vos factures, et validez ce que nodaq prépare — marge par chantier en temps réel, trésorerie lisible, relances d'impayés envoyées avec votre accord. Données hébergées en France. Programme fondateurs ouvert le 1er octobre 2026.",
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
          <li><strong>Marge par chantier</strong> — recalculée en temps réel dès qu'une facture ou une heure est enregistrée : vous savez si un chantier est rentable avant qu'il soit trop tard.</li>
          <li><strong>Trésorerie et échéancier</strong> — le cockpit montre ce qui rentre, ce qui sort et ce qui arrive à échéance.</li>
          <li><strong>Relances d'impayés</strong> — préparées automatiquement, envoyées après votre validation. <a href="/relance-facture-impayee">Voir le détail</a>.</li>
          <li><strong>Lecture automatique de factures</strong> — photographiez, nodaq extrait et classe.</li>
        </ul>`,
      },
      {
        h2: "Exemple concret (scénario illustratif)",
        html: `<p>Fin de journée, un artisan termine une salle de bains. Dans le fourgon, il dicte le devis du chantier suivant : nodaq le met en forme avec ses tarifs, il le relit et l'envoie avant de rentrer. Le cockpit lui montre que la marge du chantier en cours a baissé — une facture fournisseur photographiée le matin vient d'être comptée. Une relance est prête pour une facture arrivée à échéance : un clic, elle part. La soirée reste la sienne.</p>`,
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
      "nodaq surveille vos échéances, prépare les relances d'impayés et ne les envoie qu'après votre validation en un clic. En France, une facture est payée à 44 jours en moyenne.",
    h1: "Relancez vos impayés — préparé automatiquement, envoyé avec votre accord.",
    reponse:
      "Relancer un client est désagréable, alors on repousse — et l'impayé s'installe. nodaq surveille vos échéances, prépare la relance au bon moment et vous la présente : un clic pour l'envoyer, ou pour la retenir. Rien ne part jamais dans votre dos. En France, une facture est payée à 44 jours en moyenne, pour 36 jours convenus.",
    sections: [
      {
        h2: "Comment ça fonctionne ?",
        html: `<p>Chaque facture émise entre dans l'échéancier. À l'approche de l'échéance, nodaq vous prévient ; passée l'échéance, il <strong>prépare</strong> la relance — courtoise, factuelle, avec les bonnes références. Elle apparaît dans vos actions à valider : <strong>un clic pour envoyer, un clic pour écarter</strong>. La relation client reste votre décision.</p>`,
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
        html: `<p>Une facture de 4 800 € arrive à échéance un vendredi. Le lundi, nodaq présente une relance prête : rappel de la facture, de l'échéance, coordonnées de paiement. La dirigeante sait que ce client est fiable mais distrait — elle valide. Le paiement arrive le jeudi. Sans nodaq, la relance serait partie « quand j'aurai le temps » : trois semaines plus tard.</p>`,
      },
    ],
    faq: [
      {
        q: "Les relances partent-elles automatiquement ?",
        a: "Non. nodaq les prépare et vous les présente ; chaque relance n'est envoyée qu'après votre validation en un clic. Vous pouvez aussi l'écarter.",
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
${EN_VALIDATION ? '<meta name="robots" content="noindex">\n' : ""}<meta property="og:type" content="website">
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
