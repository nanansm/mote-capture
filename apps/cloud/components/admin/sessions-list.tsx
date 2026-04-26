"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SessionStatus } from "@capture/shared";
import { SESSION_STATUS, SESSION_STATUS_VARIANT } from "@capture/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/utils";

type Row = {
  id: string;
  boothId: string;
  boothName: string;
  status: SessionStatus;
  amount: number;
  customerEmail: string | null;
  customerPhone: string | null;
  createdAt: string;
};

const STATUS_OPTIONS: Array<{ value: "all" | SessionStatus; label: string }> = [
  { value: "all", label: "Semua Status" },
  { value: "payment", label: SESSION_STATUS.payment },
  { value: "paid", label: SESSION_STATUS.paid },
  { value: "capturing", label: SESSION_STATUS.capturing },
  { value: "processing", label: SESSION_STATUS.processing },
  { value: "done", label: SESSION_STATUS.done },
  { value: "expired", label: SESSION_STATUS.expired },
  { value: "failed", label: SESSION_STATUS.failed },
];

export function SessionsList({
  rows,
  booths,
}: {
  rows: Row[];
  booths: Array<{ id: string; name: string }>;
}) {
  const [boothFilter, setBoothFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (boothFilter !== "all" && r.boothId !== boothFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !r.id.toLowerCase().includes(q) && !(r.customerPhone ?? "").includes(q) && !(r.customerEmail ?? "").toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [rows, boothFilter, statusFilter, search]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="booth-filter">Booth</Label>
            <Select value={boothFilter} onValueChange={setBoothFilter}>
              <SelectTrigger id="booth-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Booth</SelectItem>
                {booths.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="status-filter">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger id="status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="search">Cari</Label>
            <Input
              id="search"
              placeholder="ID session, nomor HP, atau email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="flex items-center justify-center border-dashed py-16">
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? "Belum ada session." : "Tidak ada session cocok dengan filter."}
          </p>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead className="hidden md:table-cell">Booth</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden lg:table-cell">Customer</TableHead>
                <TableHead className="hidden xl:table-cell">Dibuat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{r.boothName}</TableCell>
                  <TableCell>
                    <Badge variant={SESSION_STATUS_VARIANT[r.status]}>
                      {SESSION_STATUS[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatRupiah(r.amount)}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                    {r.customerPhone ?? "—"}
                    {r.customerEmail ? ` · ${r.customerEmail}` : ""}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/sessions/${r.id}`}>Detail</Link>
                    </Button>
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
