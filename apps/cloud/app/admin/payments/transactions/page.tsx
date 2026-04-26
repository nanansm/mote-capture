import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  Card,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EVENT_VARIANTS: Record<string, "default" | "secondary" | "warn" | "success" | "destructive"> = {
  qr_created: "secondary",
  paid: "success",
  expired: "destructive",
  failed: "destructive",
  invalid_webhook: "destructive",
  duplicate: "warn",
  refund_manual: "warn",
};

export default async function TransactionsPage() {
  const rows = await db
    .select()
    .from(schema.paymentLogs)
    .orderBy(desc(schema.paymentLogs.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-brand-green-dark">Payment Transactions</h2>
          <p className="text-sm text-muted-foreground">
            200 event payment terbaru — termasuk webhook yang masuk dan refund manual.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/payments">← Kembali ke Settings</Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card className="flex items-center justify-center border-dashed py-16">
          <p className="text-sm text-muted-foreground">Belum ada event payment.</p>
        </Card>
      ) : (
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
                        href={`/admin/sessions/${r.sessionId}`}
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
      )}
    </div>
  );
}
