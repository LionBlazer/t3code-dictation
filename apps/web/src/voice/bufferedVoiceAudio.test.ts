import { afterEach, expect, it, vi } from "vite-plus/test";
import { createBufferedVoiceAudio, prepareVoiceAudio } from "./bufferedVoiceAudio";

afterEach(() => vi.unstubAllGlobals());

it("warms without a microphone, shares the recording context with the meter, and reuses it", async () => {
  const stopTrack = vi.fn();
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const analyser = { fftSize: 0, disconnect: vi.fn() };
  const context = {
    suspend: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamDestination: vi.fn(() => ({
      stream: { getAudioTracks: () => [track], getTracks: () => [track] },
    })),
  };
  const track = { stop: stopTrack };
  const AudioContext = vi.fn(function () {
    return context;
  });
  vi.stubGlobal("AudioContext", AudioContext);
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null, postMessage: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
    },
  );
  const prepared = prepareVoiceAudio();
  await prepared.ready;
  expect(context.createMediaStreamSource).not.toHaveBeenCalled();
  expect(context.resume).not.toHaveBeenCalled();
  for (let recording = 0; recording < 2; recording++) {
    const capture = await createBufferedVoiceAudio({} as MediaStream, vi.fn(), prepared);
    expect(capture.analyser).toBe(analyser);
    capture.dispose();
  }
  expect(AudioContext).toHaveBeenCalledTimes(1);
  expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
  expect(context.resume).toHaveBeenCalledTimes(2);
  expect(stopTrack).toHaveBeenCalledTimes(2);
  expect(context.close).not.toHaveBeenCalled();
  prepared.dispose();
  expect(context.close).toHaveBeenCalledTimes(1);
});
