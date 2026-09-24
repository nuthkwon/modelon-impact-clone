/**
 * Time slider card (UI_SPEC §5.3 / §9) shown at the bottom-centre after a successful
 * simulation: line 1 "Current time: 23.4 s" (the number is an editable 600-weight input) with
 * play/pause (≈5 s for the full range) and step buttons (also ← / →) at the right; line 2 the
 * min label, the range input with the blue knob and the max label; a case selector for
 * multi-case results.
 */
import { useEffect, useRef, useState } from 'react';
import { formatNumber } from '@impact/core';
import { useStore } from '../../store';
import { Icon } from '../icons';
import { canvasOwnsKey, isPointerOver } from './keyScope';

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
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Arrow keys step the slider — only when aimed at the slider card or the diagram (focus, or the
  // pointer over them while nothing is focused): the class tree and results tree use ← / → too.
  useEffect(() => {
    if (!visible || view !== 'diagram') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const card = cardRef.current;
      const svg = card?.closest('.canvas')?.querySelector('.diagram-svg') ?? null;
      const inCard = !!card && e.target instanceof Node && card.contains(e.target);
      if (!inCard && !canvasOwnsKey(svg, e.target, isPointerOver(svg) || isPointerOver(card), document.body)) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setSliderTime(clamp(s.sliderTime + (e.key === 'ArrowLeft' ? -1 : 1) * (range / STEPS)));
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
  const timeText = text ?? formatNumber(t, 6);
  const multiCase = result.cases.length > 1;

  return (
    <div ref={cardRef} className={`time-slider${multiCase ? ' multi-case' : ''}`} data-canvas-scroll data-testid="time-slider">
      <div className="time-row">
        <span className="time-label">
          <span className="time-caption">Current time:</span>
          <input
            className="time-input"
            style={{ width: `${Math.max(2, timeText.length) + 0.6}ch` }}
            value={timeText}
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
        </span>
        <span className="time-controls">
          <button className="icon-button time-play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Icon.Pause /> : <Icon.Play />}
          </button>
          <button className="icon-button" onClick={() => step(-1)} title="Step back (←)" aria-label="Step back">
            <Icon.SkipPrevious />
          </button>
          <button className="icon-button" onClick={() => step(1)} title="Step forward (→)" aria-label="Step forward">
            <Icon.SkipNext />
          </button>
        </span>
      </div>
      <div className="time-row">
        <span className="time-bound min">{formatNumber(start, 6)}</span>
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
        <span className="time-bound max">{formatNumber(stop, 6)}</span>
      </div>
      {multiCase && (
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
