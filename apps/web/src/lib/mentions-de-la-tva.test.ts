import { describe, expect, it } from "vitest";

import { mentionsDeLaTva } from "./mentions-de-la-tva";

describe("mentionsDeLaTva", () => {
  it("sans cabinet, dit que la société dépose elle-même, sans répéter l'estimation", () => {
    expect(mentionsDeLaTva({ parSociete: false, sansCabinet: true, estimation: true })).toEqual({
      sous: "pme.tva.sousSansCabinet",
      estimation: false,
    });
  });

  it("avec un cabinet, ou tant qu'on ne le sait pas, garde la phrase du cabinet", () => {
    expect(mentionsDeLaTva({ parSociete: false, sansCabinet: false, estimation: false })).toEqual({
      sous: "pme.tva.sous",
      estimation: false,
    });
  });

  it("sous « Toutes les sociétés », garde la phrase du groupe et la mention d'estimation", () => {
    expect(mentionsDeLaTva({ parSociete: true, sansCabinet: true, estimation: true })).toEqual({
      sous: "pme.tva.sousGroupe",
      estimation: true,
    });
  });
});
