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
import { Card, CardContent } from "@/components/ui/card";
import { frameInputSchema } from "@/lib/validations/frame";
import { displayUrl, urlToKey } from "@/lib/storage/r2-client";

type Mode = "create" | "edit";

type BoothOption = { id: string; name: string };

const NO_BOOTH = "__all__";

function isoToInputDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function FrameForm({
  mode,
  initial,
  booths,
}: {
  mode: Mode;
  initial?: Frame;
  booths: BoothOption[];
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(initial?.name ?? "");
  const [tier, setTier] = useState<"regular" | "premium">(initial?.tier ?? "regular");
  const [price, setPrice] = useState<number>(
    initial?.price ?? FRAME_TIERS.regular.defaultPrice,
  );
  const [overridePrice, setOverridePrice] = useState<boolean>(
    initial ? initial.price !== FRAME_TIERS[initial.tier].defaultPrice : false,
  );
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
  const [boothId, setBoothId] = useState<string>(initial?.boothId ?? NO_BOOTH);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [seasonStart, setSeasonStart] = useState(isoToInputDate(initial?.seasonStart));
  const [seasonEnd, setSeasonEnd] = useState(isoToInputDate(initial?.seasonEnd));
  const [sortOrder, setSortOrder] = useState<number>(initial?.sortOrder ?? 0);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [layoutJsonText, setLayoutJsonText] = useState<string>(
    initial?.layoutJson && Object.keys(initial.layoutJson).length > 0
      ? JSON.stringify(initial.layoutJson, null, 2)
      : "",
  );
  const [layoutError, setLayoutError] = useState<string | null>(null);

  function handleTierChange(v: "regular" | "premium") {
    setTier(v);
    if (!overridePrice) {
      setPrice(FRAME_TIERS[v].defaultPrice);
    }
  }

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
      price: Number(price),
      backgroundKey,
      logoKey: logoKey || null,
      previewKey: backgroundKey, // Sprint 1: preview = background
      boothId: boothId === NO_BOOTH ? null : boothId,
      isActive,
      isDefault,
      seasonStart: seasonStart || null,
      seasonEnd: seasonEnd || null,
      sortOrder: Number(sortOrder),
      layoutJson,
    };
    const parsed = frameInputSchema.safeParse(payload);
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
      toast.success(mode === "create" ? "Frame berhasil dibuat" : "Frame diperbarui");
      navigate("/admin/frames");
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
              <Label htmlFor="tier">Tier</Label>
              <Select
                value={tier}
                onValueChange={(v) => handleTierChange(v as "regular" | "premium")}
              >
                <SelectTrigger id="tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FRAME_TIERS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label} (Rp{v.defaultPrice.toLocaleString("id-ID")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="price">
                Harga (Rp) {overridePrice ? "" : <span className="text-muted-foreground text-xs">— mengikuti tier</span>}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="price"
                  type="number"
                  min={1000}
                  step={1000}
                  value={price}
                  disabled={!overridePrice}
                  onChange={(e) => setPrice(Number(e.target.value))}
                />
                <Switch checked={overridePrice} onCheckedChange={setOverridePrice} aria-label="Custom price" />
              </div>
            </div>
          </div>

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

          <div className="grid gap-2">
            <Label htmlFor="booth">Booth Target</Label>
            <Select value={boothId} onValueChange={setBoothId}>
              <SelectTrigger id="booth">
                <SelectValue placeholder="All Booths" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BOOTH}>All Booths</SelectItem>
                {booths.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Pilih booth tertentu untuk membatasi frame ini, atau biarkan All Booths.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-input p-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Tampilkan frame di kiosk.</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-input p-3">
              <div>
                <p className="text-sm font-medium">Default Frame</p>
                <p className="text-xs text-muted-foreground">Pilihan utama saat sesi baru.</p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          </div>

          <div className="rounded-md border border-input p-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setLayoutOpen((v) => !v)}
            >
              <div>
                <p className="text-sm font-medium">Layout Advanced (Bridge composer)</p>
                <p className="text-xs text-muted-foreground">
                  JSON kustom untuk composer bridge. Kosongkan untuk pakai Layout B default
                  (1800×1200, 2 strip identik).
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{layoutOpen ? "Hide" : "Show"}</span>
            </button>
            {layoutOpen ? (
              <div className="mt-3 grid gap-2">
                <textarea
                  className="min-h-[200px] w-full rounded-md border border-input p-2 font-mono text-xs"
                  value={layoutJsonText}
                  onChange={(e) => setLayoutJsonText(e.target.value)}
                  placeholder={`{\n  "canvasWidth": 1800,\n  "canvasHeight": 1200,\n  "stripCount": 2,\n  "cutLineX": 900,\n  "photoSlots": [\n    { "stripIndex": 0, "x": 65, "y": 80, "width": 770, "height": 320, "photoIndex": 0 },\n    ...\n  ]\n}`}
                  spellCheck={false}
                />
                {layoutError ? (
                  <p className="text-xs text-destructive">{layoutError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Schema: <code>canvasWidth</code>, <code>canvasHeight</code>,{" "}
                    <code>stripCount</code>, <code>cutLineX</code>,{" "}
                    <code>photoSlots[]</code> (each: <code>stripIndex</code>, <code>x</code>,{" "}
                    <code>y</code>, <code>width</code>, <code>height</code>,{" "}
                    <code>photoIndex</code>).
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="seasonStart">Season Start</Label>
              <Input
                id="seasonStart"
                type="date"
                value={seasonStart}
                onChange={(e) => setSeasonStart(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="seasonEnd">Season End</Label>
              <Input
                id="seasonEnd"
                type="date"
                value={seasonEnd}
                onChange={(e) => setSeasonEnd(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sortOrder">Sort Order</Label>
              <Input
                id="sortOrder"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate("/admin/frames")}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
