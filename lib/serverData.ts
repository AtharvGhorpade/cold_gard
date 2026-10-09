import fs from "fs";
import path from "path";
import type { Reading } from "./detector";

const DATA_DIR = path.join(process.cwd(), "data");

export function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")) as T;
}

/** Telemetry rows sorted into time order, as a real ingest feed would deliver them. */
export function readReadings(): Reading[] {
  const lines = fs.readFileSync(path.join(DATA_DIR, "sensor_readings.csv"), "utf8").trim().split(/\r?\n/);
  const [header, ...rows] = lines;
  const keys = header.split(",");
  const out: Reading[] = rows.map((line) => {
    const cells = line.split(",");
    const o: Record<string, string> = {};
    keys.forEach((k, i) => (o[k] = cells[i]));
    return {
      shipment_id: o.shipment_id,
      timestamp: o.timestamp,
      temp_c: Number(o.temp_c),
      humidity_pct: Number(o.humidity_pct),
      lat: Number(o.lat),
      lon: Number(o.lon),
      battery_pct: Number(o.battery_pct),
      dist_km: Number(o.dist_km),
    };
  });
  return out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
