import type { ShipmentMeta, ShipmentState, ShipStatus } from "@/lib/detector";

// Palette: warm paper, ink, one cobalt accent. Status colours are muted and used sparingly.
export const COLOR = {
  paper: "#f4f1ea",
  panel: "#fbfaf6",
  rule: "#d9d4c7",
  ink: "#1b1a17",
  muted: "#6f6a5e",
  accent: "#2446a8",
};

export const STATUS_COLOR: Record<ShipStatus, string> = {
  WAITING: "#9a9485",
  OK: "#2f6b4f",
  AT_RISK: "#a16207",
  ALERT: "#c2410c",
  NO_SIGNAL: "#6b6b6b",
  DELIVERED: "#2446a8",
  DISCARD: "#7f1d1d",
};

export const STATUS_LABEL: Record<ShipStatus, string> = {
  WAITING: "Not departed",
  OK: "On track",
  AT_RISK: "Recovered",
  ALERT: "Action needed",
  NO_SIGNAL: "No signal",
  DELIVERED: "Delivered",
  DISCARD: "Discard",
};

/** Most urgent first. */
export const STATUS_ORDER: ShipStatus[] = ["DISCARD", "ALERT", "NO_SIGNAL", "AT_RISK", "OK", "WAITING", "DELIVERED"];

export const TYPE_LABEL: Record<string, string> = {
  HEAT: "Too warm",
  COLD: "Too cold",
  FREEZE: "Frozen",
  MIXED: "Temperature swing",
};

export const IST = "Asia/Kolkata";

export function fmtTime(input: string | number) {
  return new Date(input).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
}

export function fmtDateTime(input: number) {
  return new Date(input).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  });
}

export function fmtDay(input: number) {
  return new Date(input).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: IST });
}

export function distanceOf(m: ShipmentMeta) {
  return m.distance_km ?? m.ground_truth?.distance_km ?? 0;
}

export function departedOf(m: ShipmentMeta) {
  return m.departed_at ?? m.ground_truth?.departed_at ?? "";
}

/** Plain-language summary for a shipment. */
export function headline(s: ShipmentState): { title: string; body: string } {
  const fz = s.excursions.find((e) => e.type === "FREEZE");
  switch (s.status) {
    case "DISCARD":
      return {
        title: "Discard. The vaccine was exposed to freezing",
        body: `Lowest reading ${fz ? fz.peakTempC.toFixed(1) : "below the freeze limit"} °C. Potency cannot be guaranteed. Pull this batch before delivery.`,
      };
    case "ALERT": {
      const o = s.open!;
      const a = o.alert;
      return {
        title: `${TYPE_LABEL[o.type]} for ${o.durationMin} min, peak ${o.peakTempC.toFixed(1)} °C`,
        body: a ? `Alert sent to ${a.checkpointName}. Divert there: ${a.distKm} km, about ${a.etaMin} min.` : "Alert sent to the nearest checkpoint.",
      };
    }
    case "AT_RISK":
      return { title: "Recovered after an earlier excursion", body: `Estimated potency ${s.viability.toFixed(2)}%. Watch the rest of the trip.` };
    case "NO_SIGNAL":
      return { title: "No data from the sensor", body: `${s.reason}. Call the driver and treat the load as unverified.` };
    case "DELIVERED":
      return {
        title: "Delivered",
        body: s.excursions.length
          ? `Arrived after ${s.excursions.length} excursion${s.excursions.length > 1 ? "s" : ""}. Estimated potency ${s.viability.toFixed(2)}%.`
          : "Arrived within the label range.",
      };
    case "WAITING":
      return { title: "Not departed yet", body: `Scheduled departure ${fmtTime(departedOf(s.meta))} IST.` };
    default:
      return { title: "On track", body: `Within ${s.profile.min_c} to ${s.profile.max_c} °C. Estimated potency ${s.viability.toFixed(2)}%.` };
  }
}
