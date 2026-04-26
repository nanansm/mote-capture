import { z } from "zod";

const photoSlotSchema = z.object({
  stripIndex: z.number().int().min(0),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  photoIndex: z.number().int().min(0).max(2),
});

export const frameLayoutSchema = z.object({
  canvasWidth: z.number().int().positive(),
  canvasHeight: z.number().int().positive(),
  photoSlots: z.array(photoSlotSchema).min(1),
  stripCount: z.number().int().min(1).max(4),
  cutLineX: z.number().int().min(0).optional(),
});

export type FrameLayoutInput = z.infer<typeof frameLayoutSchema>;

export const DEFAULT_LAYOUT_B: FrameLayoutInput = {
  canvasWidth: 1800,
  canvasHeight: 1200,
  photoSlots: [
    { stripIndex: 0, x: 65, y: 80, width: 770, height: 320, photoIndex: 0 },
    { stripIndex: 0, x: 65, y: 425, width: 770, height: 320, photoIndex: 1 },
    { stripIndex: 0, x: 65, y: 770, width: 770, height: 320, photoIndex: 2 },
    { stripIndex: 1, x: 965, y: 80, width: 770, height: 320, photoIndex: 0 },
    { stripIndex: 1, x: 965, y: 425, width: 770, height: 320, photoIndex: 1 },
    { stripIndex: 1, x: 965, y: 770, width: 770, height: 320, photoIndex: 2 },
  ],
  stripCount: 2,
  cutLineX: 900,
};

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
  layoutJson: frameLayoutSchema.optional().nullable(),
});

export const frameUpdateSchema = frameInputSchema.partial();
export type FrameInputForm = z.infer<typeof frameInputSchema>;
