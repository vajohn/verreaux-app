import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  urlBase64ToUint8Array,
  getVapidPublicKey,
  subscribeToPush,
  isPushSubscribed,
} from "../../src/features/sync/pushClient";
import { setPiApiUrl, setPiApiMode } from "../../src/features/sync/piClient";
import { setSyncCreds, clearSyncCreds } from "../../src/features/sync/syncCreds";

beforeEach(() => {
  localStorage.clear();
  setPiApiMode("remote");
  setPiApiUrl("remote", "https://pi.test");
  vi.unstubAllGlobals();
});

describe("urlBase64ToUint8Array", () => {
  it("decodes urlsafe base64", () => {
    // atob("AQID") = "\x01\x02\x03" → [1,2,3]
    const out = urlBase64ToUint8Array("AQID");
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("getVapidPublicKey", () => {
  it("returns the key on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ key: "K" }), { status: 200 })),
    );
    expect(await getVapidPublicKey()).toBe("K");
  });

  it("returns null on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    expect(await getVapidPublicKey()).toBeNull();
  });
});

describe("isPushSubscribed", () => {
  it("returns false when serviceWorker/PushManager are absent", async () => {
    // jsdom has neither by default — no stubs needed
    expect(await isPushSubscribed()).toBe(false);
  });

  it("returns true when a subscription exists", async () => {
    const reg = {
      pushManager: {
        getSubscription: vi.fn(async () => ({ endpoint: "https://push.test/x" })),
      },
    };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(reg) } });
    vi.stubGlobal("PushManager", function () {});
    expect(await isPushSubscribed()).toBe(true);
  });

  it("returns false when no subscription exists", async () => {
    const reg = {
      pushManager: { getSubscription: vi.fn(async () => null) },
    };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(reg) } });
    vi.stubGlobal("PushManager", function () {});
    expect(await isPushSubscribed()).toBe(false);
  });
});

describe("subscribeToPush", () => {
  it("throws when not enrolled", async () => {
    clearSyncCreds();
    await expect(subscribeToPush()).rejects.toThrow(/enrol/i);
  });

  it("throws when serviceWorker / PushManager are absent", async () => {
    setSyncCreds({ accountId: "a", deviceId: "d", deviceToken: "TOK" });
    // Do NOT stub PushManager/navigator so the checks fail
    await expect(subscribeToPush()).rejects.toThrow(/not supported/i);
  });

  it("throws when permission is denied", async () => {
    setSyncCreds({ accountId: "a", deviceId: "d", deviceToken: "TOK" });
    const reg = {
      pushManager: {
        subscribe: vi.fn(),
        getSubscription: vi.fn(async () => null),
      },
    };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(reg) } });
    vi.stubGlobal("PushManager", function () {});
    vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => "denied") });
    await expect(subscribeToPush()).rejects.toThrow(/not granted/i);
  });

  it("subscribes and POSTs to /push/subscribe with the device token", async () => {
    setSyncCreds({ accountId: "a", deviceId: "d", deviceToken: "TOK" });
    const fakeSub = {
      toJSON: () => ({
        endpoint: "https://push.test/x",
        keys: { p256dh: "p", auth: "au" },
      }),
    };
    const reg = {
      pushManager: {
        subscribe: vi.fn(async () => fakeSub),
        getSubscription: vi.fn(async () => null),
      },
    };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(reg) } });
    vi.stubGlobal("PushManager", function () {});
    vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => "granted") });
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/push/vapid-public-key")
        ? new Response(JSON.stringify({ key: "AQID" }), { status: 200 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await subscribeToPush();

    const subCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/push/subscribe"),
    )!;
    expect(subCall).toBeDefined();
    expect((subCall[1] as RequestInit).method).toBe("POST");
    expect(
      ((subCall[1] as RequestInit).headers as Record<string, string>).authorization,
    ).toBe("Bearer TOK");
    expect(
      JSON.parse((subCall[1] as RequestInit).body as string).subscription.endpoint,
    ).toBe("https://push.test/x");
  });

  it("throws when server returns non-200 on subscribe", async () => {
    setSyncCreds({ accountId: "a", deviceId: "d", deviceToken: "TOK" });
    const fakeSub = {
      toJSON: () => ({ endpoint: "https://push.test/x", keys: {} }),
    };
    const reg = {
      pushManager: { subscribe: vi.fn(async () => fakeSub), getSubscription: vi.fn(async () => null) },
    };
    vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve(reg) } });
    vi.stubGlobal("PushManager", function () {});
    vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => "granted") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/push/vapid-public-key")
          ? new Response(JSON.stringify({ key: "AQID" }), { status: 200 })
          : new Response("", { status: 500 }),
      ),
    );
    await expect(subscribeToPush()).rejects.toThrow(/subscribe failed/i);
  });
});
