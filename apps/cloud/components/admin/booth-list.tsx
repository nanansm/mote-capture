"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

export function BoothList({ booths }: { booths: Booth[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  }

  if (booths.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
        <p className="text-sm font-medium text-brand-green-dark">Belum ada booth</p>
        <p className="text-sm text-muted-foreground">
          Tambah booth pertama untuk mulai konfigurasi photobooth.
        </p>
        <Button asChild variant="brand" className="mt-2">
          <Link href="/admin/booths/new">+ Booth Baru</Link>
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
            <TableHead className="hidden xl:table-cell">Dibuat</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {booths.map((b) => (
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
              <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                {formatDate(b.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button asChild variant="ghost" size="icon" aria-label="Edit">
                    <Link href={`/admin/booths/${b.id}`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Hapus"
                    onClick={() => handleDelete(b)}
                    disabled={pending || deletingId === b.id}
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
