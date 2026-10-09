"use client";

import { useMemo, useState } from "react";
import type { ShipmentState } from "@/lib/detector";
import { distanceOf, fmtDay, fmtTime, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from "./status";
import { countFilters, matchesShipment, SearchBar, type Filter } from "./search";

interface Props {
  states: ShipmentState[];
  clockMs: number;
  onReport: (id: string) => void;
  onCsv: (id: string) => void;
  onFleetReport: () => void;
  names: Record<string, string>;
}

export default function ReportsView({ states, clockMs, onReport, onCsv, onFleetReport, names }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(
    () =>
      states
        .filter((s) => matchesShipment(s, query, filter, names))
        .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [states, query, filter, names],
  );
  const counts = useMemo(() => countFilters(states, query, names), [states, query, names]);
  return (
    <div className="view">
      <header className="view-head">
        <div>
          <h1>Reports</h1>
          <p className="lede">
            Reports reflect the simulation as of {clockMs ? `${fmtDay(clockMs)}, ${fmtTime(clockMs)} IST` : "the start of the trip"}. Each shipment report opens in a new tab. Use Print, then Save as PDF.
          </p>
        </div>
        <div className="actions">
          <button className="btn solid" onClick={onFleetReport}>
            Fleet summary report
          </button>
        </div>
      </header>

      <section className="panel">
        <SearchBar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} counts={counts} />
        <table className="table">
          <thead>
            <tr>
              <th>Shipment</th>
              <th>Vaccine</th>
              <th>Batch</th>
              <th>Status</th>
              <th className="r">Distance</th>
              <th className="r">Potency</th>
              <th className="r">Excursions</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="quiet">No shipment matches “{query}”.</td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.meta.shipment_id}>
                <td className="num">
                  <span className="sq-inline" style={{ background: STATUS_COLOR[s.status] }} />
                  {s.meta.shipment_id}
                  {s.meta.source === "user" && <span className="tag">added</span>}
                </td>
                <td>{s.profile.name}</td>
                <td className="num">{s.meta.batch ?? "–"}</td>
                <td>{STATUS_LABEL[s.status]}</td>
                <td className="num r">{distanceOf(s.meta).toFixed(0)} km</td>
                <td className="num r">{s.frozen ? "0.00%" : `${s.viability.toFixed(2)}%`}</td>
                <td className="num r">{s.excursions.length}</td>
                <td className="actions-cell">
                  <button className="btn sm" onClick={() => onReport(s.meta.shipment_id)}>
                    Report
                  </button>
                  <button className="btn sm ghost" onClick={() => onCsv(s.meta.shipment_id)}>
                    CSV
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
