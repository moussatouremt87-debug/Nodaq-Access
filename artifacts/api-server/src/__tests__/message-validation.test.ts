/**
 * Une erreur de validation dite en français.
 *
 * Constaté le 29/08/2026 : l'acceptation d'un devis renvoyait un tableau JSON
 * de codes Zod — sur la page PUBLIQUE, celle que voit le client de l'artisan.
 * 109 routes rendaient `parsed.error.message`, qui est ce JSON sérialisé.
 */
import { describe, test, expect } from "vitest";
import { z } from "zod";
import { messageValidation } from "../lib/message-validation";

/** Fait échouer un schéma et rend le message rendu à l'utilisateur. */
function message(schema: z.ZodTypeAny, valeur: unknown): string {
  const r = schema.safeParse(valeur);
  if (r.success) throw new Error("le schéma aurait dû refuser cette valeur");
  return messageValidation(r.error);
}

describe("plus jamais de JSON dans un message d'erreur", () => {
  test("un champ manquant est dit en français, avec son nom", () => {
    const m = message(z.object({ signataire: z.string() }), {});
    expect(m).toBe("« signataire » : obligatoire.");
    expect(m).not.toContain("invalid_type");
    expect(m).not.toContain("Required");
    expect(m).not.toContain("{");
  });

  test("aucun message ne contient de code de bibliothèque", () => {
    const schema = z.object({
      nom: z.string(), age: z.number(), actif: z.boolean(),
      email: z.string().email(), type: z.enum(["A", "B"]),
    });
    const m = message(schema, { age: "x", actif: "x", email: "pas-un-email", type: "C" });
    for (const interdit of ["invalid_type", "invalid_enum_value", "Required", "Expected", "[", "{"]) {
      expect(m, `« ${interdit} » ne doit pas fuir`).not.toContain(interdit);
    }
  });
});

describe("les messages SUR MESURE des schémas sont conservés", () => {
  /*
   * Beaucoup de schémas portent déjà leur propre message français — meilleur
   * que tout ce qu'on écrirait ici. Les écraser serait une régression.
   */
  test("un message écrit à la main passe tel quel", () => {
    const schema = z.object({ nom: z.string().min(1, "Le nom est obligatoire") });
    expect(message(schema, { nom: "" })).toBe("« nom » : Le nom est obligatoire.");
  });

  test("le message de TVA du dépôt survit intact", () => {
    const schema = z.object({
      vatRate: z.number().refine(r => [20, 10, 5.5, 2.1, 0].includes(r), {
        message: "Taux TVA : 20, 10, 5.5, 2.1 ou 0",
      }),
    });
    expect(message(schema, { vatRate: 7 })).toContain("Taux TVA : 20, 10, 5.5, 2.1 ou 0");
  });
});

describe("lisibilité", () => {
  test("un champ imbriqué est nommé par son chemin", () => {
    const schema = z.object({ client: z.object({ email: z.string() }) });
    expect(message(schema, { client: {} })).toBe("« client › email » : obligatoire.");
  });

  test("une valeur d'énuméré refusée dit les valeurs acceptées", () => {
    const schema = z.object({ type: z.enum(["PARTICULIER", "PRO"]) });
    const m = message(schema, { type: "PROFESSIONNEL" });
    expect(m).toContain("PARTICULIER");
    expect(m).toContain("PRO");
  });

  test("au-delà de quatre champs, on annonce le reste au lieu de tout lister", () => {
    const schema = z.object(Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`champ${i}`, z.string()]),
    ) as Record<string, z.ZodString>);
    const m = message(schema, {});
    expect(m).toMatch(/et 3 autres/);
  });

  test("une erreur sans détail reste une phrase, pas un vide", () => {
    expect(messageValidation({ issues: [] } as unknown as z.ZodError)).toBe("Requête invalide.");
  });
});
