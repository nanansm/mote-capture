// Broadcast event ws `/agent/ws` ke semua tab kiosk.
import type { AgentEvent } from "@capture/shared";

type Sock = { send(data: string): void; readyState: number };

export class Hub {
  private clients = new Set<Sock>();
  add(s: Sock): void {
    this.clients.add(s);
  }
  remove(s: Sock): void {
    this.clients.delete(s);
  }
  get size(): number {
    return this.clients.size;
  }
  emit(ev: AgentEvent): void {
    const msg = JSON.stringify(ev);
    for (const s of this.clients) {
      if (s.readyState !== 1) continue;
      try {
        s.send(msg);
      } catch {
        /* klien putus, dibuang saat close */
      }
    }
  }
}
