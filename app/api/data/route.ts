import { NextResponse } from "next/server";
import { readJson, readReadings } from "@/lib/serverData";
import type { CheckpointMeta, Profile, ShipmentMeta, TruthEvent } from "@/lib/detector";

export const dynamic = "force-dynamic";

export async function GET() {
  const rawProfiles = readJson<Record<string, unknown>>("vaccine_profiles.json");
  const profiles = Object.fromEntries(Object.entries(rawProfiles).filter(([k]) => !k.startsWith("_"))) as Record<string, Profile>;
  return NextResponse.json({
    shipments: readJson<ShipmentMeta[]>("shipments.json"),
    checkpoints: readJson<CheckpointMeta[]>("checkpoints.json"),
    profiles,
    sources: (rawProfiles._sources as string[] | undefined) ?? [],
    truthEvents: readJson<TruthEvent[]>("ground_truth_events.json"),
    readings: readReadings(),
  });
}
