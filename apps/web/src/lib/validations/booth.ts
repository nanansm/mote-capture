import { z } from "zod";

export const boothInputSchema = z.object({
  name: z.string().min(1, "Nama booth wajib diisi").max(120),
  location: z
    .string()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? null : v)),
  defaultPrice: z
    .number({ invalid_type_error: "Harga harus berupa angka" })
    .int("Harga harus bilangan bulat")
    .min(1000, "Harga minimal Rp1.000"),
  paymentProvider: z.enum(["ipaymu", "xendit"], {
    errorMap: () => ({ message: "Provider pembayaran tidak valid" }),
  }),
  isActive: z.boolean(),
});

export const boothUpdateSchema = boothInputSchema.partial().extend({
  regenerateBridgeToken: z.boolean().optional(),
});

export type BoothInputForm = z.infer<typeof boothInputSchema>;
