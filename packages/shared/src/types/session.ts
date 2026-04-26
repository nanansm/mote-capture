export type SessionStatus =
  | "idle"
  | "payment"
  | "paid"
  | "capturing"
  | "processing"
  | "done"
  | "expired"
  | "failed";

export type Session = {
  id: string;
  boothId: string;
  frameId: string | null;
  status: SessionStatus;
  amount: number;
  paymentProvider: string | null;
  paymentRef: string | null;
  qrString: string | null;
  paidAt: Date | null;
  customerEmail: string | null;
  customerPhone: string | null;
  photoCount: number;
  printCompletedAt: Date | null;
  downloadToken: string | null;
  downloadExpiresAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiredAt: Date | null;
};

export type Photo = {
  id: string;
  sessionId: string;
  url: string;
  isFinal: boolean;
  sortOrder: number;
  createdAt: Date;
};
