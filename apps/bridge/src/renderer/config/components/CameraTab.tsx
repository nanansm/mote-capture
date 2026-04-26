import { useState } from "react";
import type { BridgeConfig, CameraMode, DeviceTestResult } from "../../../shared/types";

const MODES: { value: CameraMode; label: string }[] = [
  { value: "webcam-mac", label: "Webcam (macOS — imagesnap)" },
  { value: "digicamcontrol", label: "Canon via digiCamControl (Windows)" },
  { value: "gphoto2", label: "Canon via gphoto2 (Mac/Linux)" },
  { value: "mock", label: "Mock (SVG placeholder)" },
];

export function CameraTab({
  config,
  save,
}: {
  config: BridgeConfig;
  save: (patch: Partial<BridgeConfig>) => Promise<void>;
}) {
  const [mode, setMode] = useState<CameraMode>(config.cameraMode);
  const [deviceName, setDeviceName] = useState(config.cameraDeviceName ?? "");
  const [digicamPath, setDigicamPath] = useState(config.digiCamControlPath ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceTestResult | null>(null);

  async function onSave() {
    setBusy(true);
    try {
      await save({
        cameraMode: mode,
        cameraDeviceName: deviceName.trim() || undefined,
        digiCamControlPath: digicamPath.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setBusy(true);
    setResult(null);
    try {
      const r = await window.bridgeAPI.testCamera();
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="col">
          <label htmlFor="cmode">Mode</label>
          <select id="cmode" value={mode} onChange={(e) => setMode(e.target.value as CameraMode)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {mode === "webcam-mac" ? (
          <div className="col">
            <label htmlFor="dname">Device name (optional)</label>
            <input
              id="dname"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="FaceTime HD Camera"
            />
            <div className="muted">
              Kosongkan untuk pakai default. Butuh <code>imagesnap</code> — install via{" "}
              <code>brew install imagesnap</code>.
            </div>
          </div>
        ) : null}

        {mode === "digicamcontrol" ? (
          <div className="col">
            <label htmlFor="dpath">CameraControlCmd.exe path</label>
            <input id="dpath" value={digicamPath} onChange={(e) => setDigicamPath(e.target.value)} />
            <div className="muted">
              Default: <code>C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe</code>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="secondary" onClick={onSave} disabled={busy}>
            Save Mode
          </button>
          <button onClick={onTest} disabled={busy}>
            {busy ? "Testing…" : "Test Capture"}
          </button>
        </div>
      </div>

      {result ? (
        <div className="card stack">
          <h3>Test Result</h3>
          {result.ok ? (
            <div>
              <span className="badge ok">🟢 OK</span>{" "}
              <span className="muted">{result.deviceName}</span>
            </div>
          ) : (
            <div>
              <span className="badge err">🔴 Failed</span>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{result.error}</pre>
            </div>
          )}
          {result.previewDataUrl ? (
            <div>
              <img
                src={result.previewDataUrl}
                alt="capture preview"
                style={{ maxWidth: "100%", borderRadius: 6, border: "1px solid var(--border)" }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
