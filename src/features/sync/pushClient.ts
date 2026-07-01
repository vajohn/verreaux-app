import { getApiBase } from "./piClient";
import { getSyncCreds } from "./syncCreds";

function base(): string {
  const b = getApiBase();
  if (!b) throw new Error("Pi API base URL is not configured.");
  return b;
}

export function urlBase64ToUint8Array(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const res = await fetch(`${base()}/push/vapid-public-key`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`vapid key (${res.status})`);
  return ((await res.json()) as { key: string }).key;
}

export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) !== null;
}

export async function subscribeToPush(): Promise<void> {
  const creds = getSyncCreds();
  if (!creds) throw new Error("Enrol this device before enabling notifications.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window))
    throw new Error("Notifications are not supported on this browser.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted.");
  const key = await getVapidPublicKey();
  if (!key) throw new Error("Push is not configured on the server.");
  const reg = await navigator.serviceWorker.ready;
  const keyBytes = urlBase64ToUint8Array(key);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array(keyBytes.buffer as ArrayBuffer),
  });
  const res = await fetch(`${base()}/push/subscribe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${creds.deviceToken}`,
    },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
}

export async function unsubscribeFromPush(): Promise<void> {
  const creds = getSyncCreds();
  if ("serviceWorker" in navigator && "PushManager" in window) {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  }
  if (creds) {
    try {
      await fetch(`${base()}/push/subscribe`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${creds.deviceToken}` },
      });
    } catch {
      /* best-effort */
    }
  }
}
