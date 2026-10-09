// Browser-side replay of the telemetry feed. Lets the UI pause, resume, scrub and inject faults.
import type { Reading } from "./detector";

export interface Tick { ts: number; readings: Reading[] }
type Step = { mode: "offset" | "absolute"; value: number };

/** Playback speeds in simulated minutes per real second. One telemetry tick = 5 simulated minutes. */
export const SPEEDS = [
  { label: "Slow", minPerSec: 0.5, hint: "10 s per reading" },
  { label: "Normal", minPerSec: 1, hint: "5 s per reading" },
  { label: "Fast", minPerSec: 3, hint: "1.7 s per reading" },
];
export const TICK_MIN = 5;

export const SCENARIOS: Record<string, { label: string; steps: Step[] }> = {
  door_open: {
    label: "Door-open spike",
    steps: [6, 9, 6].map((v) => ({ mode: "offset" as const, value: v })),
  },
  power_cut: {
    label: "Power cut",
    steps: [2, 4, 6, 8, 10, 12, 13, 14, 15, 15, 15, 14, 12, 10, 8, 6, 4, 2].map((v) => ({ mode: "offset" as const, value: v })),
  },
  compressor_fail: {
    label: "Compressor failure",
    steps: Array.from({ length: 18 }, (_, i) => ({ mode: "offset" as const, value: Math.round((i + 1) * 0.8 * 10) / 10 })),
  },
  freeze: {
    label: "Sub-zero exposure",
    steps: [-1, -3, -4, -4, -3, -1].map((v) => ({ mode: "absolute" as const, value: v })),
  },
};

export function buildTicks(rows: Reading[]): Tick[] {
  const byTs = new Map<number, Reading[]>();
  for (const r of rows) {
    const ts = Date.parse(r.timestamp);
    const list = byTs.get(ts) ?? [];
    list.push(r);
    byTs.set(ts, list);
  }
  return Array.from(byTs.entries()).sort((a, b) => a[0] - b[0]).map(([ts, readings]) => ({ ts, readings }));
}

export class Replay {
  ticks: Tick[];
  /** Ticks already emitted, with demo faults applied. Kept so the UI can scrub backwards without re-randomising. */
  private emitted: Tick[] = [];
  private queues = new Map<string, Step[]>();
  pos = 0;

  constructor(readings: Reading[]) {
    this.ticks = buildTicks(readings);
  }

  /** Merge readings for a newly added shipment. They must be later than the current position. */
  addReadings(rows: Reading[]) {
    this.ticks = buildTicks([...this.ticks.flatMap((t) => t.readings), ...rows]);
  }

  get length() {
    return this.ticks.length;
  }

  /** Queue a demo fault that applies from the current position onwards. */
  inject(shipmentId: string, scenario: string): boolean {
    const sc = SCENARIOS[scenario];
    if (!sc || this.pos >= this.ticks.length) return false;
    // Drop cached future ticks so they are regenerated with the fault applied
    this.emitted = this.emitted.slice(0, this.pos);
    const q = this.queues.get(shipmentId) ?? [];
    q.push(...sc.steps);
    this.queues.set(shipmentId, q);
    return true;
  }

  pendingFor(shipmentId: string): number {
    return this.queues.get(shipmentId)?.length ?? 0;
  }

  /** Next tick, or null at the end of the trip. */
  next(): Tick | null {
    if (this.pos >= this.ticks.length) return null;
    if (this.pos < this.emitted.length) return this.emitted[this.pos++];
    const src = this.ticks[this.pos];
    const readings = src.readings.map((r) => {
      const q = this.queues.get(r.shipment_id);
      const adj = q && q.length ? q.shift()! : null;
      if (!adj) return { ...r, injected: false };
      const temp = adj.mode === "offset" ? r.temp_c + adj.value : adj.value;
      return { ...r, temp_c: Math.round(temp * 100) / 100, injected: true };
    });
    const tick = { ts: src.ts, readings };
    this.emitted.push(tick);
    this.pos++;
    return tick;
  }

  /** Move back to the start but keep what has already been emitted (used for scrubbing). */
  rewind() {
    this.pos = 0;
  }

  /** Clean restart: forget injected faults and cached ticks. */
  restart() {
    this.pos = 0;
    this.emitted = [];
    this.queues.clear();
  }
}
