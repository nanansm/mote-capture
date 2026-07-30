import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Booth } from "@capture/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { formatRupiah, formatDate } from "@/lib/utils";
import { useAdminBoothStatuses } from "@/lib/ws/use-admin-booth-statuses";

export function BoothList({ booths }: { booths: Booth[] }) {
  // Owns a local copy of the list so a delete can drop the row in place —
  // no server-rendered `router.refresh()` equivalent exists in the SPA, and
  // a full `navigate(0)` reload would drop WS state / scroll position for a
  // one-row change. Re-syncs whenever the parent page re-fetches (e.g. its
  // own effect re-running).
  const [items, setItems] = useState(booths);
  useEffect(() => setItems(booths), [booths]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const liveStatuses = useAdminBoothStatuses();

  async function handleDelete(b: Booth) {
    if (!confirm(`Hapus booth "${b.name}"? Tindakan tidak bisa dibatalkan.`)) return;
    setDeletingId(b.id);
    try {
      const res = await fetch(`/api/booths/${b.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Gagal menghapus booth");
        return;
      }
      toast.success("Booth dihapus");
      setItems((prev) => prev.filter((x) => x.id !== b.id));
    } finally {
      setDeletingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
        <p className="text-sm font-medium text-brand-green-dark">Belum ada booth</p>
        <p className="text-sm text-muted-foreground">
          Tambah booth pertama untuk mulai konfigurasi photobooth.
        </p>
        <Button asChild variant="brand" className="mt-2">
          <Link to="/admin/booths/new">+ Booth Baru</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead className="hidden md:table-cell">Lokasi</TableHead>
            <TableHead>Harga</TableHead>
            <TableHead className="hidden lg:table-cell">Provider</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Live</TableHead>
            <TableHead className="hidden xl:table-cell">Dibuat</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((b) => {
            const live = liveStatuses[b.id];
            const everSeen = b.lastSeenAt != null;
            const liveBadge = !everSeen && !live ? (
              <Badge variant="outline">⚪ Belum connect</Badge>
            ) : live?.inSession ? (
              <Badge variant="warn">🟡 Sesi Aktif</Badge>
            ) : live?.online || live?.bridgeOnline ? (
              <Badge variant="success">🟢 Online</Badge>
            ) : (
              <Badge variant="destructive">🔴 Offline</Badge>
            );
            return (
            <TableRow key={b.id}>
              <TableCell>
                <div className="font-medium text-brand-green-dark">{b.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{b.id}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{b.location ?? "-"}</TableCell>
              <TableCell>{formatRupiah(b.defaultPrice)}</TableCell>
              <TableCell className="hidden lg:table-cell capitalize">{b.paymentProvider}</TableCell>
              <TableCell>
                {b.isActive ? (
                  <Badge variant="success">Aktif</Badge>
                ) : (
                  <Badge variant="secondary">Nonaktif</Badge>
                )}
              </TableCell>
              <TableCell>{liveBadge}</TableCell>
              <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                {formatDate(b.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label="Edit">
                    <Link to={`/admin/booths/${b.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus"
                    onClick={() => handleDelete(b)}
                    disabled={deletingId === b.id}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
