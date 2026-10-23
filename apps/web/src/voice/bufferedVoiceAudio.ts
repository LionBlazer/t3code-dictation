// The desktop CSP rejects data URLs, so even this small module must be emitted as a file.
import workletUrl from "./voiceAudioBuffer.worklet.js?url&no-inline";

export type BufferedVoiceAudio = {
  readonly track: MediaStreamTrack;
  readonly analyser: AnalyserNode;
  release(): void;
  finish(): Promise<void>;
  dispose(): void;
};

export type PreparedVoiceAudio = {
  readonly context: AudioContext;
  readonly ready: Promise<void>;
  dispose(): void;
};

/** Prepares the audio graph without requesting or opening the microphone. */
export function prepareVoiceAudio(): PreparedVoiceAudio {
  const context = new AudioContext({ latencyHint: "interactive" });
  const ready = Promise.all([context.suspend(), context.audioWorklet.addModule(workletUrl)]).then(
    () => {},
  );
  void ready.catch(() => {});
  return {
    context,
    ready,
    dispose: () => {
      void context.close().catch(() => {});
    },
  };
}

export async function createBufferedVoiceAudio(
  microphone: MediaStream,
  onError: (message: string) => void,
  prepared?: PreparedVoiceAudio,
): Promise<BufferedVoiceAudio> {
  const preparation = prepared ?? prepareVoiceAudio();
  const context = preparation.context;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let buffer: AudioWorkletNode | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let disposed = false;
  let pendingDrain: { resolve(): void; reject(error: Error): void } | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source?.disconnect();
    analyser?.disconnect();
    buffer?.disconnect();
    for (const track of destination?.stream.getTracks() ?? []) track.stop();
    if (prepared) void context.suspend().catch(() => {});
    else preparation.dispose();
    pendingDrain?.reject(new Error("Voice input was cancelled."));
    pendingDrain = undefined;
  };
  try {
    await preparation.ready;
    source = context.createMediaStreamSource(microphone);
    analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    buffer = new AudioWorkletNode(context, "t3-dictation-buffer", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
    });
    destination = context.createMediaStreamDestination();
    buffer.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === "drained") {
        pendingDrain?.resolve();
        pendingDrain = undefined;
      } else if (data === "overflow") {
        onError("Codex took too long to connect. Please try dictating again.");
      }
    };
    source.connect(buffer);
    buffer.connect(destination);
    // The destination feeds WebRTC only; the microphone is never played through speakers.
    await context.resume();
    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("Could not prepare the microphone audio stream.");
    const node = buffer;
    return {
      track,
      analyser,
      release: () => node.port.postMessage("release"),
      finish: () => {
        source?.disconnect();
        return new Promise<void>((resolve, reject) => {
          pendingDrain = { resolve, reject };
          node.port.postMessage("stop");
        });
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
