import { SELF } from "cloudflare:test";
import { decode } from "@capture/shared";

// Klien WS kiosk minimal untuk test: buka /ws/kiosk/:boothId via SELF, kumpulkan
// push, dan kirim request `{id, ev, data}` lalu tunggu reply dengan id sama.

type Frame = { id?: number; ev?: string; ok?: boolean; data?: unknown; error?: string };

export type TestKiosk = {
  ws: WebSocket;
  pushes: Frame[];
  waitPush: (ev: string, timeoutMs?: number) => Promise<Frame>;
  request: (ev: string, data?: unknown, timeoutMs?: number) => Promise<Frame>;
  close: () => void;
};

let reqSeq = 0;

export async function openKiosk(boothId: string): Promise<TestKiosk> {
  const res = await SELF.fetch(`https://capture.test/ws/kiosk/${boothId}`, {
    headers: { Upgrade: "websocket" },
  });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade gagal: ${res.status}`);
  const ws = res.webSocket;
  ws.accept();
  const pushes: Frame[] = [];
  const replies = new Map<number, (f: Frame) => void>();
  const pushWaiters: Array<{ ev: string; resolve: (f: Frame) => void }> = [];
  ws.addEventListener("message", (e) => {
    const f = decode(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)) as Frame;
    if (f.id !== undefined && replies.has(f.id)) {
      replies.get(f.id)!(f);
      replies.delete(f.id);
      return;
    }
    pushes.push(f);
    const i = pushWaiters.findIndex((w) => w.ev === f.ev);
    if (i >= 0) pushWaiters.splice(i, 1)[0]!.resolve(f);
  });
  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
    Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);
  return {
    ws,
    pushes,
    waitPush: (ev, timeoutMs = 3000) => {
      const seen = pushes.find((p) => p.ev === ev);
      if (seen) return Promise.resolve(seen);
      return withTimeout(new Promise<Frame>((resolve) => pushWaiters.push({ ev, resolve })), timeoutMs, ev);
    },
    request: (ev, data, timeoutMs = 3000) => {
      const id = ++reqSeq;
      const p = new Promise<Frame>((resolve) => replies.set(id, resolve));
      ws.send(JSON.stringify({ id, ev, data }));
      return withTimeout(p, timeoutMs, ev);
    },
    close: () => {
      try {
        ws.close(1000, "test");
      } catch {
        /* sudah tertutup */
      }
    },
  };
}
