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

export function FrameList({
  frames,
  boothNames,
}: {
  frames: Frame[];
  boothNames: Record<string, string>;
}) {
  // Local copy so a delete can drop the row in place instead of a full
  // `navigate(0)` reload — see BoothList for the same pattern/rationale.
  const [items, setItems] = useState(frames);
  useEffect(() => setItems(frames), [frames]);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(f: Frame) {
    if (!confirm(`Hapus frame "${f.name}"?`)) return;
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
        <p className="text-sm font-medium text-brand-green-dark">Belum ada frame</p>
        <p className="text-sm text-muted-foreground">
          Tambah frame pertama dengan PNG background dan logo opsional.
        </p>
        <Button asChild variant="brand" className="mt-2">
          <Link to="/admin/frames/new">+ Frame Baru</Link>
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
            <TableHead className="hidden md:table-cell">Tier</TableHead>
            <TableHead>Harga</TableHead>
            <TableHead className="hidden lg:table-cell">Booth</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((f) => (
            <TableRow key={f.id}>
              <TableCell>
                {f.previewUrl ? (
                  <div className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted">
                    <img
                      src={displayUrl(f.previewUrl)}
                      alt={f.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="h-12 w-12 rounded-md border bg-muted" />
                )}
              </TableCell>
              <TableCell>
                <div className="font-medium text-brand-green-dark">{f.name}</div>
                {f.isDefault ? (
                  <Badge variant="warn" className="mt-1 text-[10px]">
                    Default
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="hidden md:table-cell capitalize">{f.tier}</TableCell>
              <TableCell>{formatRupiah(f.price)}</TableCell>
              <TableCell className="hidden lg:table-cell text-sm">
                {f.boothId ? boothNames[f.boothId] ?? f.boothId : "All Booths"}
              </TableCell>
              <TableCell>
                {f.isActive ? (
                  <Badge variant="success">Aktif</Badge>
                ) : (
                  <Badge variant="secondary">Nonaktif</Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label="Edit">
                    <Link to={`/admin/frames/${f.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus"
                    onClick={() => handleDelete(f)}
                    disabled={deletingId === f.id}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
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
