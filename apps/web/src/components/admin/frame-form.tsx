import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Frame } from "@capture/shared";
import { FRAME_TIERS } from "@capture/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatRupiah } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { DEFAULT_LAYOUT_V2, isLayoutV2 } from "@capture/shared";
import { frameInputSchema, frameUpdateSchema } from "@/lib/validations/frame";
import { displayUrl, urlToKey } from "@/lib/storage/r2-client";

type Mode = "create" | "edit";

// Booth asal saat frame dibuat dari halaman booth: frame langsung dipasang
// di booth itu dengan harga yang diisi di sini.
export type TargetBooth = { id: string; name: string; defaultPrice: number };

function isoToInputDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function FrameForm({
  mode,
  initial,
  targetBooth,
}: {
  mode: Mode;
  initial?: Frame;
  targetBooth?: TargetBooth | null;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial?.name ?? "");
  const [tier, setTier] = useState<"regular" | "premium">(initial?.tier ?? "regular");
  const [price, setPrice] = useState<number>(targetBooth?.defaultPrice ?? FRAME_TIERS.regular.defaultPrice);
  const [backgroundUrl, setBackgroundUrl] = useState(initial?.backgroundUrl ?? "");
  // The R2 object *key* is what actually gets submitted to the server
  // (apps/api/src/lib/validations/frame.ts stores keys, not URLs) — derived
  // from the existing CDN URL in edit mode, or captured straight off the
  // upload response when a new file is chosen (see uploadImage below).
  const [backgroundKey, setBackgroundKey] = useState(
    initial?.backgroundUrl ? urlToKey(initial.backgroundUrl) : "",
  );
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");
  const [logoKey, setLogoKey] = useState(initial?.logoUrl ? urlToKey(initial.logoUrl) : "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [seasonStart, setSeasonStart] = useState(isoToInputDate(initial?.seasonStart));
  const [seasonEnd, setSeasonEnd] = useState(isoToInputDate(initial?.seasonEnd));
  const [submitting, setSubmitting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  // PRD bagian 8 #11: textarea tetap, prefill DEFAULT_LAYOUT_V2. Frame lama
  // (v1) ikut diprefill v2 karena v1 ditolak API dan tidak tampil di kiosk.
  const initialIsV1 = Boolean(initial?.layoutJson) && !isLayoutV2(initial?.layoutJson);
  const [layoutJsonText, setLayoutJsonText] = useState<string>(
    JSON.stringify(isLayoutV2(initial?.layoutJson) ? initial!.layoutJson : DEFAULT_LAYOUT_V2, null, 2),
  );
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const backTo = targetBooth ? `/admin/booths/${targetBooth.id}?tab=frame` : "/admin/frames";

  async function uploadImage(
    file: File,
    type: "backgrounds" | "logos",
  ): Promise<{ key: string; url: string } | null> {
    if (file.type !== "image/png") {
      toast.error("Hanya PNG yang diperbolehkan");
      return null;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ukuran maksimal 5MB");
      return null;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("type", type);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Gagal mengunggah");
      return null;
    }
    return { key: body.key as string, url: body.url as string };
  }

  async function handleBgChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBg(true);
    try {
      const result = await uploadImage(file, "backgrounds");
      if (result) {
        setBackgroundUrl(result.url);
        setBackgroundKey(result.key);
        toast.success("Background diunggah");
      }
    } finally {
      setUploadingBg(false);
      e.target.value = "";
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const result = await uploadImage(file, "logos");
      if (result) {
        setLogoUrl(result.url);
        setLogoKey(result.key);
        toast.success("Logo diunggah");
      }
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let layoutJson: unknown = undefined;
    if (layoutJsonText.trim()) {
      try {
        layoutJson = JSON.parse(layoutJsonText);
        setLayoutError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid JSON";
        setLayoutError(msg);
        toast.error("Layout JSON tidak valid: " + msg);
        return;
      }
    }
    const payload = {
      name: name.trim(),
      tier,
      ...(mode === "create" && targetBooth ? { price: Number(price), boothId: targetBooth.id } : {}),
      backgroundKey,
      logoKey: logoKey || null,
      previewKey: backgroundKey, // Sprint 1: preview = background
      isActive,
      seasonStart: seasonStart || null,
      seasonEnd: seasonEnd || null,
      layoutJson,
    };
    const parsed = (mode === "create" ? frameInputSchema : frameUpdateSchema).safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validasi gagal");
      return;
    }

    setSubmitting(true);
    try {
      const url = mode === "create" ? "/api/frames" : `/api/frames/${initial!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Gagal menyimpan frame");
        return;
      }
      toast.success(
        mode === "create"
          ? targetBooth
            ? `Frame dipasang di ${targetBooth.name} (${formatRupiah(Number(price))})`
            : "Frame masuk library. Pasang ke booth dari halaman booth."
          : "Frame diperbarui",
      );
      navigate(backTo);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-2">
            <Label htmlFor="name">
              Nama Frame <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lebaran 2026"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="tier">Kategori</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as "regular" | "premium")}>
                <SelectTrigger id="tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FRAME_TIERS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {mode === "create" && targetBooth ? (
              <div className="grid gap-2">
                <Label htmlFor="price">
                  Harga di {targetBooth.name} (Rp) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="price"
                  type="text"
                  inputMode="numeric"
                  className="tabular-nums"
                  value={price ? price.toLocaleString("id-ID") : ""}
                  onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, "").slice(0, 8) || "0"))}
                  required
                />
                <p className="text-xs text-muted-foreground">Khusus booth ini. Bisa diubah nanti di tab Frame &amp; Harga.</p>
              </div>
            ) : null}
          </div>
          {!targetBooth ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              Harga diatur per booth, di halaman <span className="font-medium">Booth → Frame &amp; Harga</span>.
            </p>
          ) : null}

          {/* Background upload */}
          <div className="grid gap-2">
            <Label htmlFor="bg">
              Background PNG <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <Upload className="h-4 w-4" />
                {uploadingBg ? "Mengunggah..." : "Pilih PNG"}
                <input
                  id="bg"
                  type="file"
                  accept="image/png"
                  className="sr-only"
                  onChange={handleBgChange}
                  disabled={uploadingBg}
                />
              </label>
              {backgroundUrl ? (
                <div className="flex items-center gap-3">
                  <div className="relative h-16 w-16 overflow-hidden rounded-md border bg-muted">
                    <img
                      src={displayUrl(backgroundUrl)}
                      alt="Background"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <span className="break-all font-mono text-xs text-muted-foreground">{backgroundUrl}</span>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Belum ada file. Maks 5MB, PNG.</span>
              )}
            </div>
          </div>

          {/* Logo upload */}
          <div className="grid gap-2">
            <Label htmlFor="logo">Logo PNG (opsional)</Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                <Upload className="h-4 w-4" />
                {uploadingLogo ? "Mengunggah..." : "Pilih PNG"}
                <input
                  id="logo"
                  type="file"
                  accept="image/png"
                  className="sr-only"
                  onChange={handleLogoChange}
                  disabled={uploadingLogo}
                />
              </label>
              {logoUrl ? (
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted">
                    <img
                      src={displayUrl(logoUrl)}
                      alt="Logo"
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLogoUrl("");
                      setLogoKey("");
                    }}
                  >
                    Hapus
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          {mode === "edit" ? (
          <div className="flex items-center justify-between rounded-md border border-input p-3">
            <div>
              <p className="text-sm font-medium">Aktif</p>
              <p className="text-xs text-muted-foreground">
                Matikan untuk mengarsipkan frame di semua booth sekaligus.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Frame aktif" />
          </div>
          ) : null}

          <div className="rounded-md border border-input p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setLayoutOpen((v) => !v)}
            >
              <div>
                <p className="text-sm font-medium">Layout v2 (4 foto, 4R portrait)</p>
                <p className="text-xs text-muted-foreground">
                  Kanvas 1200×1800, tepat 4 slot rasio 3:2. Kosongkan untuk pakai default.
                  {initialIsV1 ? " Frame ini masih layout lama (v1), tersembunyi di kiosk sampai disimpan dengan v2." : ""}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{layoutOpen ? "Tutup" : "Atur"}</span>
            </button>
            {layoutOpen ? (
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[200px] w-full rounded-md border border-input p-2 font-mono text-xs"
                  value={layoutJsonText}
                  onChange={(e) => setLayoutJsonText(e.target.value)}
                  placeholder={JSON.stringify(DEFAULT_LAYOUT_V2, null, 2)}
                  spellCheck={false}
                />
                {layoutError ? (
                  <p className="text-xs text-destructive">{layoutError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Schema: <code>version: 2</code>, <code>canvasWidth: 1200</code>,{" "}
                    <code>canvasHeight: 1800</code>, <code>slots[4]</code> (each: <code>x</code>,{" "}
                    <code>y</code>, <code>w</code>, <code>h</code>), <code>artworkKey</code>.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="seasonStart">Tampil mulai (opsional)</Label>
              <Input
                id="seasonStart"
                type="date"
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seasonEnd">Tampil sampai (opsional)</Label>
              <Input
                id="seasonEnd"
                type="date"
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(backTo)}
          disabled={submitting}
        >
          Batal
        </Button>
        <Button type="submit" variant="brand" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {mode === "create" ? (targetBooth ? "Simpan & pasang" : "Simpan ke library") : "Simpan"}
        </Button>
      </div>
    </form>
  );
}
