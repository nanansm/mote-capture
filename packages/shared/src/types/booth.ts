export type Booth = {
  id: string;
  name: string;
  location: string | null;
  defaultPrice: number;
  paymentProvider: "ipaymu" | "xendit";
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
  paymentProvider: "ipaymu" | "xendit";
  isActive: boolean;
};
