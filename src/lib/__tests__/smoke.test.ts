import { describe, expect, it } from "vitest";
import { C } from "@/lib/constants";

describe("vitest wiring", () => {
  it("resolves the @ alias", () => {
    expect(C.green).toBe("#00e5a0");
  });
});
