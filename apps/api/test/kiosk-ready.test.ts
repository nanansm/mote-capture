import { describe, expect, it } from "vitest";
import { SocketEvents, type KioskReadyPayload } from "@capture/shared";
import { seedBooth, seedSession } from "./helpers";
import { openKiosk } from "./ws";

describe("KIOSK_READY", () => {
  it("booth kosong: activeSession null, tanpa field bridge lama", async () => {
    const boothId = await seedBooth({ id: "BTH-READY-1" });
    const k = await openKiosk(boothId);
    const ready = (await k.waitPush(SocketEvents.KIOSK_READY)).data as KioskReadyPayload;
    expect(ready.boothId).toBe(boothId);
    expect(ready.activeSession).toBeNull();
    expect(ready).not.toHaveProperty("bridgeOnline");
    expect(ready).not.toHaveProperty("useMockBridge");
    k.close();
  });

  it("kiosk reload saat sesi paid: activeSession dikirim agar sesi bisa dilanjut", async () => {
    const boothId = await seedBooth({ id: "BTH-READY-2" });
    const sid = await seedSession({ boothId, status: "paid", paidAt: Date.now() });
    const k = await openKiosk(boothId);
    const ready = (await k.waitPush(SocketEvents.KIOSK_READY)).data as KioskReadyPayload;
    expect(ready.activeSession?.id).toBe(sid);
    expect(ready.activeSession?.status).toBe("paid");
    k.close();
  });

  it("sesi terakhir sudah done: activeSession null", async () => {
    const boothId = await seedBooth({ id: "BTH-READY-3" });
    await seedSession({ boothId, status: "done" });
    const k = await openKiosk(boothId);
    const ready = (await k.waitPush(SocketEvents.KIOSK_READY)).data as KioskReadyPayload;
    expect(ready.activeSession).toBeNull();
    k.close();
  });
});
