import { useEffect, useState } from "react";
import { SetupTab } from "./components/SetupTab";
import { CameraTab } from "./components/CameraTab";
import { PrinterTab } from "./components/PrinterTab";
import { LogsTab } from "./components/LogsTab";
import type { BridgeConfig, BridgeStatus } from "../../shared/types";

type TabKey = "setup" | "camera" | "printer" | "logs";

const TABS: { key: TabKey; label: string }[] = [
  { key: "setup", label: "Setup" },
  { key: "camera", label: "Camera" },
  { key: "printer", label: "Printer" },
  { key: "logs", label: "Logs" },
];

export function App() {
  const [tab, setTab] = useState<TabKey>("setup");
  const [config, setConfig] = useState<BridgeConfig | null>(null);
  const [status, setStatus] = useState<BridgeStatus | null>(null);

  useEffect(() => {
    void window.bridgeAPI.getConfig().then(setConfig);
    void window.bridgeAPI.getStatus().then(setStatus);
    const off = window.bridgeAPI.onStatusChanged(setStatus);
    return () => off();
  }, []);

  async function saveConfig(patch: Partial<BridgeConfig>) {
    const updated = await window.bridgeAPI.saveConfig(patch);
    setConfig(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--green-dark)",
          color: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={{ color: "var(--bg)", margin: 0, fontSize: 16 }}>Mote Capture Bridge</h2>
          <div style={{ fontSize: 11, opacity: 0.8 }}>
            v{status?.bridgeVersion ?? "?"} · {status?.platform ?? "—"}
          </div>
        </div>
        <StatusPill status={status} />
      </header>

      <nav
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          background: "white",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "" : "secondary"}
            style={{
              borderRadius: 0,
              border: "none",
              borderBottom: tab === t.key ? "3px solid var(--green-dark)" : "3px solid transparent",
              background: "transparent",
              color: tab === t.key ? "var(--green-dark)" : "var(--muted)",
              flex: 1,
              padding: "10px 0",
              fontWeight: 600,
            }}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {!config ? (
          <div className="muted">Loading…</div>
        ) : tab === "setup" ? (
          <SetupTab config={config} status={status} save={saveConfig} />
        ) : tab === "camera" ? (
          <CameraTab config={config} save={saveConfig} />
        ) : tab === "printer" ? (
          <PrinterTab config={config} save={saveConfig} />
        ) : (
          <LogsTab />
        )}
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: BridgeStatus | null }) {
  if (!status) return <span className="badge busy">…</span>;
  if (status.connected) return <span className="badge ok">🟢 Connected</span>;
  if (status.connecting) return <span className="badge busy">🟡 Connecting…</span>;
  return <span className="badge err">🔴 Offline</span>;
}
