import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Frame } from "@capture/shared";
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
import { formatRupiah } from "@/lib/utils";
import { displayUrl } from "@/lib/storage/r2-client";

export type LibraryFrame = Frame & { booths: Array<{ id: string; name: string; price: number }> };

export function FrameList({ frames }: { frames: LibraryFrame[] }) {
  // Local copy so a delete can drop the row in place instead of a full
  // `navigate(0)` reload — see BoothList for the same pattern/rationale.
  const [items, setItems] = useState(frames);
  useEffect(() => setItems(frames), [frames]);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(f: LibraryFrame) {
    if (f.booths.length) {
      toast.error(`Frame masih dipakai di ${f.booths.map((b) => b.name).join(", ")}. Lepas dulu dari booth itu.`);
      return;
    }
    if (!confirm(`Hapus frame "${f.name}" dari library? Tindakan ini tidak bisa dibatalkan.`)) return;
    setDeletingId(f.id);
    try {
      const res = await fetch(`/api/frames/${f.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Gagal menghapus frame");
        return;
      }
      toast.success("Frame dihapus");
      setItems((prev) => prev.filter((x) => x.id !== f.id));
    } finally {
      setDeletingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
        <p className="text-sm font-medium text-brand-green-dark">Library masih kosong</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Cara tercepat: buka booth, tab Frame &amp; Harga, lalu Unggah frame baru. Frame otomatis masuk ke sini.
        </p>
        <Button asChild variant="brand" className="mt-2">
          <Link to="/admin/booths">Buka Booth</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Preview</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Dipakai di</TableHead>
            <TableHead className="hidden md:table-cell">Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((f) => (
            <TableRow key={f.id} className={f.isActive ? "" : "bg-muted/30 text-muted-foreground"}>
              <TableCell>
                {f.previewUrl ? (
                  <div className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted">
                    <img src={displayUrl(f.previewUrl)} alt={f.name} className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="h-12 w-12 rounded-md border bg-muted" />
                )}
              </TableCell>
              <TableCell>
                <div className="font-medium text-brand-green-dark">{f.name}</div>
                <div className="text-xs capitalize text-muted-foreground">{f.tier}</div>
              </TableCell>
              <TableCell>
                {f.booths.length ? (
                  <ul className="space-y-0.5 text-sm">
                    {f.booths.map((b) => (
                      <li key={b.id}>
                        <Link to={`/admin/booths/${b.id}?tab=frame`} className="hover:underline">
                          {b.name}
                        </Link>{" "}
                        <span className="font-medium tabular-nums">· {formatRupiah(b.price)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sm text-muted-foreground">Belum dipasang</span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {f.isActive ? (
                  <Badge variant="success">Aktif</Badge>
                ) : (
                  <Badge variant="warn">Diarsipkan · tidak tampil</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label={`Edit desain ${f.name}`} title="Edit desain">
                    <Link to={`/admin/frames/${f.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Hapus ${f.name}`}
                    title={f.booths.length ? "Lepas dari semua booth dulu" : "Hapus dari library"}
                    onClick={() => handleDelete(f)}
                    disabled={deletingId === f.id}
                  >
                    <Trash2 className={f.booths.length ? "h-4 w-4 text-muted-foreground" : "h-4 w-4 text-destructive"} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
