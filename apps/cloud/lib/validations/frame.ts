import { z } from "zod";

export const frameInputSchema = z.object({
  name: z.string().min(1, "Nama frame wajib diisi").max(120),
  tier: z.enum(["regular", "premium"], {
    errorMap: () => ({ message: "Tier tidak valid" }),
  }),
  price: z
    .number({ invalid_type_error: "Harga harus berupa angka" })
    .int("Harga harus bilangan bulat")
    .min(1000, "Harga minimal Rp1.000"),
  backgroundUrl: z.string().min(1, "Background PNG wajib diunggah"),
  logoUrl: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v)),
  previewUrl: z
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
});

export const frameUpdateSchema = frameInputSchema.partial();
export type FrameInputForm = z.infer<typeof frameInputSchema>;
