// StayCold detection engine. Pure TypeScript, no I/O, so it can run in the browser or in tests.
// It only uses what a real logger would send: temp, humidity, GPS, timestamp.
// It never reads the simulator's ground-truth columns.

export const STEP_MIN = 5; // expected telemetry interval
export const GAP_MIN = 15; // no data for longer than this => NO_SIGNAL
export const CONFIRM_READINGS = 2; // consecutive out-of-range readings to confirm (10 min)
export const SPEED_KMH = 50; // planning speed for ETA estimates
const DELIVERED_PCT = 98;

export type ShipStatus = "WAITING" | "OK" | "AT_RISK" | "ALERT" | "NO_SIGNAL" | "DELIVERED" | "DISCARD";
export type ExcursionType = "HEAT" | "COLD" | "FREEZE" | "MIXED";

export interface CheckpointMeta { id: string; name: string; lat: number; lon: number; type: string }
export interface Profile {
  name: string;
  min_c: number;
  max_c: number;
  freeze_damage_below_c: number | null;
  heat_half_life_h_at_37c: number;
}
export interface ShipmentMeta {
  shipment_id: string;
  vaccine: string;
  vaccine_name: string;
  route: string;
  checkpoints: string[];
  scenario: string;
  description: string;
  destination_id: string;
  departed_at?: string;
  distance_km?: number;
  doses?: number;
  batch?: string;
  driver?: string;
  vehicle?: string;
  cold_box?: string;
  sensor_id?: string;
  source?: "seed" | "user";
  /** live: readings arrive from an ESP32 sensor. simulated: generated in the browser. */
  feed?: "live" | "simulated";
  ground_truth?: {
    trip_duration_min: number;
    distance_km: number;
    departed_at: string;
    final_viability_pct: number;
    final_status: string;
    excursion_count: number;
    frozen: boolean;
  };
}
export interface Reading {
  shipment_id: string;
  timestamp: string;
  temp_c: number;
  humidity_pct: number;
  lat: number;
  lon: number;
  battery_pct: number;
  dist_km?: number;
  injected?: boolean;
}
export interface TruthEvent {
  shipment_id: string;
  type: string;
  start: string;
  end: string;
  duration_min: number;
  peak_temp_c: number;
  degree_minutes: number;
  confirmed_at: string;
  expected_alert_checkpoint: string;
}
export interface AlertInfo { checkpointId: string; checkpointName: string; distKm: number; etaMin: number }
export interface Excursion {
  id: string;
  shipment_id: string;
  type: ExcursionType;
  startedAt: string;
  confirmedAt: string;
  endedAt: string | null;
  durationMin: number;
  peakTempC: number;
  degreeMinutes: number;
  injected: boolean;
  alert: AlertInfo | null;
}
export interface ShipmentState {
  meta: ShipmentMeta;
  profile: Profile;
  status: ShipStatus;
  reason: string;
  lastReading: Reading | null;
  viability: number;
  frozen: boolean;
  progressPct: number;
  history: Reading[];
  excursions: Excursion[];
  open: Excursion | null;
  next: AlertInfo | null;
  progressKm: number;
  prevKm: number;
  totalKm: number;
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RouteGeo { pts: [number, number][]; cum: number[]; total: number }

export function buildRouteGeo(ids: string[], cps: Record<string, CheckpointMeta>): RouteGeo {
  const pts = ids.map((id) => [cps[id].lat, cps[id].lon] as [number, number]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineKm(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] };
}

/** Point on the route at a given distance (km) from the origin. */
export function pointAtKm(g: RouteGeo, km: number): [number, number] {
  if (km <= 0) return g.pts[0];
  if (km >= g.total) return g.pts[g.pts.length - 1];
  for (let i = 1; i < g.cum.length; i++) {
    if (km <= g.cum[i]) {
      const seg = g.cum[i] - g.cum[i - 1];
      const f = seg > 0 ? (km - g.cum[i - 1]) / seg : 0;
      const [a, b] = [g.pts[i - 1], g.pts[i]];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
  }
  return g.pts[g.pts.length - 1];
}

/** Estimate how far along the route (km) a GPS fix is, by projecting onto the nearest route segment. */
export function projectKm(lat: number, lon: number, g: RouteGeo): number {
  const kx = Math.cos((lat * Math.PI) / 180) * 111.32;
  const ky = 110.57;
  let best = Infinity;
  let km = 0;
  for (let i = 1; i < g.pts.length; i++) {
    const [aLat, aLon] = g.pts[i - 1];
    const [bLat, bLon] = g.pts[i];
    const ax = aLon * kx, ay = aLat * ky, bx = bLon * kx, by = bLat * ky;
    const px = lon * kx, py = lat * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) {
      best = d;
      km = g.cum[i - 1] + t * (g.cum[i] - g.cum[i - 1]);
    }
  }
  return km;
}

interface Internal {
  meta: ShipmentMeta;
  profile: Profile;
  geo: RouteGeo;
  consumedH: number;
  frozen: boolean;
  lastTs: number | null;
  lastReading: Reading | null;
  history: Reading[];
  outRun: number;
  runStartTs: number | null;
  open: Excursion | null;
  excursions: Excursion[];
  progressKm: number;
  prevKm: number;
}

export class Monitor {
  clockMs = 0;
  private st = new Map<string, Internal>();
  private cps: Record<string, CheckpointMeta> = {};

  constructor(shipments: ShipmentMeta[], profiles: Record<string, Profile>, checkpoints: CheckpointMeta[]) {
    checkpoints.forEach((c) => (this.cps[c.id] = c));
    for (const meta of shipments) {
      const profile = profiles[meta.vaccine];
      this.st.set(meta.shipment_id, {
        meta,
        profile,
        geo: buildRouteGeo(meta.checkpoints, this.cps),
        consumedH: 0,
        frozen: false,
        lastTs: null,
        lastReading: null,
        history: [],
        outRun: 0,
        runStartTs: null,
        open: null,
        excursions: [],
        progressKm: 0,
        prevKm: 0,
      });
    }
  }

  /** Feed one telemetry reading. Returns a newly confirmed excursion, if any. */
  ingest(r: Reading): Excursion | null {
    const s = this.st.get(r.shipment_id);
    if (!s) return null;
    const p = s.profile;
    const ts = Date.parse(r.timestamp);
    this.clockMs = Math.max(this.clockMs, ts);

    // Heat-exposure integration over the real interval (skip across telemetry gaps)
    if (s.lastTs !== null) {
      const dtMin = (ts - s.lastTs) / 60000;
      if (dtMin > 0 && dtMin <= GAP_MIN && r.temp_c > p.max_c) {
        s.consumedH += Math.pow(3, (r.temp_c - 37) / 10) * (dtMin / 60);
      }
    }
    s.lastTs = ts;
    s.lastReading = r;
    s.history.push(r);
    if (s.history.length > 5000) s.history.shift();
    s.prevKm = s.progressKm;
    // Progress only moves forward: GPS noise at a standstill must not push the truck backwards
    s.progressKm = Math.max(s.progressKm, projectKm(r.lat, r.lon, s.geo));

    const thr = p.freeze_damage_below_c;
    const cls: ExcursionType | null =
      thr !== null && r.temp_c < thr ? "FREEZE" : r.temp_c > p.max_c ? "HEAT" : r.temp_c < p.min_c ? "COLD" : null;
    if (thr !== null && r.temp_c < thr) s.frozen = true;

    let created: Excursion | null = null;
    if (cls) {
      if (s.outRun === 0) s.runStartTs = ts;
      s.outRun++;
      if (!s.open && (cls === "FREEZE" || s.outRun >= CONFIRM_READINGS)) {
        s.open = {
          id: `${r.shipment_id}-E${s.excursions.length + 1}`,
          shipment_id: r.shipment_id,
          type: cls,
          startedAt: new Date(s.runStartTs ?? ts).toISOString(),
          confirmedAt: r.timestamp,
          endedAt: null,
          durationMin: 0,
          peakTempC: r.temp_c,
          degreeMinutes: 0,
          injected: false,
          alert: this.nearestAhead(s, r),
        };
        s.excursions.push(s.open);
        created = s.open;
      }
      const e = s.open;
      if (e) {
        e.injected = e.injected || !!r.injected;
        e.durationMin = Math.round((ts - Date.parse(e.startedAt)) / 60000 + STEP_MIN);
        if (cls === "FREEZE") e.type = "FREEZE";
        else if (e.type !== "FREEZE" && e.type !== cls) e.type = "MIXED";
        if (cls === "HEAT") {
          e.peakTempC = Math.max(e.peakTempC, r.temp_c);
          e.degreeMinutes += (r.temp_c - p.max_c) * STEP_MIN;
        } else {
          e.peakTempC = Math.min(e.peakTempC, r.temp_c);
          e.degreeMinutes += (p.min_c - r.temp_c) * STEP_MIN;
        }
        e.degreeMinutes = Math.round(e.degreeMinutes * 10) / 10;
      }
    } else {
      s.outRun = 0;
      if (s.open) {
        s.open.endedAt = r.timestamp;
        s.open = null;
      }
    }
    return created;
  }

  /** First checkpoint ahead of the truck along the route, with remaining km and ETA. */
  private nearestAhead(s: Internal, r: Reading): AlertInfo {
    const d = projectKm(r.lat, r.lon, s.geo);
    let idx = s.geo.cum.findIndex((c, k) => k > 0 && c >= d);
    if (idx === -1) idx = s.geo.cum.length - 1;
    const id = s.meta.checkpoints[idx];
    const remaining = Math.max(0, s.geo.cum[idx] - d);
    return {
      checkpointId: id,
      checkpointName: this.cps[id].name,
      distKm: Math.round(remaining * 10) / 10,
      etaMin: Math.round((remaining / SPEED_KMH) * 60),
    };
  }

  allExcursions(): Excursion[] {
    return Array.from(this.st.values()).flatMap((s) => s.excursions);
  }

  snapshot(): ShipmentState[] {
    return Array.from(this.st.values()).map((s) => {
      const progressPct = Math.min(100, (s.progressKm / s.geo.total) * 100);
      const viability = s.frozen ? 0 : 100 * Math.pow(2, -s.consumedH / s.profile.heat_half_life_h_at_37c);
      const last = s.lastReading;
      const silentMin = last ? (this.clockMs - Date.parse(last.timestamp)) / 60000 : 0;
      const nExc = s.excursions.length;
      let status: ShipStatus;
      let reason: string;
      if (!last) {
        status = "WAITING";
        reason = "Awaiting first telemetry";
      } else if (s.frozen) {
        status = "DISCARD";
        reason = `Freeze damage (below ${s.profile.freeze_damage_below_c} °C): discard before delivery`;
      } else if (progressPct >= DELIVERED_PCT) {
        status = "DELIVERED";
        reason = nExc ? `Arrived. ${nExc} excursion(s) during transit` : "Arrived within range";
      } else if (silentMin > GAP_MIN) {
        status = "NO_SIGNAL";
        reason = `No telemetry for ${Math.round(silentMin)} min. Treat as unknown, not OK`;
      } else if (s.open) {
        status = "ALERT";
        reason = `${s.open.type} excursion for ${s.open.durationMin} min, peak ${s.open.peakTempC.toFixed(1)} °C`;
      } else if (nExc) {
        status = "AT_RISK";
        reason = `${nExc} past excursion(s). Potency ${viability.toFixed(2)}%`;
      } else {
        status = "OK";
        reason = "Within label range";
      }
      return {
        meta: s.meta,
        profile: s.profile,
        status,
        reason,
        lastReading: last,
        viability,
        frozen: s.frozen,
        progressPct,
        history: s.history,
        excursions: s.excursions,
        open: s.open,
        next: last ? this.nearestAhead(s, last) : null,
        progressKm: s.progressKm,
        prevKm: s.prevKm,
        totalKm: s.geo.total,
      };
    });
  }
}
