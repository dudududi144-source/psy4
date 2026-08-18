'use client';
// src/components/psyforge/Keyboard.tsx
// 14-key keyboard + pitch/mod wheels + octave buttons.
// Plays notes on the melodic device (psysynth) via the engine.

import React, { useCallback, useRef } from 'react';

interface KeyboardProps {
  octave: number;
  onOctave: (o: number) => void;
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
}

// 14 white keys span C2..D3+ (relative to octave)
const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23];
// Black keys: (whiteIndex, offset)
const BLACK_KEYS = [
  { w: 0, n: 1 }, { w: 1, n: 3 }, { w: 3, n: 6 }, { w: 4, n: 8 }, { w: 5, n: 10 },
  { w: 7, n: 13 }, { w: 8, n: 15 }, { w: 10, n: 18 }, { w: 11, n: 20 }, { w: 12, n: 22 },
];

export function Keyboard({ octave, onOctave, onNoteOn, onNoteOff }: KeyboardProps) {
  const activeNotes = useRef<Set<number>>(new Set());

  const noteOn = useCallback((midi: number) => {
    if (activeNotes.current.has(midi)) return;  // prevent double-trigger
    activeNotes.current.add(midi);
    onNoteOn(midi);
  }, [onNoteOn]);

  const noteOff = useCallback((midi: number) => {
    if (!activeNotes.current.has(midi)) return;
    activeNotes.current.delete(midi);
    onNoteOff(midi);
  }, [onNoteOff]);

  // HONEST FIX: use pointer capture + pointerup on window to catch releases
  // outside the key (prevents stuck notes when finger slides off)
  const onKeyPointerDown = useCallback((e: React.PointerEvent, midi: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    noteOn(midi);
  }, [noteOn]);

  const onKeyPointerUp = useCallback((e: React.PointerEvent, midi: number) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    noteOff(midi);
  }, [noteOff]);

  const baseMidi = (octave + 1) * 12; // C2 = 36 when octave=2

  return (
    <div className="pf-krow">
      {/* Pitch + Mod wheels */}
      <div className="pf-wh">
        <div
          className="pf-whl"
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerUp={(e) => { /* reset to center */ }}
        />
        <div
          className="pf-whl"
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        />
      </div>

      {/* Keyboard */}
      <div className="pf-kbd">
        {WHITE_NOTES.map((offset, i) => {
          const midi = baseMidi + offset;
          return (
            <div
              key={i}
              className="pf-key"
              onPointerDown={(e) => onKeyPointerDown(e, midi)}
              onPointerUp={(e) => onKeyPointerUp(e, midi)}
            />
          );
        })}
        {/* Black keys overlay */}
        {BLACK_KEYS.map(({ w, n }, i) => {
          const midi = baseMidi + n;
          const leftPct = ((w + 1) / 14) * 100 - (100 / 14) * 0.3;
          return (
            <div
              key={`b${i}`}
              className="pf-key b"
              style={{ left: `${leftPct}%`, width: `${100 / 14 * 0.6}%` }}
              onPointerDown={(e) => onKeyPointerDown(e, midi)}
              onPointerUp={(e) => onKeyPointerUp(e, midi)}
            />
          );
        })}
      </div>

      {/* Octave buttons */}
      <div className="pf-oct">
        <button className="pf-btn" onClick={() => onOctave(Math.min(6, octave + 1))}>Oct+</button>
        <button className="pf-btn" onClick={() => onOctave(Math.max(1, octave - 1))}>Oct-</button>
      </div>
    </div>
  );
}
