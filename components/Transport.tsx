"use client";

import { SPEEDS } from "@/lib/replay";

interface Props {
  playing: boolean;
  finished: boolean;
  onToggle: () => void;
  onRestart: () => void;
  speedIdx: number;
  onSpeed: (i: number) => void;
  pos: number;
  total: number;
  clockLabel: string;
  onSeek: (n: number) => void;
}

/** Playback bar for the simulated feed. Pausing and scrubbing work on every view. */
export default function Transport(p: Props) {
  return (
    <div className="transport">
      <div className="tp-buttons">
        <button className="btn ghost" onClick={p.onRestart} title="Restart the trip from 06:00 IST">
          Restart
        </button>
        <button className="btn solid play" onClick={p.onToggle}>
          {p.playing ? "Pause" : p.finished ? "Replay" : "Play"}
        </button>
      </div>
      <div className="tp-track">
        <input
          type="range"
          min={0}
          max={Math.max(1, p.total)}
          value={p.pos}
          onChange={(e) => p.onSeek(Number(e.target.value))}
          aria-label="Scrub through the trip"
        />
        <div className="tp-meta">
          <span className="num">{p.clockLabel}</span>
          <span className="meta">
            reading {p.pos} of {p.total}
          </span>
        </div>
      </div>
      <div className="speed" role="group" aria-label="Playback speed">
        {SPEEDS.map((s, i) => (
          <button key={s.label} className={i === p.speedIdx ? "seg on" : "seg"} onClick={() => p.onSpeed(i)} title={s.hint}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
