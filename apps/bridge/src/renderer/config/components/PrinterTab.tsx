import { useEffect, useState } from "react";
import type { BridgeConfig, PrinterMode, DeviceTestResult } from "../../../shared/types";

const MODES: { value: PrinterMode; label: string }[] = [
  { value: "win32", label: "Windows (mspaint /pt)" },
  { value: "cups", label: "macOS / Linux (CUPS lp)" },
  { value: "mock", label: "Mock (PNG → ~/Downloads, auto-open)" },
];

export function PrinterTab({
  config,
  save,
}: {
  config: BridgeConfig;
  save: (patch: Partial<BridgeConfig>) => Promise<void>;
}) {
  const [mode, setMode] = useState<PrinterMode>(config.printerMode);
  const [printerName, setPrinterName] = useState(config.printerName ?? "");
  const [available, setAvailable] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceTestResult | null>(null);

  useEffect(() => {
    void window.bridgeAPI.listPrinters().then(setAvailable).catch(() => setAvailable([]));
  }, [mode]);

  async function onSave() {
    setBusy(true);
    try {
      await save({
        printerMode: mode,
        printerName: printerName.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function onTest() {
    setBusy(true);
    setResult(null);
    try {
      const r = await window.bridgeAPI.testPrinter();
      setResult(r);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="col">
          <label htmlFor="pmode">Mode</label>
          <select id="pmode" value={mode} onChange={(e) => setMode(e.target.value as PrinterMode)}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="col">
          <label htmlFor="pname">Printer Name</label>
          {available.length > 0 ? (
            <select
              id="pname"
              value={printerName}
              onChange={(e) => setPrinterName(e.target.value)}
            >
              <option value="">— default —</option>
              {available.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="pname"
              value={printerName}
              onChange={(e) => setPrinterName(e.target.value)}
              placeholder="EPSON L8050 Series"
            />
          )}
          <div className="muted">
            {mode === "mock"
              ? "Mode mock akan menulis PNG ke ~/Downloads dan auto-open di OS."
              : "Pilih nama printer yang akan dipakai untuk cetak 4R."}
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="secondary" onClick={onSave} disabled={busy}>
            Save Mode
          </button>
          <button onClick={onTest} disabled={busy}>
            {busy ? "Testing…" : "Test Print"}
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
        </div>
      ) : null}
    </div>
  );
}
