// Génère les variantes de campagne (brief §8) à partir d'index.html.
// Usage : node genere-variantes.mjs  (depuis marketing/landing/)
//
// Une variante ne change QUE : <title>, og:title, <h1>, le sous-titre du
// hero, et l'ordre de la section S.03 (le bloc correspondant à la requête
// remonte en tête). Toute la copy vient d'index.html — rien d'inventé :
// le H1 est le label du problème, le sous-titre est la « réponse nodaq »
// du bloc. Le canonical reste https://nodaq.fr/ (les variantes sont hors
// sitemap et ne doivent pas être traitées comme du contenu dupliqué).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ici = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(ici, "index.html"), "utf8");

const VARIANTES = [
  {
    fichier: "devis.html",
    titre: "NODAQ — Faire ses devis plus vite",
    label: "Le temps volé le soir",
    grad: "volé le soir",
    sous: "nodaq transforme votre voix en devis prêt à envoyer. La soirée redevient la vôtre.",
  },
  {
    fichier: "impayes.html",
    titre: "NODAQ — Relancer ses factures impayées",
    label: "Ce qui file entre les doigts",
    grad: "file entre les doigts",
    sous: "nodaq relance vos impayés et vous prévient de vos échéances avant qu’elles ne deviennent un problème.",
  },
  {
    fichier: "marge.html",
    titre: "NODAQ — Savoir si un chantier est rentable",
    label: "La marge qu’on découvre trop tard",
    grad: "découvre trop tard",
    sous: "nodaq calcule la marge de chaque mission en temps réel, dès qu’une facture ou une heure est enregistrée.",
  },
];

for (const v of VARIANTES) {
  let h = src;

  // <title> et og:title — le canonical et og:url restent https://nodaq.fr/.
  h = h.replace(/<title>[^<]*<\/title>/, `<title>${v.titre}.</title>`);
  h = h.replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${v.titre}.$2`);

  // H1 : label du problème, dégradé d'alerte sur la partie douloureuse.
  const h1 = v.label.replace(v.grad, `<span class="grad-alert">${v.grad}</span>`) + ".";
  h = h.replace(
    /(<h1 class="reveal"[^>]*>)[\s\S]*?(<\/h1>)/,
    `$1\n      ${h1}\n    $2`
  );

  // Sous-titre du hero : la « réponse nodaq » du bloc correspondant.
  h = h.replace(
    /(<p class="hero__sub reveal" style="--d:0\.1s">)[\s\S]*?(<\/p>)/,
    `$1\n      ${v.sous}\n    $2`
  );

  // S.03 : remonter le bloc correspondant en tête, délais de reveal réassignés.
  const articles = h.match(/<article class="card problem[\s\S]*?<\/article>/g);
  if (!articles || articles.length !== 3) {
    throw new Error(`${v.fichier} : ${articles ? articles.length : 0} blocs problème trouvés (3 attendus)`);
  }
  const premier = articles.find((a) => a.includes(v.label));
  if (!premier) throw new Error(`${v.fichier} : bloc « ${v.label} » introuvable`);
  const ordonnes = [premier, ...articles.filter((a) => a !== premier)];
  const delais = ["", ' style="--d:0.06s"', ' style="--d:0.12s"'];
  const normalises = ordonnes.map((a, i) =>
    a.replace(/<article class="card problem reveal"[^>]*>/, `<article class="card problem reveal"${delais[i]}>`)
  );
  let k = 0;
  h = h.replace(/<article class="card problem[\s\S]*?<\/article>/g, () => normalises[k++]);

  fs.writeFileSync(path.join(ici, v.fichier), h);
  console.log(v.fichier, "généré —", v.titre);
}
