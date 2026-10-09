// Server-side store for live shipments and readings posted by ESP32 sensors.
// Files live in data/live/ so they survive restarts. Delete that folder to reset the demo.
import fs from "fs";
import path from "path";
import { buildRouteGeo, pointAtKm, type CheckpointMeta, type Profile, type Reading, type ShipmentMeta } from "./detector";
import { readJson } from "./serverData";

const DIR = path.join(process.cwd(), "data", "live");
const SHIPMENTS = path.join(DIR, "shipments.json");
const READINGS = path.join(DIR, "readings.ndjson");
const DEMO_STEP_MIN = 5;
const DEMO_SPEED_KMH = 50;

export const deviceKey = () => process.env.STAYCOLD_DEVICE_KEY || "staycold-demo-key";

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

export function liveShipments(): ShipmentMeta[] {
  if (!fs.existsSync(SHIPMENTS)) return [];
  return JSON.parse(fs.readFileSync(SHIPMENTS, "utf8")) as ShipmentMeta[];
}

/** Readings received after `since` (ISO timestamp), or all of them when `since` is empty. */
export function liveReadings(since?: string | null): Reading[] {
  if (!fs.existsSync(READINGS)) return [];
  const rows = fs
    .readFileSync(READINGS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Reading);
  return since ? rows.filter((r) => r.timestamp > since) : rows;
}

/** Clear the received telemetry while keeping the registered ESP32 shipment(s) ready for their next reading. */
export function resetLiveReadings(shipmentId?: string): { removed: number } {
  if (!fs.existsSync(READINGS)) return { removed: 0 };
  const rows = liveReadings();
  const kept = shipmentId ? rows.filter((r) => r.shipment_id !== shipmentId) : [];
  ensureDir();
  fs.writeFileSync(READINGS, kept.map((r) => JSON.stringify(r)).join(kept.length ? "\n" : ""));
  return { removed: rows.length - kept.length };
}

export function findLiveBySensor(sensorId: string): ShipmentMeta | undefined {
  return liveShipments().find((s) => s.sensor_id === sensorId);
}

function nextShipmentId(): string {
  const seed = readJson<ShipmentMeta[]>("shipments.json").map((s) => s.shipment_id);
  const live = liveShipments().map((s) => s.shipment_id);
  const max = [...seed, ...live].reduce((m, id) => Math.max(m, parseInt(id.slice(4), 10) || 0), 1000);
  return `SHP-${max + 1}`;
}

export type CreateResult = { ok: true; meta: ShipmentMeta } | { ok: false; error: string; status: number };

export function createLiveShipment(input: Omit<ShipmentMeta, "shipment_id" | "source" | "feed">): CreateResult {
  const cps = readJson<CheckpointMeta[]>("checkpoints.json");
  const profiles = readJson<Record<string, Profile>>("vaccine_profiles.json");
  const ids = new Set(cps.map((c) => c.id));
  if (!profiles[input.vaccine]) return { ok: false, error: "Unknown vaccine.", status: 400 };
  if (!Array.isArray(input.checkpoints) || input.checkpoints.length < 2 || !input.checkpoints.every((id) => ids.has(id)))
    return { ok: false, error: "Route must have at least two known checkpoints.", status: 400 };
  const sensor = (input.sensor_id ?? "").trim();
  if (!sensor) return { ok: false, error: "Sensor ID is required for a live shipment.", status: 400 };
  if (findLiveBySensor(sensor)) return { ok: false, error: `Sensor ${sensor} is already assigned to a live shipment.`, status: 409 };

  const meta: ShipmentMeta = {
    ...input,
    sensor_id: sensor,
    shipment_id: nextShipmentId(),
    source: "user",
    feed: "live",
  };
  ensureDir();
  fs.writeFileSync(SHIPMENTS, JSON.stringify([...liveShipments(), meta], null, 2));
  return { ok: true, meta };
}

export type ReadingInput = { sensor_id?: unknown; temp_c?: unknown; humidity_pct?: unknown; lat?: unknown; lon?: unknown; battery_pct?: unknown };

/**
 * Validate one device payload. Temperature is the only required value for the
 * hybrid ESP32 demo; any absent companion telemetry is generated on the server.
 */
export function parseDevicePayload(b: ReadingInput):
  | { ok: true; sensor: string; temp_c: number; humidity_pct?: number; lat?: number; lon?: number; battery_pct?: number }
  | { ok: false; error: string } {
  const sensor = typeof b.sensor_id === "string" ? b.sensor_id.trim() : "";
  if (!sensor) return { ok: false, error: "sensor_id is required." };
  const t = Number(b.temp_c);
  if (b.temp_c === undefined || !Number.isFinite(t) || t < -40 || t > 70) return { ok: false, error: "temp_c must be a number between -40 and 70." };
  const opt = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
  const humidity = opt(b.humidity_pct);
  const lat = opt(b.lat);
  const lon = opt(b.lon);
  const battery = opt(b.battery_pct);
  if (humidity !== undefined && (!Number.isFinite(humidity) || humidity < 0 || humidity > 100)) return { ok: false, error: "humidity_pct must be between 0 and 100 when sent." };
  if ((lat !== undefined && !Number.isFinite(lat)) || (lon !== undefined && !Number.isFinite(lon))) return { ok: false, error: "lat and lon must be numbers when sent." };
  if (battery !== undefined && (!Number.isFinite(battery) || battery < 0 || battery > 100)) return { ok: false, error: "battery_pct must be between 0 and 100 when sent." };
  return { ok: true, sensor, temp_c: t, humidity_pct: humidity, lat, lon, battery_pct: battery };
}

/** Predictable companion telemetry for a temperature-only ESP32 demo. */
function simulatedCompanion(meta: ShipmentMeta, cps: CheckpointMeta[], readingNumber: number) {
  const byId = Object.fromEntries(cps.map((c) => [c.id, c]));
  const route = buildRouteGeo(meta.checkpoints, byId);
  const km = Math.min(route.total, (readingNumber * DEMO_STEP_MIN * DEMO_SPEED_KMH) / 60);
  const [lat, lon] = pointAtKm(route, km);
  return {
    lat,
    lon,
    humidity_pct: Math.round((48 + Math.sin(readingNumber * 0.7) * 2.5) * 10) / 10,
    battery_pct: Math.max(20, Math.round((100 - readingNumber * 0.3) * 10) / 10),
  };
}

/** Store a reading. The server stamps the arrival time, so a device without a clock still works. */
export function appendReading(meta: ShipmentMeta, v: ReturnType<typeof parseDevicePayload> & { ok: true }): Reading {
  const cps = readJson<CheckpointMeta[]>("checkpoints.json");
  const origin = cps.find((c) => c.id === meta.checkpoints[0])!;
  const history = liveReadings().filter((r) => r.shipment_id === meta.shipment_id);
  const prev = history.at(-1);
  const generated = simulatedCompanion(meta, cps, history.length);
  const r: Reading = {
    shipment_id: meta.shipment_id,
    timestamp: new Date().toISOString(),
    temp_c: v.temp_c,
    // ESP32 temperature is real; companion values are simulated until a device supplies them.
    humidity_pct: v.humidity_pct ?? generated.humidity_pct,
    lat: v.lat ?? generated.lat ?? prev?.lat ?? origin.lat,
    lon: v.lon ?? generated.lon ?? prev?.lon ?? origin.lon,
    battery_pct: v.battery_pct ?? generated.battery_pct,
  };
  ensureDir();
  fs.appendFileSync(READINGS, JSON.stringify(r) + "\n");
  return r;
}
