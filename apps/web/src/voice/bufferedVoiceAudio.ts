import workletUrl from "./voiceAudioBuffer.worklet.js?url";

export type BufferedVoiceAudio = {
  readonly track: MediaStreamTrack;
  release(): void;
  finish(): Promise<void>;
  dispose(): void;
};

export async function createBufferedVoiceAudio(
  microphone: MediaStream,
  onError: (message: string) => void,
): Promise<BufferedVoiceAudio> {
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode | undefined;
  let buffer: AudioWorkletNode | undefined;
  let destination: MediaStreamAudioDestinationNode | undefined;
  let disposed = false;
  let pendingDrain: { resolve(): void; reject(error: Error): void } | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source?.disconnect();
    buffer?.disconnect();
    for (const track of destination?.stream.getTracks() ?? []) track.stop();
    void context.close().catch(() => {});
    pendingDrain?.reject(new Error("Voice input was cancelled."));
    pendingDrain = undefined;
  };
  try {
    await context.audioWorklet.addModule(workletUrl);
    source = context.createMediaStreamSource(microphone);
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
