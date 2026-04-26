import type { Frame } from "@capture/shared";
import { FRAME_TIERS } from "@capture/shared";

export function resolvePrice(opts: {
  frame: Pick<Frame, "tier" | "price"> | null;
  boothDefaultPrice: number;
}): number {
  if (!opts.frame) return opts.boothDefaultPrice;
  // Frame.price is the source of truth — admin can override per frame.
  // When price equals the tier default, fall back to booth default if it is higher.
  return opts.frame.price > 0 ? opts.frame.price : opts.boothDefaultPrice;
}

export function tierDefaultPrice(tier: Frame["tier"]): number {
  return FRAME_TIERS[tier].defaultPrice;
}
