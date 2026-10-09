import { NextResponse } from "next/server";
import { appendReading, deviceKey, findLiveBySensor, parseDevicePayload } from "@/lib/liveStore";

export const dynamic = "force-dynamic";

/** Health check for devices and humans: GET returns what this endpoint expects. */
export async function GET() {
  return NextResponse.json({
    service: "StayCold telemetry",
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-Key": "<device key>" },
    body: { sensor_id: "TL-2210", temp_c: 4.2 },
    optional: ["humidity_pct", "lat", "lon", "battery_pct"],
    note: "For a temperature-only ESP32 demo, StayCold generates humidity, route progress and battery data for the shipment.",
  });
}

/** Called by ESP32 sensors over the internet. Accepts one reading per request. */
export async function POST(req: Request) {
  if (req.headers.get("x-device-key") !== deviceKey()) {
    return NextResponse.json({ error: "Invalid or missing X-Device-Key." }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const v = parseDevicePayload(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  const meta = findLiveBySensor(v.sensor);
  if (!meta) {
    return NextResponse.json({ error: `Sensor ${v.sensor} is not registered. Create its shipment in StayCold first.` }, { status: 404 });
  }
  const r = appendReading(meta, v);
  return NextResponse.json({ ok: true, shipment_id: r.shipment_id, timestamp: r.timestamp }, { status: 202 });
}
