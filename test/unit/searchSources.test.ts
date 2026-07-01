import { describe, it, expect, beforeEach } from "vitest";
import { getEnabledSources, setSourceEnabled, isSourceEnabled } from "../../src/features/search/searchSources";
beforeEach(() => localStorage.clear());
describe("searchSources store", () => {
  it("defaults to enabled when nothing stored", () => {
    expect(isSourceEnabled("asurascans")).toBe(true);
  });
  it("disabling then reading persists", () => {
    setSourceEnabled("drake", false);
    expect(isSourceEnabled("drake")).toBe(false);
    expect(getEnabledSources(["asurascans", "drake"])).toEqual(["asurascans"]);
  });
  it("re-enabling restores", () => {
    setSourceEnabled("drake", false);
    setSourceEnabled("drake", true);
    expect(isSourceEnabled("drake")).toBe(true);
  });
});
