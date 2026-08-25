// Vérification mobile de la landing (ticket 4.44) — le test automatisé du
// scroll horizontal, exécutable en local avant tout déploiement :
//
//   1. générer les pages :   node genere-variantes.mjs && node genere-pages-seo.mjs
//   2. servir le dossier :   python3 -m http.server 8777
//   3. lancer :              CHROMIUM=<chemin chrome> node verifie-mobile.mjs
//
// Échoue (code 1) si une page présente un scroll horizontal sur l'un des
// viewports du ticket : 360×800 (Android d'entrée de gamme — le cas
// nominal), 390×844, 414×896. La landing n'étant pas construite par la CI,
// ce script est la porte à passer À LA MAIN avant chaque déploiement —
// comme la validation locale du contenu.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:8777";
const VIEWPORTS = [
  { w: 360, h: 800 },
  { w: 390, h: 844 },
  { w: 414, h: 896 },
];
const PAGES = [
  "index.html",
  "tarifs.html",
  "logiciel-batiment.html",
  "metiers/plombier.html",
  "guides/delai-paiement-facture.html",
  "mentions-legales.html",
  "cgv.html",
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
});
let echecs = 0;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
  for (const chemin of PAGES) {
    await page.goto(`${BASE}/${chemin}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    const deborde = m.scrollWidth > m.innerWidth;
    if (deborde) echecs++;
    console.log(
      `${deborde ? "✗ DÉBORDE" : "✓"} ${vp.w}x${vp.h} ${chemin} ` +
        `scrollWidth=${m.scrollWidth}/${m.innerWidth}`,
    );
  }
  await page.close();
}
await browser.close();

if (echecs > 0) {
  console.error(`\n${echecs} cas de scroll horizontal — corriger la CAUSE (layout), pas au cas par cas.`);
  process.exit(1);
}
console.log("\nAucun scroll horizontal sur les trois viewports.");
