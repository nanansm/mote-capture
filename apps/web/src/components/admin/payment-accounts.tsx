import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { del, get, patch, post } from "@/lib/api";

export type ProviderName = "xendit" | "ipaymu" | "doku";
export type Mode = "production" | "sandbox";

export type PaymentAccount = {
  id: string;
  name: string;
  provider: ProviderName;
  mode: Mode;
  masked: Record<string, string>;
  unreadable: boolean;
  complete: boolean;
  webhookUrl: string;
  lastTest: { at: string | number; ok: boolean; message: string } | null;
  usedBy: { id: string; name: string }[];
};

type ListResponse = { data: PaymentAccount[]; meta: { encryptionConfigured: boolean } };

// Satu sumber teks bantuan per provider; dipakai form dan kartu.
const PROVIDERS: Record<
  ProviderName,
  {
    label: string;
    dashboard: string;
    fields: { key: string; label: string; secret: boolean; placeholder: string; hint: string }[];
  }
> = {
  xendit: {
    label: "Xendit",
    dashboard: "https://dashboard.xendit.co",
    fields: [
      {
        key: "secretKey",
        label: "Secret Key",
        secret: true,
        placeholder: "xnd_production_…",
        hint: "Dashboard Xendit → Settings → API Keys → Generate secret key (izin Money-in: Write).",
      },
      {
        key: "webhookToken",
        label: "Webhook Verification Token",
        secret: true,
        placeholder: "token dari halaman Webhooks",
        hint: "Dashboard Xendit → Settings → Webhooks → View Webhook Verification Token.",
      },
    ],
  },
  ipaymu: {
    label: "iPaymu",
    dashboard: "https://my.ipaymu.com",
    fields: [
      {
        key: "va",
        label: "Nomor VA",
        secret: false,
        placeholder: "1179xxxxxxxxxxxx",
        hint: "Angka saja. Dashboard iPaymu → Integrasi → API Key.",
      },
      {
        key: "apiKey",
        label: "API Key",
        secret: true,
        placeholder: "API key iPaymu",
        hint: "Di halaman yang sama dengan Nomor VA. Sandbox dan production beda key.",
      },
    ],
  },
  doku: {
    label: "DOKU",
    dashboard: "https://dashboard.doku.com",
    fields: [
      {
        key: "clientId",
        label: "Client ID",
        secret: false,
        placeholder: "BRN-0000-0000000000000",
        hint: "Back Office DOKU → Integrations → API Keys. Sandbox dan production beda Client ID.",
      },
      {
        key: "dokuSecretKey",
        label: "Active Secret Key",
        secret: true,
        placeholder: "SK-…",
        hint: "Di halaman yang sama, kolom Active Secret Key (diawali SK-). Bukan RSA key.",
      },
    ],
  },
};

// Back Office DOKU beda alamat untuk sandbox dan production.
const DOKU_DASHBOARD: Record<Mode, string> = {
  production: "https://dashboard.doku.com/bo/login",
  sandbox: "https://sandbox.doku.com/bo/login",
};

function dashboardUrl(a: Pick<PaymentAccount, "provider" | "mode">) {
  return a.provider === "doku" ? DOKU_DASHBOARD[a.mode] : PROVIDERS[a.provider].dashboard;
}

export const providerLabel = (p: ProviderName) => PROVIDERS[p]?.label ?? p;

export function accountStatus(a: PaymentAccount): { label: string; variant: "success" | "outline" | "destructive" } {
  if (a.unreadable || !a.complete) return { label: "Belum lengkap", variant: "destructive" };
  if (!a.lastTest) return { label: "Belum dites", variant: "outline" };
  return a.lastTest.ok ? { label: "Terhubung", variant: "success" } : { label: "Tes gagal", variant: "destructive" };
}

export function usePaymentAccounts() {
  const [accounts, setAccounts] = useState<PaymentAccount[] | null>(null);
  const [encryptionConfigured, setEnc] = useState(true);
  const load = useCallback(
    () =>
      get<ListResponse>("/payment-accounts")
        .then((r) => {
          setAccounts(r.data);
          setEnc(r.meta.encryptionConfigured);
        })
        .catch(() => setAccounts([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return { accounts, encryptionConfigured, reload: load };
}

function CopyBox({ value }: { value: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="block flex-1 break-all rounded-md border border-input bg-muted/40 p-2 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast.success("URL disalin");
        }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---- Form tambah/edit -------------------------------------------------------

function AccountDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PaymentAccount | null;
  onSaved: (a: PaymentAccount) => void;
}) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<ProviderName>("xendit");
  const [mode, setMode] = useState<Mode>("production");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setProvider(editing?.provider ?? "xendit");
    setMode(editing?.mode ?? "production");
    setSecrets({});
    setReveal(false);
  }, [open, editing]);

  const def = PROVIDERS[provider];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nama akun wajib diisi");
    setSaving(true);
    try {
      const trimmed = Object.fromEntries(def.fields.map((f) => [f.key, (secrets[f.key] ?? "").trim()]));
      const res = editing
        ? await patch<{ data: PaymentAccount }>(`/payment-accounts/${editing.id}`, {
            name: name.trim(),
            mode,
            secrets: trimmed,
          })
        : await post<{ data: PaymentAccount }>("/payment-accounts", {
            name: name.trim(),
            provider,
            mode,
            secrets: trimmed,
          });
      toast.success(
        editing
          ? "Akun diperbarui"
          : provider === "doku"
            ? "Akun dibuat. Salin Notification URL di kartu akun ke Back Office DOKU, lalu klik Tes koneksi."
            : "Akun dibuat. Klik Tes koneksi untuk memastikan.",
      );
      onSaved(res.data);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Tambah akun pembayaran"}</DialogTitle>
            <DialogDescription>
              Satu akun bisa dipakai beberapa booth. Key disimpan terenkripsi dan tidak bisa dilihat lagi
              setelah disimpan.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="acc-name">Nama akun</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="contoh: iPaymu smnanan, DOKU Maja"
              maxLength={80}
            />
          </div>

          <div className="grid gap-2">
            <Label>Provider</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PROVIDERS) as ProviderName[]).map((p) => (
                <Button
                  key={p}
                  type="button"
                  variant={provider === p ? "brand" : "outline"}
                  disabled={Boolean(editing) && editing!.provider !== p}
                  onClick={() => {
                    setProvider(p);
                    setSecrets({});
                  }}
                >
                  {PROVIDERS[p].label}
                </Button>
              ))}
            </div>
            {provider === "doku" && !editing ? (
              <p className="text-xs text-muted-foreground">
                Setelah disimpan, kartu akun menampilkan <b>Notification URL</b>. Tempel URL itu di Back Office DOKU
                supaya pembayaran langsung terdeteksi.
              </p>
            ) : null}
            {editing ? (
              <p className="text-xs text-muted-foreground">
                Provider tidak bisa diganti. Buat akun baru kalau mau pindah provider.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={mode === "production" ? "brand" : "outline"} onClick={() => setMode("production")}>
                Production (uang asli)
              </Button>
              <Button type="button" variant={mode === "sandbox" ? "brand" : "outline"} onClick={() => setMode("sandbox")}>
                Sandbox (uji coba)
              </Button>
            </div>
          </div>

          {def.fields.map((f) => {
            const current = editing?.masked?.[f.key];
            return (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`acc-${f.key}`}>{f.label}</Label>
                <Input
                  id={`acc-${f.key}`}
                  type={f.secret && !reveal ? "password" : "text"}
                  inputMode={f.key === "va" ? "numeric" : undefined}
                  autoComplete="off"
                  value={secrets[f.key] ?? ""}
                  onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder={editing && current ? `Tersimpan: ${current} (kosongkan = tidak diubah)` : f.placeholder}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            );
          })}

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
            Tampilkan key yang sedang diketik (cek salah tempel)
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" variant="brand" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Kartu per akun ---------------------------------------------------------

function AccountCard({
  account,
  onEdit,
  onChanged,
}: {
  account: PaymentAccount;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const status = accountStatus(account);

  async function test() {
    setTesting(true);
    try {
      const r = await post<{ success: boolean; message: string }>(`/payment-accounts/${account.id}/test`);
      if (r.success) toast.success(r.message);
      else toast.error(r.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal tes");
    } finally {
      setTesting(false);
      onChanged();
    }
  }

  async function remove() {
    if (account.usedBy.length) {
      toast.error(`Masih dipakai: ${account.usedBy.map((b) => b.name).join(", ")}. Ganti akun di booth itu dulu.`);
      return;
    }
    if (!confirm(`Hapus akun "${account.name}"? Key-nya ikut terhapus.`)) return;
    try {
      await del(`/payment-accounts/${account.id}`);
      toast.success("Akun dihapus");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus");
    }
  }

  return (
    <Card data-testid={`account-${account.id}`}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{account.name}</p>
            <p className="text-xs text-muted-foreground">
              {providerLabel(account.provider)} · {account.mode === "production" ? "Production" : "Sandbox"}
            </p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        <div className="grid gap-1 text-xs">
          {PROVIDERS[account.provider].fields.map((f) => (
            <div key={f.key} className="flex gap-2">
              <span className="w-40 shrink-0 text-muted-foreground">{f.label}</span>
              <span className="font-mono">{account.masked[f.key] || "—"}</span>
            </div>
          ))}
          <div className="flex gap-2">
            <span className="w-40 shrink-0 text-muted-foreground">Dipakai booth</span>
            <span>
              {account.usedBy.length
                ? account.usedBy.map((b, i) => (
                    <span key={b.id}>
                      {i ? ", " : ""}
                      <Link className="underline" to={`/admin/booths/${b.id}`}>
                        {b.name}
                      </Link>
                    </span>
                  ))
                : "belum ada"}
            </span>
          </div>
          {account.lastTest ? (
            <div className="flex items-start gap-2">
              <span className="w-40 shrink-0 text-muted-foreground">Tes terakhir</span>
              <span className="flex items-start gap-1">
                {account.lastTest.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-brand-green-light" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 text-destructive" />
                )}
                {account.lastTest.message}
              </span>
            </div>
          ) : null}
        </div>

        {account.unreadable ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            Key tersimpan tidak bisa dibaca (kunci enkripsi server berubah). Klik Edit lalu isi ulang semua key.
          </p>
        ) : null}

        {account.provider === "xendit" ? (
          <div className="space-y-1 text-xs">
            <p>
              Tempel URL ini di Dashboard Xendit → Settings → Webhooks, kolom <b>QR code paid</b> (event{" "}
              <code>qr.payment</code>):
            </p>
            <CopyBox value={account.webhookUrl} />
          </div>
        ) : account.provider === "doku" ? (
          <div className="space-y-2 rounded-md border border-dashed p-3 text-xs" data-testid="doku-notify">
            <p className="font-medium">Wajib sekali: pasang Notification URL di DOKU</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Buka{" "}
                <a className="underline" href={dashboardUrl(account)} target="_blank" rel="noreferrer">
                  Back Office DOKU {account.mode === "sandbox" ? "Sandbox" : "Production"}
                </a>
                , menu <b>Settings → Payment Settings</b>, pilih <b>QRIS</b>.
              </li>
              <li>Salin URL di bawah, tempel di kolom <b>Notification URL</b>, lalu Simpan.</li>
              <li>
                Kembali ke sini, klik <b>Tes koneksi</b> sampai status <b>Terhubung</b>.
              </li>
            </ol>
            <CopyBox value={account.webhookUrl} />
            {!account.webhookUrl.startsWith("https://") ? (
              <p className="rounded bg-amber-50 p-2 text-amber-900">
                Alamat ini belum HTTPS publik, jadi DOKU tidak bisa mengirim notifikasi ke sini. Normal di mode uji
                lokal; di server asli alamatnya otomatis jadi https://capture.motekreatif.com/...
              </p>
            ) : null}
            <p className="text-muted-foreground">
              Pelanggan bayar lewat halaman QRIS DOKU yang tampil di layar booth. Status bayar selalu dicek ulang ke
              DOKU sebelum sesi foto dibuka.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            iPaymu tidak perlu daftar webhook. Alamat notifikasi dikirim otomatis tiap QR dibuat, dan status bayar
            selalu dicek ulang ke iPaymu.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={test} disabled={testing || !account.complete}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Tes koneksi
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={dashboardUrl(account)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Dashboard {providerLabel(account.provider)}
            </a>
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={remove}>
            <Trash2 className="h-4 w-4" />
            Hapus
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Halaman ---------------------------------------------------------------

export function PaymentAccountsManager({ onChange }: { onChange?: () => void } = {}) {
  const { accounts, encryptionConfigured, reload: reloadOwn } = usePaymentAccounts();
  // Badge ringkasan di halaman Settings memakai hook terpisah; ikut di-refresh.
  const reload = useCallback(() => {
    onChange?.();
    return reloadOwn();
  }, [onChange, reloadOwn]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentAccount | null>(null);

  return (
    <div className="space-y-4">
      <details open={accounts !== null && accounts.length === 0} className="rounded-md border bg-muted/20 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Cara pakai (3 langkah)</summary>
        <div className="space-y-2 pt-2">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              <b>Tambah akun</b>: pilih Xendit, iPaymu, atau DOKU, tempel key dari dashboard provider.
            </li>
            <li>
              Klik <b>Tes koneksi</b> sampai status <b>Terhubung</b>.
            </li>
            <li>
              Buka{" "}
              <Link to="/admin/booths" className="underline">
                Booth
              </Link>
              , pilih booth, tab <b>Info &amp; Pembayaran</b>, pilih akun ini. Berlaku mulai sesi berikutnya.
            </li>
          </ol>
          <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Booth tanpa akun tetap bisa dipakai dengan voucher, tapi pembayaran QRIS ditolak.
          </p>
        </div>
      </details>

      {!encryptionConfigured ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Kunci enkripsi server (SETTINGS_ENC_KEY) belum diset. Akun tidak bisa disimpan sampai diset.
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          variant="brand"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          disabled={!encryptionConfigured}
        >
          <Plus className="h-4 w-4" />
          Tambah akun
        </Button>
      </div>

      {accounts === null ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            Belum ada akun pembayaran. Klik <b>Tambah akun</b>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onChanged={reload}
              onEdit={() => {
                setEditing(a);
                setOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <AccountDialog open={open} onOpenChange={setOpen} editing={editing} onSaved={() => void reload()} />
    </div>
  );
}
