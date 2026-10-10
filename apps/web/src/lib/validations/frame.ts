import { z } from "zod";
import { validateLayoutV2, type FrameLayoutV2 } from "@capture/shared";

// Pra-validasi klien, satu sumber aturan dengan API (PRD bagian 8 #11):
// layout wajib v2 (1200×1800, 4 slot), dicek `validateLayoutV2` dari shared.
export const frameLayoutSchema = z.unknown().superRefine((v, ctx) => {
  const errs = validateLayoutV2(v);
  if (errs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Layout tidak valid: ${errs.join("; ")}` });
}) as unknown as z.ZodType<FrameLayoutV2>;

export type FrameLayoutInput = FrameLayoutV2;

// Field names here match apps/api/src/lib/validations/frame.ts
// (`backgroundKey`/`logoKey`/`previewKey`, not `*Url`): D1 stores the R2
// object key, not an absolute CDN URL, and the upload endpoint
// (POST /api/upload) hands back `{ key, url }` — `key` is what actually
// gets submitted to POST/PATCH /api/frames. This schema is client-side
// pre-validation only (never sent to the server itself), but its field
// names need to match the payload FrameForm builds so `safeParse` sees the
// same shape it's about to POST.
export const frameInputSchema = z.object({
  name: z.string().min(1, "Nama frame wajib diisi").max(120),
  tier: z.enum(["regular", "premium"], {
    errorMap: () => ({ message: "Tier tidak valid" }),
  }),
  // Hanya saat dibuat dari halaman booth; harga tersimpan per booth.
  price: z
    .number({ invalid_type_error: "Harga harus berupa angka" })
    .int("Harga harus bilangan bulat")
    .min(1000, "Harga minimal Rp1.000")
    .max(10_000_000, "Harga terlalu besar")
    .optional(),
  backgroundKey: z.string().min(1, "Background PNG wajib diunggah"),
  logoKey: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  previewKey: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  boothId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  seasonStart: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  seasonEnd: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  sortOrder: z
    .number({ invalid_type_error: "Sort order harus berupa angka" })
    .int()
    .min(0)
    .default(0),
  layoutJson: frameLayoutSchema.optional().nullable(),
});

export const frameUpdateSchema = frameInputSchema.partial();
export type FrameInputForm = z.infer<typeof frameInputSchema>;
