// Thin axios wrapper for talking to the cloud HTTP API (heartbeat, photo
// upload, composite upload, frame PNG download). All requests use the bridge
// token as Bearer auth. Errors throw — callers wrap.
import axios, { AxiosInstance } from "axios";
import fs from "node:fs";
import path from "node:path";
import FormData from "form-data";
import { logger } from "./logger";

export type CloudClient = {
  http: AxiosInstance;
  baseUrl: string;
  token: string;
  uploadPhoto: (sessionId: string, filePath: string, sortOrder: number) => Promise<{ url: string }>;
  uploadComposite: (sessionId: string, filePath: string) => Promise<{ url: string }>;
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

  return {
    http,
    baseUrl,
    token: opts.token,

    async heartbeat(payload) {
      const res = await http.post("/api/bridge/heartbeat", payload);
      return res.data;
    },

    async uploadPhoto(sessionId, filePath, sortOrder) {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath));
      form.append("sortOrder", String(sortOrder));
      const res = await http.post(`/api/session/${sessionId}/photos`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return { url: res.data.data.url as string };
    },

    async uploadComposite(sessionId, filePath) {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath));
      const res = await http.post(`/api/session/${sessionId}/composite`, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return { url: res.data.data.url as string };
    },

    async downloadFile(url, destPath) {
      // url may be absolute (R2 public CDN) or relative ("/uploads/...")
      const fullUrl = url.startsWith("http") ? url : `${baseUrl}${url}`;
      const res = await axios.get(fullUrl, { responseType: "arraybuffer", timeout: 30_000 });
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(res.data));
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
