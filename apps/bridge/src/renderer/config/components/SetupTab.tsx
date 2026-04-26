import { useState } from "react";
import type { BridgeConfig, BridgeStatus } from "../../../shared/types";

export function SetupTab({
  config,
  status,
  save,
}: {
  config: BridgeConfig;
  status: BridgeStatus | null;
  save: (patch: Partial<BridgeConfig>) => Promise<void>;
}) {
  const [cloudUrl, setCloudUrl] = useState(config.cloudUrl);
  const [bridgeToken, setBridgeToken] = useState(config.bridgeToken);
  const [boothId, setBoothId] = useState(config.boothId);
  const [autoStart, setAutoStart] = useState(config.autoStart);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSave() {
    setBusy(true);
    setMessage(null);
    try {
      await save({ cloudUrl: cloudUrl.trim(), bridgeToken: bridgeToken.trim(), boothId: boothId.trim(), autoStart });
      setMessage("✓ Saved. Reconnecting…");
    } catch (err) {
      setMessage("✗ " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="col">
          <label htmlFor="cloud">Cloud URL</label>
          <input
            id="cloud"
            value={cloudUrl}
            onChange={(e) => setCloudUrl(e.target.value)}
            placeholder="http://localhost:5000"
          />
          <div className="muted">URL Next.js cloud yang dipakai bridge ini.</div>
        </div>

        <div className="col">
          <label htmlFor="token">Bridge Token</label>
          <input
            id="token"
            value={bridgeToken}
            onChange={(e) => setBridgeToken(e.target.value)}
            placeholder="paste bridge token dari admin"
            type="password"
            spellCheck={false}
          />
          <div className="muted">
            Token dibuat di <code>/admin/booths/[id]</code>. Booth ID akan terisi otomatis setelah token valid.
          </div>
        </div>

        <div className="col">
          <label htmlFor="booth">Booth ID</label>
          <input
            id="booth"
            value={boothId}
            onChange={(e) => setBoothId(e.target.value)}
            placeholder="auto-detect dari token (atau isi manual)"
          />
        </div>

        <div className="row">
          <input
            id="autostart"
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            style={{ width: "auto" }}
          />
          <label htmlFor="autostart" style={{ textTransform: "none", letterSpacing: 0 }}>
            Launch on system startup (best-effort, OS dependent)
          </label>
        </div>
      </div>

      <div className="card stack">
        <h3>Status</h3>
        {status?.connected ? (
          <div>
            <span className="badge ok">🟢 Connected</span>{" "}
            <span className="muted">socket {status.socketId}</span>
          </div>
        ) : status?.connecting ? (
          <div>
            <span className="badge busy">🟡 Connecting…</span>
            {status.lastError ? <div className="muted">{status.lastError}</div> : null}
          </div>
        ) : (
          <div>
            <span className="badge err">🔴 Offline</span>
            {status?.lastError ? <div className="muted">{status.lastError}</div> : null}
          </div>
        )}
        {status?.lastHeartbeatAt ? (
          <div className="muted">Last heartbeat: {new Date(status.lastHeartbeatAt).toLocaleTimeString()}</div>
        ) : null}
      </div>

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="secondary" onClick={() => window.bridgeAPI.disconnectNow()}>
          Disconnect
        </button>
        <button onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save & Connect"}
        </button>
      </div>
      {message ? <div className="muted">{message}</div> : null}
    </div>
  );
}
