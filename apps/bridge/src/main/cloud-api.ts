// Thin axios wrapper for talking to the cloud HTTP API (heartbeat, photo
// upload, composite upload, frame PNG download). All requests use the bridge
// token as Bearer auth. Errors throw — callers wrap.
//
// Upload transport change: the cloud API used to accept a multipart-encoded
// POST; it now accepts a raw-body PUT with the file bytes as-is (metadata
// via query string) — see apps/api/src/routes/bridge.ts. The multipart
// encoder dependency this used to pull in is gone.
import axios, { AxiosInstance } from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "./logger";

// The cloud upload routes only ever accept PNG bodies (see
// packages/shared/src/constants ALLOWED_IMAGE_MIME) — the bridge always
// sends this Content-Type regardless of the source capture format, matching
// the fixed contract in apps/api/src/routes/bridge.ts.
const UPLOAD_CONTENT_TYPE = "image/png";

export type CloudClient = {
  http: AxiosInstance;
  baseUrl: string;
  token: string;
  uploadPhoto: (sessionId: string, filePath: string, sortOrder: number) => Promise<{ key: string }>;
  uploadComposite: (sessionId: string, filePath: string) => Promise<{ key: string }>;
  heartbeat: (payload: Record<string, unknown>) => Promise<{ ok: boolean }>;
  downloadFile: (url: string, destPath: string) => Promise<void>;
  resolveBoothByToken: () => Promise<{ boothId: string; name: string } | null>;
};

export function makeCloudClient(opts: { baseUrl: string; token: string }): CloudClient {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const http = axios.create({
    baseURL: baseUrl,
    timeout: 30_000,
    headers: { Authorization: `Bearer ${opts.token}` },
  });

  async function putFile(urlPath: string, filePath: string): Promise<{ key: string }> {
    const body = await fs.readFile(filePath);
    const res = await http.put(urlPath, body, {
      headers: {
        "Content-Type": UPLOAD_CONTENT_TYPE,
        "Content-Length": body.byteLength,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return { key: res.data.data.key as string };
  }

  return {
    http,
    baseUrl,
    token: opts.token,

    async heartbeat(payload) {
      const res = await http.post("/api/bridge/heartbeat", payload);
      return res.data;
    },

    async uploadPhoto(sessionId, filePath, sortOrder) {
      return putFile(`/api/session/${sessionId}/photos?sortOrder=${sortOrder}`, filePath);
    },

    async uploadComposite(sessionId, filePath) {
      return putFile(`/api/session/${sessionId}/composite`, filePath);
    },

    async downloadFile(url, destPath) {
      // url may be absolute (R2 public CDN) or relative ("/uploads/...")
      const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
      const res = await axios.get(fullUrl, { responseType: "arraybuffer", timeout: 30_000 });
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, Buffer.from(res.data));
    },

    async resolveBoothByToken() {
      // Public endpoint — given valid bridge token, returns booth id/name.
      try {
        const res = await http.get("/api/bridge/resolve");
        return res.data.data as { boothId: string; name: string };
      } catch (err) {
        logger.warn("resolve_booth_failed", { err: errMsg(err) });
        return null;
      }
    },
  };
}

export function errMsg(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
