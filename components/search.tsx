"use client";

import type { ShipmentState } from "@/lib/detector";
import { STATUS_LABEL } from "./status";

export type Filter = "all" | "attention" | "ontrack" | "delivered" | "discard" | "nosignal";

export const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "ontrack", label: "On track" },
  { key: "delivered", label: "Delivered" },
  { key: "discard", label: "Discarded" },
  { key: "nosignal", label: "No signal" },
];

const FILTER_STATUSES: Record<Filter, string[] | null> = {
  all: null,
  attention: ["ALERT", "DISCARD", "NO_SIGNAL"],
  ontrack: ["OK", "AT_RISK", "WAITING"],
  delivered: ["DELIVERED"],
  discard: ["DISCARD"],
  nosignal: ["NO_SIGNAL"],
};

/** Free-text match on IDs, product, batch, people, vehicle, checkpoints and status label, plus a status filter. */
export function matchesShipment(s: ShipmentState, query: string, filter: Filter, names: Record<string, string>): boolean {
  const statuses = FILTER_STATUSES[filter];
  if (statuses && !statuses.includes(s.status)) return false;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = [
    s.meta.shipment_id,
    s.meta.vaccine,
    s.profile.name,
    s.meta.batch,
    s.meta.driver,
    s.meta.vehicle,
    s.meta.cold_box,
    s.meta.sensor_id,
    s.meta.scenario,
    STATUS_LABEL[s.status],
    ...s.meta.checkpoints.map((id) => names[id] ?? id),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}

interface Props {
  query: string;
  onQuery: (q: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
  placeholder?: string;
}

export function SearchBar({ query, onQuery, filter, onFilter, counts, placeholder }: Props) {
  return (
    <div className="search">
      <div className="search-row">
        <input
          type="search"
          className="input search-input"
          value={query}
          placeholder={placeholder ?? "Search shipment, vaccine, batch, driver, vehicle or checkpoint"}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Search shipments"
        />
        {query && (
          <button className="btn ghost sm" onClick={() => onQuery("")}>
            Clear
          </button>
        )}
      </div>
      <div className="chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? "on" : ""}`} onClick={() => onFilter(f.key)}>
            {f.label} <span>{counts[f.key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function countFilters(states: ShipmentState[], query: string, names: Record<string, string>): Record<Filter, number> {
  const out = {} as Record<Filter, number>;
  for (const f of FILTERS) out[f.key] = states.filter((s) => matchesShipment(s, query, f.key, names)).length;
  return out;
}
