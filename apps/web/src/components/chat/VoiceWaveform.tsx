import { useEffect, useRef } from "react";
import { observeResize } from "~/lib/observeResize";

const HISTORY_INTERVAL_MS = 150;

export function VoiceWaveform({ analyser }: { readonly analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    const levels = new Float32Array(180);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous = 0;
    let historyTime = performance.now();
    let envelope = 0;
    let peak = 0;
    let width = 0;
    const height = 32;
    let colour = getComputedStyle(canvas).color;
    const resize = () => {
      width = canvas.clientWidth;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = height * scale;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      colour = getComputedStyle(canvas).color;
    };
    const stopObserving = observeResize(canvas, resize);
    resize();
    const schedule = () => {
      if (document.hidden) return;
      if (reducedMotion.matches) timer = setTimeout(() => draw(performance.now()), 250);
      else frame = requestAnimationFrame(draw);
    };
    const draw = (time: number) => {
      if (document.hidden) return;
      const delta = previous ? Math.min(time - previous, 100) : 16;
      previous = time;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const rms = Math.sqrt(energy / samples.length);
      const level = Math.min(1, Math.pow(Math.max(0, rms - 0.005) * 6, 0.65));
      // Smoothing is time-based so 60, 144 and 240 Hz displays react identically.
      envelope += (level - envelope) * (1 - Math.exp(-delta / (level > envelope ? 20 : 90)));
      peak = Math.max(peak, envelope);
      if (time - historyTime >= HISTORY_INTERVAL_MS) {
        levels.copyWithin(0, 1);
        levels[levels.length - 1] = peak;
        peak = 0;
        historyTime = time - ((time - historyTime) % HISTORY_INTERVAL_MS);
      }
      const scroll = reducedMotion.matches ? 0 : ((time - historyTime) / HISTORY_INTERVAL_MS) * 7;
      context.clearRect(0, 0, width, height);
      context.fillStyle = colour;
      const count = Math.min(levels.length, Math.ceil(width / 7));
      for (let index = 0; index < count; index++) {
        const amplitude = reducedMotion.matches
          ? envelope
          : Math.max(levels[levels.length - count + index]!, index === count - 1 ? envelope : 0);
        const barHeight = 3 + amplitude * 25;
        context.globalAlpha = 0.3 + amplitude * 0.6;
        context.beginPath();
        context.roundRect(
          width - (count - index) * 7 - scroll,
          (height - barHeight) / 2,
          3,
          barHeight,
          1.5,
        );
        context.fill();
      }
      // Only this small canvas repaints, only while recording in a visible app.
      schedule();
    };
    const visibilityChanged = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      previous = 0;
      historyTime = performance.now();
      schedule();
    };
    document.addEventListener("visibilitychange", visibilityChanged);
    reducedMotion.addEventListener("change", visibilityChanged);
    visibilityChanged();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      stopObserving();
      document.removeEventListener("visibilitychange", visibilityChanged);
      reducedMotion.removeEventListener("change", visibilityChanged);
    };
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className="h-8 min-w-0 flex-1 text-foreground"
      role="img"
      aria-label="Live microphone waveform"
    />
  );
}
