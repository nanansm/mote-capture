import { z } from "zod";

export const kioskHelloSchema = z.object({
  boothId: z.string().min(1),
  language: z.enum(["id", "en"]).optional(),
});

export const frameSelectedSchema = z.object({
  frameId: z.string().min(1),
});

export const confirmAndPaySchema = z.object({
  boothId: z.string().min(1),
  frameId: z.string().min(1).optional(),
});

export const startCaptureSchema = z.object({
  sessionId: z.string().min(1),
});

export const cancelSchema = z.object({
  sessionId: z.string().min(1).optional(),
  reason: z.string().optional(),
});

export const submitContactSchema = z.object({
  sessionId: z.string().min(1),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional().or(z.literal("")),
});

// Bridge → Cloud
export const bridgeHelloSchema = z.object({
  boothId: z.string().min(1),
  version: z.string().optional(),
});

export const photoUploadedSchema = z.object({
  sessionId: z.string().min(1),
  index: z.number().int().min(1).max(3),
  url: z.string().min(1),
});

export const compositeUploadedSchema = z.object({
  sessionId: z.string().min(1),
  url: z.string().min(1),
});

export const printCompletedSchema = z.object({
  sessionId: z.string().min(1),
});
