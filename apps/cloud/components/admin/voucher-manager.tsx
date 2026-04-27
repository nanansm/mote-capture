"use client";

import { useMemo, useState } from "react";
import { Download, Plus, Search, Ticket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatRupiah } from "@/lib/utils";

type VoucherType = "payment" | "discount";
type VoucherStatus = "active" | "used" | "expired" | "disabled";

export type VoucherDto = {
  id: string;
  code: string;
  type: VoucherType;
  value: number;
  limit: number;
  usedCount: number;
  status: VoucherStatus;
  customerName: string | null;
  customerEmail: string | null;
  customerWhatsapp: string | null;
  batchId: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  type: VoucherType;
  limit: number;
  count: number;
  value: number;
  customerName: string;
  customerEmail: string;
  customerWhatsapp: string;
};

const PAGE_SIZE = 10;

const DEFAULT_FORM: FormState = {
  type: "payment",
  limit: 1,
  count: 1,
  value: 30000,
  customerName: "",
  customerEmail: "",
  customerWhatsapp: "",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VoucherManager({ initial }: { initial: VoucherDto[] }) {
  const [vouchers, setVouchers] = useState<VoucherDto[]>(initial);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [searchPayment, setSearchPayment] = useState("");
  const [searchDiscount, setSearchDiscount] = useState("");
  const [pagePayment, setPagePayment] = useState(1);
  const [pageDiscount, setPageDiscount] = useState(1);

  const paymentVouchers = useMemo(
    () => vouchers.filter((v) => v.type === "payment"),
    [vouchers],
  );
  const discountVouchers = useMemo(
    () => vouchers.filter((v) => v.type === "discount"),
    [vouchers],
  );

  function refresh() {
    void fetch("/api/admin/voucher/list")
      .then((r) => r.json())
      .then((data: { payment: VoucherDto[]; discount: VoucherDto[] }) => {
        setVouchers([...(data.payment ?? []), ...(data.discount ?? [])]);
      })
      .catch(() => undefined);
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        value: Number(form.value),
        limit: Number(form.limit),
        count: Number(form.count),
      };
      // Customer fields only attach to single-voucher generations (matches
      // the API contract — bulk batches drop them anyway).
      if (form.count === 1) {
        if (form.customerName.trim()) payload.customerName = form.customerName.trim();
        if (form.customerEmail.trim()) payload.customerEmail = form.customerEmail.trim();
        if (form.customerWhatsapp.trim()) payload.customerWhatsapp = form.customerWhatsapp.trim();
      }

      const res = await fetch("/api/admin/voucher/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        count?: number;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        toast.error(body.message ?? body.error ?? "Gagal generate voucher");
        return;
      }
      toast.success(`${body.count} voucher berhasil dibuat`);
      setForm({ ...DEFAULT_FORM, type: form.type, value: form.value, limit: form.limit, count: form.count });
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal generate");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete(id: string, code: string) {
    if (!confirm(`Hapus voucher ${code}?`)) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/voucher/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        toast.error(body.message ?? "Gagal menghapus");
        return;
      }
      toast.success(`Voucher ${code} dinonaktifkan`);
      refresh();
    } finally {
      setDeleting(null);
    }
  }

  async function handleExport(type: VoucherType) {
    const url = `/api/admin/voucher/export?type=${type}`;
    // Trigger download via anchor — simpler than blob URL handling.
    const a = document.createElement("a");
    a.href = url;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Voucher</h2>
        <p className="text-sm text-muted-foreground">
          Generate voucher pembayaran (full nominal) atau diskon (%) untuk redemption di kiosk.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <FormCard
          form={form}
          setForm={setForm}
          generating={generating}
          onGenerate={handleGenerate}
        />

        <div className="space-y-6 lg:col-span-2">
          <VoucherTable
            title="Daftar Voucher Pembayaran"
            description="Voucher full payment menutup seluruh nominal sesi (atau sebagian, sisanya tetap di-mark paid pada Sprint 1.5)."
            vouchers={paymentVouchers}
            search={searchPayment}
            setSearch={setSearchPayment}
            page={pagePayment}
            setPage={setPagePayment}
            badgeClass="bg-emerald-100 text-emerald-700"
            valueColumn="amount"
            onDelete={handleDelete}
            onExport={() => handleExport("payment")}
            deletingId={deleting}
          />

          <VoucherTable
            title="Daftar Voucher Diskon"
            description="Voucher diskon mengurangi nominal sesi sesuai persentase. Sprint 3 akan route sisa pembayaran ke QRIS."
            vouchers={discountVouchers}
            search={searchDiscount}
            setSearch={setSearchDiscount}
            page={pageDiscount}
            setPage={setPageDiscount}
            badgeClass="bg-orange-100 text-orange-700"
            valueColumn="percent"
            onDelete={handleDelete}
            onExport={() => handleExport("discount")}
            deletingId={deleting}
          />
        </div>
      </div>
    </div>
  );
}

function FormCard({
  form,
  setForm,
  generating,
  onGenerate,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  generating: boolean;
  onGenerate: () => void;
}) {
  const valueLabel = form.type === "payment" ? "Nominal (Rp)" : "Persentase Diskon (%)";
  const valueMin = form.type === "discount" ? 1 : 1000;
  const valueMax = form.type === "discount" ? 100 : 100_000_000;

  return (
    <div className="rounded-2xl border border-brand-green-dark/10 bg-white p-6 shadow-sm lg:sticky lg:top-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-brand-green-dark">Buat Voucher</h3>
        <span className="rounded-full bg-brand-cream px-3 py-1 text-xs font-semibold text-brand-green-dark">
          {form.count} voucher
        </span>
      </div>

      <div className="space-y-5">
        <div>
          <Label className="mb-2 block">Jenis</Label>
          <div className="flex gap-4 text-sm">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="voucher-type"
                value="payment"
                checked={form.type === "payment"}
                onChange={() => setForm({ ...form, type: "payment", value: 30000 })}
              />
              <span
                className={cn(
                  "font-semibold",
                  form.type === "payment" ? "text-emerald-700" : "text-muted-foreground",
                )}
              >
                Pembayaran
              </span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="voucher-type"
                value="discount"
                checked={form.type === "discount"}
                onChange={() => setForm({ ...form, type: "discount", value: 20 })}
              />
              <span
                className={cn(
                  "font-semibold",
                  form.type === "discount" ? "text-orange-600" : "text-muted-foreground",
                )}
              >
                Diskon
              </span>
            </label>
          </div>
        </div>

        <div>
          <Label htmlFor="voucher-limit" className="mb-2 block">
            Limit pemakaian per voucher
          </Label>
          <Input
            id="voucher-limit"
            type="number"
            min={0}
            value={form.limit}
            onChange={(e) => setForm({ ...form, limit: Number(e.target.value) || 0 })}
          />
          <p className="mt-1 text-xs text-muted-foreground">0 = unlimited</p>
        </div>

        <div>
          <Label htmlFor="voucher-count" className="mb-2 block">
            Jumlah voucher dibuat
          </Label>
          <Input
            id="voucher-count"
            type="number"
            min={1}
            max={1000}
            value={form.count}
            onChange={(e) => setForm({ ...form, count: Number(e.target.value) || 1 })}
          />
          <p className="mt-1 text-xs text-muted-foreground">Batch max 1000</p>
        </div>

        <div>
          <Label htmlFor="voucher-value" className="mb-2 block">
            {valueLabel}
          </Label>
          <Input
            id="voucher-value"
            type="number"
            min={valueMin}
            max={valueMax}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: Number(e.target.value) || 0 })}
          />
          {form.type === "payment" ? (
            <p className="mt-1 text-xs text-muted-foreground">{formatRupiah(form.value || 0)}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-dashed border-brand-green-dark/20 p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Opsional (untuk single voucher)
          </p>
          <div className="space-y-3">
            <div>
              <Label htmlFor="voucher-name" className="mb-1 block text-xs">
                Nama
              </Label>
              <Input
                id="voucher-name"
                placeholder="Customer"
                disabled={form.count > 1}
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="voucher-email" className="mb-1 block text-xs">
                Email
              </Label>
              <Input
                id="voucher-email"
                type="email"
                placeholder="customer@gmail.com"
                disabled={form.count > 1}
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="voucher-wa" className="mb-1 block text-xs">
                WhatsApp
              </Label>
              <Input
                id="voucher-wa"
                placeholder="08123456789"
                disabled={form.count > 1}
                value={form.customerWhatsapp}
                onChange={(e) => setForm({ ...form, customerWhatsapp: e.target.value })}
              />
            </div>
          </div>
        </div>

        <Button onClick={onGenerate} disabled={generating} className="w-full" variant="brand" size="lg">
          {generating ? (
            "Membuat..."
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Generate {form.count} Voucher
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function VoucherTable({
  title,
  description,
  vouchers,
  search,
  setSearch,
  page,
  setPage,
  badgeClass,
  valueColumn,
  onDelete,
  onExport,
  deletingId,
}: {
  title: string;
  description: string;
  vouchers: VoucherDto[];
  search: string;
  setSearch: (v: string) => void;
  page: number;
  setPage: (n: number) => void;
  badgeClass: string;
  valueColumn: "amount" | "percent";
  onDelete: (id: string, code: string) => void;
  onExport: () => void;
  deletingId: string | null;
}) {
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vouchers;
    return vouchers.filter((v) => {
      return (
        v.code.toLowerCase().includes(q) ||
        (v.customerName ?? "").toLowerCase().includes(q) ||
        (v.customerEmail ?? "").toLowerCase().includes(q) ||
        (v.batchId ?? "").toLowerCase().includes(q)
      );
    });
  }, [vouchers, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="rounded-2xl border border-brand-green-dark/10 bg-white p-6 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-brand-green-dark">
          <Ticket className="h-5 w-5" />
          {title}
        </h3>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">{description}</p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari kode, nama, atau batch..."
          className="pl-9"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-brand-green-dark/10 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 px-2 text-left font-medium">Code</th>
              <th className="py-2 px-2 text-left font-medium">
                {valueColumn === "percent" ? "Diskon" : "Nominal"}
              </th>
              <th className="py-2 px-2 text-left font-medium">Customer</th>
              <th className="py-2 px-2 text-left font-medium">WhatsApp</th>
              <th className="py-2 px-2 text-left font-medium">Limit</th>
              <th className="py-2 px-2 text-left font-medium">Used</th>
              <th className="py-2 px-2 text-left font-medium">Status</th>
              <th className="py-2 px-2 text-left font-medium">Dibuat</th>
              <th className="py-2 px-2 text-left font-medium">Admin</th>
              <th className="py-2 px-2 text-right font-medium">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td className="py-6 text-center text-muted-foreground" colSpan={10}>
                  Belum ada voucher.
                </td>
              </tr>
            ) : (
              paged.map((v) => (
                <tr key={v.id} className="border-b border-brand-green-dark/5 hover:bg-muted/30">
                  <td className="px-2 py-3">
                    <span
                      className={cn(
                        "rounded-md px-2 py-1 font-mono text-xs font-semibold",
                        badgeClass,
                      )}
                    >
                      {v.code}
                    </span>
                  </td>
                  <td className="px-2 py-3 font-semibold">
                    {valueColumn === "percent" ? `${v.value}%` : formatRupiah(v.value)}
                  </td>
                  <td className="px-2 py-3 text-muted-foreground">
                    {v.customerName ?? (v.batchId ? "Batch" : "-")}
                  </td>
                  <td className="px-2 py-3 text-muted-foreground">{v.customerWhatsapp ?? "-"}</td>
                  <td className="px-2 py-3">{v.limit === 0 ? "∞" : v.limit}</td>
                  <td className="px-2 py-3">{v.usedCount}</td>
                  <td className="px-2 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-2 py-3 text-muted-foreground">{formatDateTime(v.createdAt)}</td>
                  <td className="px-2 py-3 text-muted-foreground">{v.createdBy ?? "-"}</td>
                  <td className="px-2 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      disabled={deletingId === v.id || v.status === "disabled"}
                      onClick={() => onDelete(v.id, v.code)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-1">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={cn(
                "min-w-[32px] rounded-md px-2 py-1 text-sm",
                p === page
                  ? "bg-brand-green-dark text-brand-yellow"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: VoucherStatus }) {
  const map: Record<VoucherStatus, string> = {
    active: "bg-emerald-100 text-emerald-700",
    used: "bg-gray-100 text-gray-600",
    expired: "bg-amber-100 text-amber-700",
    disabled: "bg-red-100 text-red-700",
  };
  const label: Record<VoucherStatus, string> = {
    active: "Active",
    used: "Used",
    expired: "Expired",
    disabled: "Disabled",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", map[status])}>
      {label[status]}
    </span>
  );
}
