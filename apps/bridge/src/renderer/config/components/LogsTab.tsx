import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../../../shared/types";

const LEVEL_COLORS: Record<LogEntry["level"], string> = {
  debug: "#71717a",
  info: "#0f5132",
  warn: "#b45309",
  error: "#dc2626",
};

export function LogsTab() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.bridgeAPI.getLogs().then(setEntries);
    const off = window.bridgeAPI.onLogAppended((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 1000) next.splice(0, next.length - 1000);
        return next;
      });
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, follow]);

  async function onClear() {
    await window.bridgeAPI.clearLogs();
    setEntries([]);
  }

  return (
    <div className="stack" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 12 }}>
          <label style={{ textTransform: "none", letterSpacing: 0 }}>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              style={{ width: "auto", marginRight: 6 }}
            />
            Auto-scroll
          </label>
          <span className="muted">{entries.length} entries</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary" onClick={() => window.bridgeAPI.openLogFolder()}>
            Open log folder
          </button>
          <button className="danger" onClick={onClear}>
            Clear view
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="card"
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          background: "#0f172a",
          color: "#e2e8f0",
          padding: 10,
          borderRadius: 6,
        }}
      >
        {entries.length === 0 ? (
          <div style={{ color: "#94a3b8" }}>No logs yet…</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", paddingBottom: 2 }}>
              <span style={{ color: "#94a3b8" }}>
                {new Date(e.ts).toLocaleTimeString("id-ID", { hour12: false })}
              </span>{" "}
              <span style={{ color: LEVEL_COLORS[e.level], fontWeight: 600 }}>
                [{e.level.toUpperCase()}]
              </span>{" "}
              <span>{e.message}</span>
              {e.meta && Object.keys(e.meta).length > 0 ? (
                <span style={{ color: "#cbd5e1" }}> {JSON.stringify(e.meta)}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
