// Telemetry generator for shipments created in the app. Same physics as generate_data.py,
// so user-created shipments behave like the seeded ones. Output is labelled as simulated.
import { buildRouteGeo, haversineKm, pointAtKm, type CheckpointMeta, type Profile, type Reading } from "./detector";

export const SIM_SPEED_KMH = 50;
const STEP = 5;

export const SENSOR_SCENARIOS: Record<string, string> = {
  normal: "Normal transit",
  door_open: "Door opened at stops",
  compressor_fail: "Compressor fails mid-route",
  power_cut: "Power cut for 90 minutes",
  freeze_low: "Ice pack placed too close (sub-zero)",
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function routeDistanceKm(ids: string[], cps: Record<string, CheckpointMeta>): number {
  return buildRouteGeo(ids, cps).total;
}

export function simulateShipment(p: {
  id: string;
  route: string[];
  cps: Record<string, CheckpointMeta>;
  profile: Profile;
  departMs: number;
  scenario: string;
  seed: number;
}): Reading[] {
  const rand = rng(p.seed);
  const gauss = () => {
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const geo = buildRouteGeo(p.route, p.cps);
  const D = Math.floor((geo.total / SIM_SPEED_KMH) * 60) + STEP;

  const ambient = (t: number) => {
    const hour = ((p.departMs + t * 60000) / 3600000 + 5.5) % 24; // IST
    return 28 + 6 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
  };
  const target = (t: number, amb: number) => {
    const base = 5;
    switch (p.scenario) {
      case "door_open":
        return [0.2, 0.5, 0.75].some((f) => t >= f * D && t < f * D + 12) ? 16 : base;
      case "compressor_fail": {
        const t0 = 0.25 * D;
        return t > t0 ? Math.min(base + (t - t0) * 0.1, 14) : base;
      }
      case "power_cut": {
        const t0 = 0.35 * D;
        return t >= t0 && t < t0 + 90 ? amb : base;
      }
      case "freeze_low": {
        const t0 = 0.3 * D;
        return t >= t0 && t < t0 + 120 ? -6 : base;
      }
      default:
        return base;
    }
  };
  const humTarget = (t: number) =>
    p.scenario === "power_cut" && t >= 0.35 * D && t < 0.35 * D + 90 ? 78 : 48;

  let T = 5 + (rand() - 0.5) * 0.6;
  let H = 50;
  const out: Reading[] = [];
  for (let t = 0; t <= D; t += STEP) {
    const amb = ambient(t);
    T += 0.3 * (target(t, amb) - T) + gauss() * 0.12;
    H += 0.2 * (humTarget(t) - H) + gauss() * 0.6;
    if (p.scenario === "door_open" && [0.2, 0.5, 0.75].some((f) => t >= f * D && t < f * D + 12)) H += 3;
    const dist = Math.min((SIM_SPEED_KMH * t) / 60, geo.total);
    const [lat, lon] = pointAtKm(geo, dist);
    out.push({
      shipment_id: p.id,
      timestamp: new Date(p.departMs + t * 60000).toISOString(),
      temp_c: Math.round(T * 100) / 100,
      humidity_pct: Math.round(H * 10) / 10,
      lat: Math.round((lat + gauss() * 0.0002) * 1e6) / 1e6,
      lon: Math.round((lon + gauss() * 0.0002) * 1e6) / 1e6,
      battery_pct: Math.round(Math.max(20, 100 - t * 0.01) * 10) / 10,
      dist_km: Math.round(dist * 100) / 100,
    });
  }
  return out;
}

export { haversineKm };
