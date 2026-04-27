import { useEffect, useState } from "react";
import type { BridgeConfig, PrinterMode, DeviceTestResult } from "../../../shared/types";

const MODES: { value: PrinterMode; label: string }[] = [
  { value: "win32", label: "Windows (mspaint /pt)" },
  { value: "cups", label: "macOS / Linux (CUPS lp)" },
  { value: "mock", label: "Mock (PNG -> ~/Downloads, auto-open)" },
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
  const [listing, setListing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeviceTestResult | null>(null);

  // Re-fetch when the user toggles mode in the dropdown - we pass `mode` so
  // the backend probes a fresh driver of the requested mode (without changing
  // the active printer instance until the user hits Save).
  useEffect(() => {
    let cancelled = false;
    setListing(true);
    void window.bridgeAPI
      .listPrinters(mode)
      .then((list) => {
        if (!cancelled) setAvailable(list);
      })
      .catch(() => {
        if (!cancelled) setAvailable([]);
      })
      .finally(() => {
        if (!cancelled) setListing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function refreshList() {
    setListing(true);
    try {
      const list = await window.bridgeAPI.listPrinters(mode);
      setAvailable(list);
    } catch {
      setAvailable([]);
    } finally {
      setListing(false);
    }
  }

  async function onSave() {
    setBusy(true);
    try {
      // Always send strings (never undefined) so electron-store doesn't choke.
      await save({
        printerMode: mode,
        printerName: printerName.trim(),
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

  const showDropdown = mode !== "mock" && available.length > 0;

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

        {mode !== "mock" ? (
          <div className="col">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
              <label htmlFor="pname">Printer Name</label>
              <button
                type="button"
                className="secondary"
                onClick={() => void refreshList()}
                disabled={listing}
                style={{ padding: "2px 8px", fontSize: 11 }}
              >
                {listing ? "Refreshing..." : "Refresh List"}
              </button>
            </div>
            {showDropdown ? (
              <select
                id="pname"
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
              >
                <option value="">(default printer)</option>
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
              {listing
                ? "Memuat daftar printer..."
                : available.length === 0
                  ? "Tidak ada printer terdeteksi (atau driver belum siap). Ketik nama printer secara manual."
                  : `${available.length} printer terdeteksi. Pilih nama printer yang akan dipakai untuk cetak 4R.`}
            </div>
          </div>
        ) : (
          <div className="col">
            <div className="muted">
              Mode mock akan menulis PNG ke <code>~/Downloads</code> dan auto-open di OS.
              Tidak butuh konfigurasi nama printer.
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="secondary" onClick={onSave} disabled={busy}>
            Save Mode
          </button>
          <button onClick={onTest} disabled={busy}>
            {busy ? "Testing..." : "Test Print"}
          </button>
        </div>
      </div>

      {result ? (
        <div className="card stack">
          <h3>Test Result</h3>
          {result.ok ? (
            <div>
              <span className="badge ok">OK</span>{" "}
              <span className="muted">{result.deviceName}</span>
            </div>
          ) : (
            <div>
              <span className="badge err">Failed</span>
              <pre style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{result.error}</pre>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
