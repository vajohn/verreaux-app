import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSearchSources, searchSeries, setPiApiUrl, setPiApiMode } from "../../src/features/sync/piClient";
import { setSyncCreds } from "../../src/features/sync/syncCreds";

beforeEach(() => {
  localStorage.clear();
  setPiApiMode("remote");
  setPiApiUrl("remote", "https://pi.test");
});

describe("listSearchSources", () => {
  it("GETs /adapters and returns the list", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ adapters: [{ id: "asurascans", name: "Asura Scans", host: "asurascans.com", searchable: true }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await listSearchSources();
    expect(fetchMock.mock.calls[0][0]).toBe("https://pi.test/adapters");
    expect(out[0].id).toBe("asurascans");
    vi.unstubAllGlobals();
  });
});

describe("searchSeries", () => {
  it("POSTs /search with the enrolled device token", async () => {
    setSyncCreds({ accountId: "a", deviceId: "d", deviceToken: "TOK" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ adapterId: "asurascans", title: "T", seriesUrl: "https://asurascans.com/series/x", coverUrl: null }], errors: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await searchSeries("hero", ["asurascans"]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pi.test/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string,string>).authorization).toBe("Bearer TOK");
    expect(JSON.parse(init.body as string)).toEqual({ q: "hero", sources: ["asurascans"] });
    expect(out.results[0].title).toBe("T");
    vi.unstubAllGlobals();
  });

  it("throws if the device is not enrolled", async () => {
    await expect(searchSeries("hero")).rejects.toThrow(/enroll/i);
  });
});
