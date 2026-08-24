/*
 * Aucune zone de texte libre oubliée en secteur santé — US-B9.4.
 *
 * ── Ce que cette garde protège, et pourquoi elle est indispensable ────────
 * La story exige que la limite soit « imposée par la STRUCTURE même des champs
 * disponibles plutôt que par un simple principe d'usage ». Une liste de champs
 * bloqués écrite à la main est un principe d'usage : elle tient jusqu'à la
 * prochaine colonne `notes` ajoutée sans y penser.
 *
 * Cette garde lit le SCHÉMA. Toute colonne de texte libre y est soit bloquée,
 * soit exemptée avec un motif écrit. Une troisième voie n'existe pas.
 *
 * ── Le mode de défaillance, dit franchement ───────────────────────────────
 * Contrairement à `ECRANS_TIERS_LECTURE`, où l'oubli FERME l'accès, l'oubli
 * ouvre ici une zone de saisie. C'est exactement pour ça que la garde existe :
 * sans elle, le défaut serait silencieux et se découvrirait en contrôle.
 */
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ZONES_LIBRES_PATIENT, EXEMPTIONS_TEXTE_LIBRE, estSecteurSante,
  texteLibreInterdit, MESSAGE_ORIENTATION_HDS,
} from "@nodaq/shared";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../lib/db/src/schema");

/** Toutes les colonnes `text("…")` du schéma, avec leur table. */
function colonnesTexte(): { table: string; champ: string }[] {
  const out: { table: string; champ: string }[] = [];
  for (const f of readdirSync(schemaDir).filter((n) => n.endsWith(".ts") && n !== "index.ts")) {
    const table = f.replace(/\.ts$/, "");
    for (const ligne of readFileSync(join(schemaDir, f), "utf8").split("\n")) {
      // Les colonnes visées sont celles où l'on écrit en prose. Un `text()`
      // qui porte un identifiant, un statut ou une référence n'est pas une
      // zone de saisie libre — les nommer ici les rendrait indistinguables.
      const m = ligne.match(/^\s*(\w+):\s*text\("(notes|commentaire|description)"\)/);
      if (m) out.push({ table, champ: m[2]! });
    }
  }
  return out;
}

const bloques = new Set(
  ZONES_LIBRES_PATIENT.flatMap((z) => z.champs.map((c) => `${z.chemin.slice(1)}:${c}`)),
);
const exemptes = new Set(EXEMPTIONS_TEXTE_LIBRE.map((e) => `${e.table}:${e.champ}`));

describe("toute zone de prose du schéma est tranchée", () => {
  test("la garde LIT vraiment le schéma", () => {
    // Sans ce test, une expression régulière cassée ferait passer les deux
    // suivants sur une liste VIDE — verts, et ne protégeant plus rien. Le
    // dépôt a déjà payé ce défaut : sept tests de sécurité muets pendant des
    // semaines derrière un `if (!process.env.X) return;`.
    const trouvees = colonnesTexte();
    expect(trouvees.length).toBeGreaterThanOrEqual(10);
    expect(trouvees.map((c) => `${c.table}.${c.champ}`)).toContain("clients.notes");
    expect(trouvees.map((c) => `${c.table}.${c.champ}`)).toContain("pointages.commentaire");
  });

  test("aucune colonne n'est ni bloquée ni exemptée", () => {
    const orphelines = colonnesTexte().filter(
      ({ table, champ }) => !bloques.has(`${table}:${champ}`) && !exemptes.has(`${table}:${champ}`),
    );
    expect(
      orphelines.map((o) => `${o.table}.${o.champ}`),
      "Une colonne de prose doit être soit bloquée en santé (ZONES_LIBRES_PATIENT), " +
      "soit exemptée AVEC UN MOTIF (EXEMPTIONS_TEXTE_LIBRE). L'oubli ouvre une zone " +
      "de saisie clinique sans que personne le voie.",
    ).toEqual([]);
  });

  test("chaque exemption porte un motif qui explique POURQUOI", () => {
    // Une exemption sans raison est une case cochée. La relecture doit pouvoir
    // juger, pas seulement constater.
    for (const e of EXEMPTIONS_TEXTE_LIBRE) {
      expect(e.motif.length, `${e.table}.${e.champ}`).toBeGreaterThan(30);
    }
  });

  test("aucune exemption ne vise une table de personnes", () => {
    // Le contournement le plus naturel de cette garde : exempter `clients` en
    // écrivant un motif plausible. Interdit d'emblée.
    const personnes = ["clients", "prospects", "affaires", "devis", "factures", "pointages"];
    for (const e of EXEMPTIONS_TEXTE_LIBRE) {
      expect(personnes, `${e.table} ne peut pas être exemptée`).not.toContain(e.table);
    }
  });
});

describe("le calcul du refus", () => {
  test("une note sur un client est refusée", () => {
    expect(texteLibreInterdit("/clients", { notes: "lombalgie chronique" })).toEqual(["notes"]);
  });

  test("le sous-chemin d'une ressource est couvert", () => {
    // `/clients/:id` autant que `/clients`. Sans quoi la mise à jour passerait
    // là où la création est bloquée.
    expect(texteLibreInterdit("/clients/abc-123", { notes: "x" })).toEqual(["notes"]);
  });

  test("une chaîne VIDE n'est pas une violation", () => {
    // Effacer une note est le geste qu'on veut encourager. Le refuser
    // empêcherait de nettoyer ce qui a déjà été saisi.
    expect(texteLibreInterdit("/clients", { notes: "" })).toEqual([]);
    expect(texteLibreInterdit("/clients", { notes: "   " })).toEqual([]);
  });

  test("les charges de l'entreprise restent ouvertes", () => {
    // Un loyer n'est pas un patient. Bloquer aurait cassé la comptabilité
    // sans rien protéger.
    expect(texteLibreInterdit("/charges-recurrentes", { notes: "loyer du cabinet" })).toEqual([]);
  });

  test("la description d'une LIGNE de facture n'est pas visée", () => {
    // C'est le contenu facturé — « Consultation », « Séance de rééducation ».
    // La bloquer rendrait la facturation impossible, c'est-à-dire supprimerait
    // la raison d'être du produit pour ce secteur.
    expect(texteLibreInterdit("/factures", {
      lines: [{ description: "Séance de rééducation" }],
    })).toEqual([]);
  });
});

describe("le secteur visé", () => {
  test("la santé libérale est concernée", () => {
    expect(estSecteurSante("sante_liberale")).toBe(true);
  });

  test.each(["batiment", "professions_liberales", "services_personne", null])(
    "%s ne l'est pas", (v) => {
      // `professions_liberales` porte un secret professionnel (US-A7.2) mais
      // pas de donnée de santé : un avocat n'a pas de dossier médical, et lui
      // retirer ses notes serait une restriction sans fondement.
      expect(estSecteurSante(v)).toBe(false);
    },
  );
});

describe("le message d'orientation — 4e critère", () => {
  test("il dit OÙ va l'information", () => {
    expect(MESSAGE_ORIENTATION_HDS).toMatch(/HDS/);
    expect(MESSAGE_ORIENTATION_HDS).toMatch(/logiciel métier/);
  });

  test("il EXCLUT explicitement ce que nodaq assure — règle 3 bis a", () => {
    // Un refus rédigé trop largement attrape le cœur du métier. Facturer une
    // consultation reste la raison d'être du produit ; le message doit le dire
    // dans la même phrase que le refus, sinon le praticien conclut que nodaq
    // ne sert à rien pour lui.
    expect(MESSAGE_ORIENTATION_HDS).toMatch(/factur/i);
    expect(MESSAGE_ORIENTATION_HDS).toMatch(/continuent de fonctionner/);
  });

  test("il n'emploie aucun jargon anglo-saxon — règle 3 bis b", () => {
    for (const mot of [" MRR", " YTD", "churn", "pipeline", "compliance"]) {
      expect(MESSAGE_ORIENTATION_HDS.toLowerCase()).not.toContain(mot.toLowerCase().trim());
    }
  });
});
