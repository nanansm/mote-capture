import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/payments/transactions/page.tsx. The old
// page pulled a fixed 200 latest rows; this pages through
// GET /api/admin/transactions (apps/api/src/routes/admin-read.ts) instead.
type TransactionRow = {
  id: string;
  sessionId: string | null;
  provider: string;
  eventType: string;
  payload: unknown;
  createdAt: string;
};

const EVENT_VARIANTS: Record<
  string,
  "default" | "secondary" | "warn" | "success" | "destructive"
> = {
  qr_created: "secondary",
  paid: "success",
  expired: "destructive",
  failed: "destructive",
  invalid_webhook: "destructive",
  duplicate: "warn",
  refund_manual: "warn",
};

const LIMIT = 50;

export default function PaymentsTransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    get<{ data: TransactionRow[]; pagination: { hasMore: boolean } }>("/admin/transactions", {
      params: { limit: LIMIT, offset },
    })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        setHasMore(res.pagination.hasMore);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offset]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-brand-green-dark">Payment Transactions</h2>
          <p className="text-sm text-muted-foreground">
            Event payment terbaru — termasuk webhook yang masuk dan refund manual.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/payments">← Kembali ke Settings</Link>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Memuat...</p>
      ) : rows.length === 0 ? (
        <Card className="flex items-center justify-center border-dashed py-16">
          <p className="text-sm text-muted-foreground">Belum ada event payment.</p>
        </Card>
      ) : (
        <>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="hidden md:table-cell">Provider</TableHead>
                  <TableHead>Session</TableHead>
                  <TableHead className="hidden lg:table-cell">Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDate(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={EVENT_VARIANTS[r.eventType] ?? "secondary"}>
                        {r.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell capitalize">{r.provider}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.sessionId ? (
                        <Link
                          to={`/admin/sessions/${r.sessionId}`}
                          className="text-brand-green-dark hover:underline"
                        >
                          {r.sessionId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-xs">
                      <code className="block truncate font-mono text-[10px] text-muted-foreground">
                        {r.payload ? JSON.stringify(r.payload) : "—"}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            >
              ← Sebelumnya
            </Button>
            <span className="text-xs text-muted-foreground">Offset {offset}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => setOffset(offset + LIMIT)}
            >
              Berikutnya →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
