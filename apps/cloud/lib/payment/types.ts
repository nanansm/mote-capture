export type CreateQRParams = {
  sessionId: string;
  amount: number;
  expiresInMinutes?: number;
};

export type CreateQRResult = {
  providerRef: string;
  qrString: string;
  expiresAt: Date;
  rawResponse: unknown;
  mockMode?: boolean;
};

export type WebhookEvent = "paid" | "expired" | "failed";

export type VerifyWebhookParams = {
  headers: Record<string, string>;
  body: string;
};

export type VerifyWebhookResult = {
  valid: boolean;
  event?: WebhookEvent;
  sessionRef?: string;
  amount?: number;
  rawPayload?: unknown;
  reason?: string;
};

export interface PaymentProvider {
  readonly name: string;
  createQR(params: CreateQRParams): Promise<CreateQRResult>;
  verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult>;
  ping(): Promise<{ ok: boolean; message: string }>;
}
