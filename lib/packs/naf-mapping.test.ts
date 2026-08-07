import { describe, it, expect } from "vitest";
import { packFromNaf } from "./naf-mapping.js";

describe("packFromNaf", () => {
  it("43.xx → batiment (travaux de construction spécialisés)", () => {
    expect(packFromNaf("43.21Z")).toBe("batiment");
    expect(packFromNaf("4321Z")).toBe("batiment");
    expect(packFromNaf("43.99B")).toBe("batiment");
    expect(packFromNaf("4311Z")).toBe("batiment");
  });

  it("41.2x → batiment (construction de bâtiments)", () => {
    expect(packFromNaf("41.20A")).toBe("batiment");
    expect(packFromNaf("4120A")).toBe("batiment");
  });

  it("42.xx → batiment (génie civil)", () => {
    expect(packFromNaf("42.11Z")).toBe("batiment");
    expect(packFromNaf("42.91A")).toBe("batiment");
  });

  it("codes hors bâtiment → generique", () => {
    expect(packFromNaf("62.01Z")).toBe("generique"); // informatique
    expect(packFromNaf("47.11F")).toBe("generique"); // commerce
    expect(packFromNaf("56.10A")).toBe("generique"); // restauration
  });

  it("chaîne vide → generique", () => {
    expect(packFromNaf("")).toBe("generique");
  });

  it("code inconnu → generique (jamais d'exception)", () => {
    expect(packFromNaf("99.99Z")).toBe("generique");
    expect(packFromNaf("INVALIDE")).toBe("generique");
  });

  it("espaces tolérés", () => {
    expect(packFromNaf("43 21 Z")).toBe("batiment");
  });
});
