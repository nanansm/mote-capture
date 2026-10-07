// Abstraksi kamera. Driver mock dipakai rig e2e + pengembangan tanpa
// hardware; driver gphoto2 diisi dan diuji di M4 saat Canon 2000D ada.
import fs from "node:fs/promises";
import sharp from "sharp";

export type CameraStatus = { connected: boolean; model: string | null; lastError: string | null };

export interface CameraDriver {
  readonly name: string;
  status(): CameraStatus;
  /** Deteksi ulang kamera (dipanggil saat boot dan berkala). */
  detect(): Promise<CameraStatus>;
  /** Reset USB + deteksi ulang (tombol staf). */
  reset(): Promise<CameraStatus>;
  /**
   * Jepret satu foto ke `outPath` (JPEG). `onShutter` dipanggil sekali saat
   * shutter benar-benar jatuh. Gagal = throw. Timeout dipegang pemanggil.
   */
  capture(outPath: string, onShutter: () => void, signal: AbortSignal): Promise<void>;
  /** Hentikan proses yang sedang jalan (SIGTERM / timeout). */
  abort(): void;
}

export class CameraError extends Error {
  constructor(
    message: string,
    readonly code: "OFFLINE" | "TIMEOUT" | "IO" | "ABORTED",
  ) {
    super(message);
  }
}

const SLOT_COLORS = ["#FE7B00", "#FCD12D", "#1A3A2A", "#EB1B22"];

/** Kamera palsu: menghasilkan JPEG 3:2 berwarna dengan nomor jepretan. */
export class MockCamera implements CameraDriver {
  readonly name = "mock";
  private st: CameraStatus = { connected: true, model: "Canon EOS 2000D (mock)", lastError: null };
  private failNext = false;
  private shots = 0;
  shutterDelayMs = 150;
  downloadDelayMs = 250;

  status(): CameraStatus {
    return { ...this.st };
  }
  async detect(): Promise<CameraStatus> {
    return this.status();
  }
  async reset(): Promise<CameraStatus> {
    this.st = { ...this.st, connected: true, lastError: null };
    return this.status();
  }
  abort(): void {}

  // ── kontrol uji ──
  setConnected(connected: boolean): CameraStatus {
    this.st = { ...this.st, connected, lastError: connected ? null : "USB: device not found (mock)" };
    return this.status();
  }
  failNextCapture(): void {
    this.failNext = true;
  }
  resetMock(): void {
    this.st = { connected: true, model: "Canon EOS 2000D (mock)", lastError: null };
    this.failNext = false;
  }

  async capture(outPath: string, onShutter: () => void, signal: AbortSignal): Promise<void> {
    await sleep(this.shutterDelayMs, signal);
    if (!this.st.connected) throw new CameraError("gphoto2: *** Error: No camera found (mock)", "OFFLINE");
    if (this.failNext) {
      this.failNext = false;
      throw new CameraError("gphoto2: I/O error (mock)", "IO");
    }
    onShutter();
    await sleep(this.downloadDelayMs, signal);
    this.shots += 1;
    const color = SLOT_COLORS[this.shots % SLOT_COLORS.length]!;
    const svg = Buffer.from(
      `<svg width="1500" height="1000" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${color}"/>
        <text x="50%" y="55%" font-size="320" font-family="sans-serif" fill="#ffffff" text-anchor="middle">#${this.shots}</text>
      </svg>`,
    );
    const jpg = await sharp(svg).jpeg({ quality: 85 }).toBuffer();
    await fs.writeFile(outPath, jpg);
  }
}

/**
 * Driver Canon 2000D lewat gphoto2 (PRD bagian 9). SENGAJA belum diisi:
 * perilaku nyata (gvfs merebut USB, `capturetarget`, kamera hang setelah
 * kill, kapan "New file is in location" muncul) hanya bisa dipastikan
 * dengan kamera asli di M4. Menulisnya sekarang = menebak.
 */
export class Gphoto2Camera implements CameraDriver {
  readonly name = "gphoto2";
  status(): CameraStatus {
    return { connected: false, model: null, lastError: "driver gphoto2 belum diimplementasi (M4)" };
  }
  async detect(): Promise<CameraStatus> {
    return this.status();
  }
  async reset(): Promise<CameraStatus> {
    return this.status();
  }
  abort(): void {}
  async capture(): Promise<void> {
    throw new CameraError("driver gphoto2 belum diimplementasi (M4)", "OFFLINE");
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CameraError("dibatalkan", "ABORTED"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new CameraError("dibatalkan", "ABORTED"));
      },
      { once: true },
    );
  });
}
