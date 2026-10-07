// Ported from apps/cloud/lib/validations/frame.ts. The three `*Url` input
// fields are renamed to `*Key` here: D1 stores the R2 object key, not an
// absolute URL (see apps/api/src/db/schema.ts — frames.backgroundKey /
// logoKey / previewKey). Callers (the upload route) already hand back a
// `key` from R2, so this is what the frame-create/update form actually has
// on hand.
import { z } from "zod";
import { validateLayoutV2, type FrameLayoutV2 } from "@capture/shared";

// PRD bagian 8 #11. Layout v1 (strip 2×3, 1800×1200) hanya ada di baris D1
// lama; tidak pernah diterima lagi lewat API. Frame baru/ubah layout wajib v2
// (1200×1800, 4 slot) dan divalidasi satu sumber: `validateLayoutV2` di shared,
// yang juga dipakai booth-agent saat compose. Kiosk menyaring frame v1.
export const frameLayoutSchema = z.unknown().superRefine((v, ctx) => {
  const errs = validateLayoutV2(v);
  if (errs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Layout tidak valid: ${errs.join("; ")}` });
}) as unknown as z.ZodType<FrameLayoutV2>;

export type FrameLayoutInput = FrameLayoutV2;

export const frameInputSchema = z.object({
  name: z.string().min(1, "Nama frame wajib diisi").max(120),
  tier: z.enum(["regular", "premium"], {
    errorMap: () => ({ message: "Tier tidak valid" }),
  }),
  price: z
    .number({ invalid_type_error: "Harga harus berupa angka" })
    .int("Harga harus bilangan bulat")
    .min(1000, "Harga minimal Rp1.000"),
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
  isActive: z.boolean(),
  isDefault: z.boolean(),
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
export type FrameUpdateForm = z.infer<typeof frameUpdateSchema>;
