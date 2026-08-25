// Relais d'inscription — fonction Vercel servie sur nodaq.fr/api/inscription.
//
// Pourquoi un relais : le POST direct du navigateur vers FormSubmit échouait
// pour les visiteurs dont le navigateur (ou une extension de vie privée)
// supprime l'en-tête Referer — FormSubmit répond alors success:"false"
// (« open this page through a web server »), constaté en réel par le
// fondateur le 25/08/2026. Ici, la requête du visiteur est same-origin
// (aucun en-tête requis de son côté) et c'est CE serveur qui parle à
// FormSubmit avec un Referer maîtrisé. node:https plutôt que fetch : le
// fetch du runtime peut réécrire ou supprimer Origin/Referer, et FormSubmit
// refuse alors la soumission — https.request envoie les en-têtes tels quels.
//
// Limite connue : Cloudflare, devant FormSubmit, conteste parfois les
// requêtes venues d'IP de datacenter (réponse 403 « Just a moment... »).
// D'où : UA réaliste, deux réessais espacés, et côté page le chemin DIRECT
// navigateur→FormSubmit reste tenté en premier — ce relais n'est que le
// secours. La sortie durable est un fournisseur pensé pour les appels
// serveur (clé Web3Forms demandée au fondateur).
//
// Aucune journalisation du contenu (email, verbatim) — règle du dépôt.

const https = require("node:https");

const DESTINATAIRE = "moussatoure.mt.87@gmail.com";
const ORIGINE = "https://nodaq.fr";

function posteFormSubmit(charge) {
  const corps = JSON.stringify(charge);
  return new Promise((resolve) => {
    const requete = https.request(
      {
        hostname: "formsubmit.co",
        path: `/ajax/${DESTINATAIRE}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(corps),
          Accept: "application/json",
          Origin: ORIGINE,
          Referer: `${ORIGINE}/`,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
        timeout: 10000,
      },
      (rep) => {
        let texte = "";
        rep.on("data", (morceau) => (texte += morceau));
        rep.on("end", () => resolve({ statut: rep.statusCode, texte }));
      },
    );
    requete.on("timeout", () => requete.destroy(new Error("timeout")));
    requete.on("error", () => resolve({ statut: 0, texte: "" }));
    requete.write(corps);
    requete.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false, message: "Méthode non autorisée." });
    return;
  }

  const corps = req.body && typeof req.body === "object" ? req.body : {};
  const email = typeof corps.email === "string" ? corps.email.trim() : "";
  const irritant = typeof corps.irritant === "string" ? corps.irritant.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    res.status(400).json({ success: false, message: "Adresse email invalide." });
    return;
  }

  // Champs relayés en liste blanche — rien d'autre ne passe.
  const charge = {
    email,
    _subject: irritant
      ? "NODAQ — verbatim d'un inscrit (irritant)"
      : "NODAQ — nouvelle inscription à la liste d'attente",
    _template: "table",
    _captcha: "false",
  };
  if (irritant) charge.irritant = irritant.slice(0, 2000);

  // Jusqu'à trois tentatives : le défi Cloudflare est parfois intermittent.
  let relais = { statut: 0, texte: "" };
  let ok = false;
  for (let essai = 0; essai < 3 && !ok; essai++) {
    if (essai > 0) await new Promise((r) => setTimeout(r, 700 * essai));
    relais = await posteFormSubmit(charge);
    let json = {};
    try { json = JSON.parse(relais.texte); } catch {}
    ok = relais.statut === 200 && (json.success === true || json.success === "true");
  }
  if (!ok) {
    // Diagnostic sans contenu : statut amont + début de sa réponse (jamais
    // l'email ni le verbatim — ils ne figurent pas dans la réponse amont).
    res.status(502).json({
      success: false,
      message: "Le relais a refusé l'envoi.",
      diag: { amont: relais.statut, corps: String(relais.texte).slice(0, 200) },
    });
    return;
  }
  res.status(200).json({ success: true });
};
