import { NextResponse } from "next/server";
import { createLiveShipment, deviceKey, liveReadings, liveShipments, resetLiveReadings } from "@/lib/liveStore";
import type { ShipmentMeta } from "@/lib/detector";

export const dynamic = "force-dynamic";

/** Dashboard feed: live shipments, plus readings newer than `since` (ISO time). */
export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get("since");
  return NextResponse.json({
    shipments: liveShipments(),
    readings: liveReadings(since),
    deviceKey: deviceKey(),
  });
}

/** Register a live shipment from the New shipment form. The server assigns the ID. */
export async function POST(req: Request) {
  let body: Omit<ShipmentMeta, "shipment_id" | "source" | "feed">;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const out = createLiveShipment(body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ shipment: out.meta, shipment_id: out.meta.shipment_id, device_key: deviceKey() }, { status: 201 });
}

/** Reset received ESP32 telemetry, but leave the live shipment registered for its next temperature packet. */
export async function DELETE(req: Request) {
  const shipmentId = new URL(req.url).searchParams.get("shipment_id")?.trim() || undefined;
  if (shipmentId && !liveShipments().some((s) => s.shipment_id === shipmentId)) {
    return NextResponse.json({ error: `Live shipment ${shipmentId} was not found.` }, { status: 404 });
  }
  const result = resetLiveReadings(shipmentId);
  return NextResponse.json({ ok: true, ...result });
}
