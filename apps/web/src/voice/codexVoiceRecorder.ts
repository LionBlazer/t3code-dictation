import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { startVoice, stopVoice } from "@t3tools/client-runtime/voice-input";
import * as Schema from "effect/Schema";
import { runtime } from "../lib/runtime";
import { readPreparedConnection } from "../state/session";
import {
  createBufferedVoiceAudio,
  type BufferedVoiceAudio,
  type PreparedVoiceAudio,
} from "./bufferedVoiceAudio";
import type {
  ComposerVoiceRecorder,
  ComposerVoiceRecorderCallbacks,
  ComposerVoiceTranscript,
} from "./composerVoiceSession";

const TranscriptEvent = Schema.Struct({
  type: Schema.Literal("input_transcript.added"),
  item: Schema.Struct({ id: Schema.String, text: Schema.String }),
});
const decodeTranscript = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptEvent));

export function prepareCodexVoiceConnection() {
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel("oai-events");
  const sender = peer.addTransceiver("audio", { direction: "sendrecv" }).sender;
  return { peer, channel, sender };
}
export type PreparedCodexVoiceConnection = ReturnType<typeof prepareCodexVoiceConnection>;

// Only input transcripts are used: model answers must never become draft text.
export function readVoiceTranscriptEvent(raw: string): { id: string; text: string } | null {
  const decoded = decodeTranscript(raw);
  return decoded._tag === "Some" ? decoded.value.item : null;
}

export function createCodexVoiceRecorder(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
  microphone: Promise<MediaStream>,
  callbacks: ComposerVoiceRecorderCallbacks,
  preparation?: {
    audio: PreparedVoiceAudio;
    connection: PreparedCodexVoiceConnection;
  },
): ComposerVoiceRecorder {
  const prepared = readPreparedConnection(environmentId);
  if (!prepared) throw new Error("Connect to the environment before dictating.");
  const { peer, channel, sender } = preparation?.connection ?? prepareCodexVoiceConnection();
  let stream: MediaStream | null = null;
  let audio: BufferedVoiceAudio | null = null;
  let connecting: Promise<void> = Promise.resolve();
  let connectionError: Error | null = null;
  let audioDrained = false;
  let transcript = "";
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  let sessionId: string | null = null;
  let disposed = false;
  let finishing = false;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let pendingStop: {
    resolve: (result: ComposerVoiceTranscript) => void;
    reject: (error: Error) => void;
  } | null = null;
  let rejectStart: ((error: Error) => void) | undefined;
  let stoppedAt = 0;

  const closeServer = () => {
    const id = sessionId;
    sessionId = null;
    if (id)
      void runtime.runPromise(stopVoice(prepared, id)).catch(() => {
        // Abandoned sessions are also bounded by the server recording cap.
      });
  };
  const settle = () => {
    if (!pendingStop) return;
    clearTimeout(deadline);
    clearTimeout(finishTimer);
    clearTimeout(previewTimer);
    previewTimer = undefined;
    const original = transcript.trim();
    callbacks.onTranscript(original);
    const pending = pendingStop;
    pendingStop = null;
    pending.resolve({ text: original, locale: navigator.language });
  };
  const waitForTail = () => {
    clearTimeout(finishTimer);
    // v3 has no final-input event. Allow VAD to detect the stop, then require
    // one quiet second since the latest chunk; don't add a second AI turn.
    finishTimer = setTimeout(settle, Math.max(1000, 1500 - (Date.now() - stoppedAt)));
  };
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (disposed || typeof event.data !== "string") return;
    const item = readVoiceTranscriptEvent(event.data);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      transcript += item.text;
      // Bound React/layout work while preserving every received chunk.
      if (previewTimer === undefined)
        previewTimer = setTimeout(() => {
          previewTimer = undefined;
          if (!disposed) callbacks.onTranscript(transcript.trim());
        }, 100);
      if (finishing && audioDrained) waitForTail();
    }
  };
  const fail = (message: string) => {
    if (disposed) return;
    const error = new Error(message);
    rejectStart?.(error);
    pendingStop?.reject(error);
    pendingStop = null;
    callbacks.onError(error);
  };
  peer.onconnectionstatechange = () => {
    if (disposed) return;
    if (peer.connectionState !== "disconnected") {
      clearTimeout(disconnectTimer);
      disconnectTimer = undefined;
    }
    if (peer.connectionState === "failed") {
      fail("Voice connection was interrupted. Please try again.");
    } else if (peer.connectionState === "disconnected" && disconnectTimer === undefined) {
      disconnectTimer = setTimeout(() => {
        disconnectTimer = undefined;
        if (peer.connectionState === "disconnected")
          fail("Voice connection was interrupted. Please try again.");
      }, 5000);
    }
  };
  channel.onclose = () => fail("Voice connection ended. Please try again.");
  // Capture starts locally, independently of the network handshake. The worklet
  // retains the beginning of the phrase and emits silence until Codex is ready.
  const attachMicrophone = microphone.then(async (capture) => {
    if (disposed) {
      for (const track of capture.getTracks()) track.stop();
      return;
    }
    stream = capture;
    if (!capture.getAudioTracks()[0]) throw new Error("No microphone audio track was available.");
    if (finishing) for (const track of capture.getAudioTracks()) track.enabled = false;
    const buffered = await createBufferedVoiceAudio(capture, fail, preparation?.audio);
    if (disposed) {
      buffered.dispose();
      return;
    }
    audio = buffered;
    callbacks.onAudioReady?.(buffered.analyser);
    await sender.replaceTrack(buffered.track);
  });
  void attachMicrophone.catch(() => {});

  return {
    async start() {
      try {
        const negotiate = async () => {
          await peer.setLocalDescription(await peer.createOffer());
          const sdp = peer.localDescription?.sdp;
          if (!sdp) throw new Error("Could not prepare voice input.");
          // Do not abort this HTTP request on cancel: a late answer still carries
          // the session id we must close. The server caps handshake time at 40s.
          const response = await runtime.runPromise(startVoice(prepared, instanceId, sdp));
          sessionId = response.sessionId;
          if (disposed) {
            closeServer();
            return;
          }
          await peer.setRemoteDescription({ type: "answer", sdp: response.sdp });
          await new Promise<void>((resolve, reject) => {
            if (channel.readyState === "open") {
              resolve();
              return;
            }
            const timer = setTimeout(
              () => reject(new Error("Voice connection timed out.")),
              20_000,
            );
            rejectStart = (error) => {
              clearTimeout(timer);
              reject(error);
            };
            channel.onopen = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          rejectStart = undefined;
        };
        connecting = negotiate().then(async () => {
          await attachMicrophone;
          if (!disposed) audio?.release();
        });
        void connecting.catch((error: unknown) => {
          connectionError =
            error instanceof Error ? error : new Error("Could not connect Codex voice.");
          closeServer();
          fail(connectionError.message);
        });
        await attachMicrophone;
        if (connectionError) throw connectionError;
      } catch (error) {
        closeServer();
        throw error;
      }
    },
    stop() {
      if (disposed) return Promise.reject(new Error("Voice input was cancelled."));
      finishing = true;
      if (stream) for (const track of stream.getAudioTracks()) track.enabled = false;
      return new Promise<ComposerVoiceTranscript>((resolve, reject) => {
        pendingStop = { resolve, reject };
        deadline = setTimeout(() => fail("Codex voice connection timed out."), 75_000);
        void (async () => {
          await attachMicrophone;
          const drained = audio?.finish() ?? Promise.resolve();
          // Attach a rejection handler before waiting for a slow connection.
          void drained.catch(() => {});
          await connecting;
          await drained;
          if (disposed || !pendingStop) return;
          audioDrained = true;
          stoppedAt = Date.now();
          clearTimeout(deadline);
          deadline = setTimeout(settle, 8000);
          waitForTail();
        })().catch((error: unknown) =>
          fail(error instanceof Error ? error.message : "Could not finish dictation."),
        );
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(finishTimer);
      clearTimeout(deadline);
      clearTimeout(previewTimer);
      clearTimeout(disconnectTimer);
      rejectStart?.(new Error("Voice input was cancelled."));
      pendingStop?.reject(new Error("Voice input was cancelled."));
      pendingStop = null;
      peer.close();
      audio?.dispose();
      if (stream) for (const track of stream.getTracks()) track.stop();
      closeServer();
    },
  };
}
