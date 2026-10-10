export type Booth = {
  id: string;
  name: string;
  location: string | null;
  defaultPrice: number;
  // Diturunkan dari akun pembayaran booth; jangan diubah langsung.
  paymentProvider: "ipaymu" | "xendit" | "doku";
  // null = QRIS belum diatur (booth hanya bisa voucher).
  paymentAccountId: string | null;
  bridgeToken: string;
  isActive: boolean;
  lastSeenAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type BoothInput = {
  name: string;
  location?: string | null;
  defaultPrice: number;
  paymentAccountId?: string | null;
  isActive: boolean;
};
