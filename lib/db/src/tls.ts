/**
 * Le chiffrement de la connexion à la base — tenu par le CODE.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNE PROPRIÉTÉ DE SÉCURITÉ NE DOIT PAS DÉPENDRE DE CE QU'ON A TAPÉ       ║
 * ║  DANS UNE CHAÎNE DE CONNEXION.                                           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── CE QUI A ÉTÉ MESURÉ LE 29/08/2026 ───────────────────────────────────────
 * Le serveur de production accepte les connexions EN CLAIR. Constaté sans
 * aucun identifiant réel, la négociation TLS ayant lieu avant
 * l'authentification :
 *
 *     sslmode=disable   → « password authentication failed »   (le clair passe)
 *     sslmode=no-verify → « password authentication failed »
 *
 * S'il refusait le clair, il aurait coupé avant, sur « no pg_hba.conf entry …
 * SSL off ». Rien ne forçait donc l'application à chiffrer, et rien dans
 * l'image ne le lui permettait : aucune CA n'y figurait, et `sslmode=require`
 * échoue sur cette instance (voir plus bas). Le trafic — sessions, données
 * clients, IBAN — traversait vraisemblablement l'internet public en clair,
 * vers une base joignable depuis n'importe quelle adresse.
 *
 * Ce module rend la question sans objet : le TLS ne dépend plus du contenu
 * d'un secret, mais d'une configuration explicite que l'application VÉRIFIE.
 *
 * ── DEUX PIÈGES, MESURÉS L'UN APRÈS L'AUTRE ─────────────────────────────────
 *
 * 1. `sslmode=require` NE SUFFIT PAS. `pg-connection-string` le traite comme
 *    `verify-full`, qui exige une autorité de certification de confiance.
 *    Scaleway signe avec la CA de l'instance : sans elle, « self-signed
 *    certificate ».
 *
 * 2. NE PAS SE CONNECTER PAR ADRESSE IP. `pg` n'envoie de `servername` TLS que
 *    si l'hôte n'est PAS une IP — la norme SNI interdit les adresses. Avec une
 *    IP, Node retombe sur son défaut `localhost` et le compare au certificat :
 *    « Host: localhost is not in the cert's altnames ». D'où le refus explicite
 *    plutôt qu'un échec obscur au premier client.
 *
 *    Scaleway ne publiant aucun nom DNS dans son API, une chaîne fabriquée
 *    depuis la console porte l'adresse. `DATABASE_SSL_SERVERNAME` donne alors
 *    le nom à vérifier sans qu'on ait à retaper le secret.
 */

/** Ce que `pg` attend dans son champ `ssl`. */
export interface OptionsTls {
  readonly ca: string;
  readonly rejectUnauthorized: true;
  /** Forcé : sans lui, Node compare le certificat à « localhost ». */
  readonly servername: string;
}

export class DbTlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbTlsError";
  }
}

/** Vrai pour « 195.154.197.204 » ou « ::1 », faux pour un nom DNS. */
function estAdresseIp(hote: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hote) || hote.includes(":");
}

/** L'hôte d'une chaîne de connexion, sans jamais exposer le reste. */
export function hoteDe(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname || null;
  } catch {
    return null;
  }
}

/**
 * La configuration TLS à donner au pool — ou `undefined` quand il n'y en a
 * légitimement pas.
 *
 * ── LA RÈGLE ───────────────────────────────────────────────────────────────
 * `DATABASE_CA_PEM` présente  → TLS vérifié, sans condition.
 * Absente ET production       → l'application REFUSE DE DÉMARRER.
 * Absente hors production     → pas de TLS : le Postgres local et celui de la
 *                               CI n'en ont pas, et les tests doivent tourner.
 *
 * Le refus au démarrage est la même doctrine que celle des modèles (règle 2 du
 * dépôt : aucune valeur par défaut, une variable manquante lève). Elle est plus
 * dure ici — une variable oubliée fait tomber l'application au lieu de la
 * dégrader. C'est le but : une base qui repart en clair par omission ne se
 * remarque JAMAIS. Tomber est bruyant ; fuir ne l'est pas.
 *
 * Le certificat n'est PAS un secret : c'est la clé publique d'une autorité.
 * Il se pose en variable d'environnement ordinaire, et se relit avec
 * `scw rdb instance get-certificate <instance-id>`.
 */
export function optionsTls(
  connectionString: string,
  env: NodeJS.ProcessEnv = process.env,
): OptionsTls | undefined {
  const ca = env["DATABASE_CA_PEM"]?.trim();
  const production = env["NODE_ENV"] === "production";

  if (!ca) {
    if (!production) return undefined;
    throw new DbTlsError(
      "DATABASE_CA_PEM est absente et NODE_ENV=production : l'application " +
        "refuse de se connecter à la base EN CLAIR. Récupérez le certificat de " +
        "l'instance (`scw rdb instance get-certificate <instance-id>`) et posez " +
        "son contenu dans DATABASE_CA_PEM. Ce n'est pas un secret : c'est une " +
        "clé publique.",
    );
  }

  if (!ca.includes("BEGIN CERTIFICATE")) {
    throw new DbTlsError(
      "DATABASE_CA_PEM ne ressemble pas à un certificat PEM (« BEGIN " +
        "CERTIFICATE » introuvable). Un contenu tronqué produirait un échec " +
        "TLS obscur au premier client : on refuse tout de suite.",
    );
  }

  const hote = hoteDe(connectionString);
  if (!hote) {
    throw new DbTlsError(
      "Impossible de lire l'hôte de la chaîne de connexion : le TLS ne peut " +
        "pas être vérifié sans savoir à qui l'on parle.",
    );
  }

  /*
   * ── QUAND LA CHAÎNE VISE UNE IP ──────────────────────────────────────────
   * Scaleway ne publie PAS de nom DNS dans son API : une chaîne de connexion
   * fabriquée depuis la console porte donc l'adresse. Exiger de la réécrire
   * obligerait à retaper un secret — et un secret qu'on retape est un secret
   * qu'on finit par coller au mauvais endroit.
   *
   * `DATABASE_SSL_SERVERNAME` fournit alors le nom à VÉRIFIER, sans toucher
   * au secret. Ce n'est pas un contournement : on se connecte à l'adresse,
   * et on exige que le serveur présente un certificat valide pour ce NOM.
   * Un imposteur qui répondrait à cette IP ne pourrait pas le produire.
   */
  const nomVerification = env["DATABASE_SSL_SERVERNAME"]?.trim();
  if (nomVerification && estAdresseIp(nomVerification)) {
    throw new DbTlsError(
      `DATABASE_SSL_SERVERNAME vaut une adresse IP (${nomVerification}). ` +
        "SNI interdit les adresses : il faut un nom DNS.",
    );
  }

  if (estAdresseIp(hote) && !nomVerification) {
    throw new DbTlsError(
      `La chaîne de connexion vise une ADRESSE IP (${hote}). La vérification ` +
        "TLS échouerait : SNI interdit les adresses, et Node comparerait alors " +
        "le certificat à « localhost ». Deux sorties : viser le NOM DNS de " +
        "l'instance dans la chaîne, ou le poser dans DATABASE_SSL_SERVERNAME " +
        "sans toucher au secret. Il figure dans les SAN du certificat.",
    );
  }

  return { ca, rejectUnauthorized: true, servername: nomVerification ?? hote };
}
