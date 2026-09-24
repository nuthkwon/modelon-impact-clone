/**
 * Time slider (UI_SPEC §5.3) shown at the bottom-centre after a successful simulation:
 * play/pause (≈5 s for the full range), step back/forward (also ← / →), range input, numeric
 * time input with unit "s" and a case selector for multi-case results.
 */
import { useEffect, useState } from 'react';
import { formatNumber } from '@impact/core';
import { useStore } from '../../store';
import { Icon } from '../icons';

const PLAY_DURATION_MS = 5000;
const STEPS = 200;

function isEditableTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.dialog, .cm-editor'));
}

export function TimeSlider() {
  const activeClass = useStore((s) => s.activeClass);
  const view = useStore((s) => s.view);
  const result = useStore((s) => (activeClass ? s.getActiveResult(activeClass) : undefined));
  const sliderTime = useStore((s) => s.sliderTime);
  const playing = useStore((s) => s.sliderPlaying);
  const caseIndex = useStore((s) => s.caseIndex);
  const setSliderTime = useStore((s) => s.setSliderTime);
  const setSliderPlaying = useStore((s) => s.setSliderPlaying);
  const setCaseIndex = useStore((s) => s.setCaseIndex);
  const [text, setText] = useState<string | undefined>(undefined);

  const visible = !!result && (result.status === 'successful' || result.status === 'partial');
  const start = result?.startTime ?? 0;
  const stop = result && result.stopTime > start ? result.stopTime : start + 1;
  const range = stop - start;
  const clamp = (t: number) => Math.min(stop, Math.max(start, t));

  // Playback loop.
  useEffect(() => {
    if (!playing || !visible) return;
    let raf = 0;
    let last = performance.now();
    const speed = range / PLAY_DURATION_MS;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const s = useStore.getState();
      const t = s.sliderTime + dt * speed;
      if (t >= stop) {
        s.setSliderTime(stop);
        s.setSliderPlaying(false);
        return;
      }
      s.setSliderTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, visible, range, stop]);

  // Arrow keys step the slider.
  useEffect(() => {
    if (!visible || view !== 'diagram') return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const s = useStore.getState();
        s.setSliderTime(clamp(s.sliderTime + (e.key === 'ArrowLeft' ? -1 : 1) * (range / STEPS)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, view, range, start, stop]);

  if (!visible || !result) return null;

  const step = (dir: 1 | -1) => setSliderTime(clamp(sliderTime + dir * (range / STEPS)));
  const togglePlay = () => {
    if (playing) setSliderPlaying(false);
    else {
      if (sliderTime >= stop) setSliderTime(start);
      setSliderPlaying(true);
    }
  };
  const commitText = () => {
    if (text === undefined) return;
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v)) setSliderTime(clamp(v));
    setText(undefined);
  };
  const t = clamp(sliderTime);

  return (
    <div className="time-slider" data-canvas-scroll>
      <button className="icon-button" onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Icon.Pause /> : <Icon.Play />}
      </button>
      <button className="icon-button" onClick={() => step(-1)} title="Step back (←)" aria-label="Step back">
        <Icon.SkipPrevious />
      </button>
      <button className="icon-button" onClick={() => step(1)} title="Step forward (→)" aria-label="Step forward">
        <Icon.SkipNext />
      </button>
      <input
        className="time-range"
        type="range"
        min={start}
        max={stop}
        step={range / 1000}
        value={t}
        onChange={(e) => {
          if (playing) setSliderPlaying(false);
          setSliderTime(clamp(Number(e.target.value)));
        }}
        aria-label="Time"
      />
      <input
        className="text-field time-input"
        value={text ?? formatNumber(t, 6)}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setText(formatNumber(t, 6))}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitText();
          else if (e.key === 'Escape') setText(undefined);
        }}
        aria-label="Current time"
      />
      <span className="time-unit">s</span>
      {result.cases.length > 1 && (
        <label className="case-slider">
          <span className="case-label">Case</span>
          <select value={Math.min(caseIndex, result.cases.length - 1)} onChange={(e) => setCaseIndex(Number(e.target.value))} aria-label="Case">
            {result.cases.map((c, i) => (
              <option key={c.id} value={i}>
                {c.meta?.label || `case_${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
