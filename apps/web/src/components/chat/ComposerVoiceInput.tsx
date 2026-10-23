import {
  voiceInputBlocksSubmission,
  type VoiceInputState,
} from "@t3tools/client-runtime/voice-input";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { MicIcon, SquareIcon, XIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createDictationFormatter } from "@t3tools/shared/voicePunctuation";
import { useEnvironmentSettings } from "../../hooks/useSettings";

import { VoiceWaveform } from "./VoiceWaveform";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  createCodexVoiceRecorder,
  prepareCodexVoiceConnection,
  type PreparedCodexVoiceConnection,
} from "../../voice/codexVoiceRecorder";
import { prepareVoiceAudio, type PreparedVoiceAudio } from "../../voice/bufferedVoiceAudio";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useCodexVoiceAvailability } from "../../voice/codexVoiceAvailability";
import {
  ComposerVoiceSession,
  formatVoiceElapsed,
  IDLE_COMPOSER_VOICE_STATE,
  requestComposerMicrophone,
  resolveVoiceMicAvailability,
  type ComposerVoiceCommit,
  type ComposerVoiceDraft,
} from "../../voice/composerVoiceSession";

export const ComposerVoiceInput = memo(function ComposerVoiceInput(props: ComposerVoiceInputProps) {
  return <CodexComposerVoiceInput {...props} />;
});

type ComposerVoiceInputProps = {
  readonly onSessionChange: (session: ComposerVoiceSession | null) => void;
  readonly composerDisabled: boolean;
  readonly readDraft: () => ComposerVoiceDraft | null;
  readonly commitDraft: (commit: ComposerVoiceCommit) => boolean;
  readonly instanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly primary: boolean;
  readonly environmentId: EnvironmentId;
  readonly focusDraft: () => void;
  readonly onBusyChange?: (busy: boolean) => void;
};

function CodexComposerVoiceInput(props: ComposerVoiceInputProps) {
  const [voiceState, setVoiceState] = useState<VoiceInputState>(IDLE_COMPOSER_VOICE_STATE);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const audioPreparationRef = useRef<PreparedVoiceAudio | null>(null);
  const connectionPreparationRef = useRef<PreparedCodexVoiceConnection | null>(null);
  const dictation = useEnvironmentSettings(props.environmentId, (settings) => settings.dictation);
  const formatTranscript = createDictationFormatter(dictation);
  const {
    available: serverVoiceAvailable,
    instanceId: voiceInstanceId,
    prepare: prepareVoice,
  } = useCodexVoiceAvailability(props.environmentId, props.instanceIds, true);

  const warmCapture = useStableCallback(() => {
    try {
      audioPreparationRef.current ??= prepareVoiceAudio();
      connectionPreparationRef.current ??= prepareCodexVoiceConnection();
    } catch {
      // Actual capture reports unsupported devices and permissions in the composer.
    }
  });
  useEffect(() => {
    if (!serverVoiceAvailable || voiceInputBlocksSubmission(voiceState)) return;
    const idle = window.requestIdleCallback(warmCapture, { timeout: 1000 });
    return () => window.cancelIdleCallback(idle);
  }, [serverVoiceAvailable, voiceState, warmCapture]);
  useEffect(
    () => () => {
      audioPreparationRef.current?.dispose();
      audioPreparationRef.current = null;
      connectionPreparationRef.current?.peer.close();
      connectionPreparationRef.current = null;
    },
    [],
  );
  const prepareInput = useStableCallback(() => {
    warmCapture();
    prepareVoice();
  });

  const latestRef = useRef({
    readDraft: props.readDraft,
    commitDraft: props.commitDraft,
    formatTranscript,
    voiceInstanceId,
    onSessionChange: props.onSessionChange,
  });
  const busyRef = useRef(props.onBusyChange);
  useLayoutEffect(() => {
    latestRef.current = {
      readDraft: props.readDraft,
      commitDraft: props.commitDraft,
      formatTranscript,
      voiceInstanceId,
      onSessionChange: props.onSessionChange,
    };
    busyRef.current = props.onBusyChange;
  });

  const sessionRef = useRef<ComposerVoiceSession | null>(null);
  useEffect(() => {
    // Constructed here (not during render) so StrictMode effect replay
    // leaves a usable session: the replayed cleanup nulls the ref, and this
    // setup re-creates it. All dependencies are refs, so the session always
    // calls through to the latest props.
    const session = new ComposerVoiceSession({
      readDraft: () => latestRef.current.readDraft(),
      commitDraft: (commit) => latestRef.current.commitDraft(commit),
      formatTranscript: (text) => latestRef.current.formatTranscript(text),
      requestMicrophone: requestComposerMicrophone,
      createRecorder: (stream, callbacks) => {
        const instanceId = latestRef.current.voiceInstanceId;
        if (!instanceId) throw new Error("Sign in to a Codex account to use dictation.");
        const audio = audioPreparationRef.current ?? prepareVoiceAudio();
        audioPreparationRef.current = audio;
        const connection = connectionPreparationRef.current ?? prepareCodexVoiceConnection();
        connectionPreparationRef.current = null;
        const recorder = createCodexVoiceRecorder(
          props.environmentId,
          instanceId,
          stream,
          {
            ...callbacks,
            onAudioReady: (node) => {
              if (sessionRef.current === session && session.busy) setAnalyser(node);
            },
          },
          { audio, connection },
        );
        return recorder;
      },
      onStateChange: (next) => {
        setVoiceState(next);
        if (next.phase !== "recording" && next.phase !== "preparing") setAnalyser(null);
        busyRef.current?.(voiceInputBlocksSubmission(next));
      },
    });
    sessionRef.current = session;
    latestRef.current.onSessionChange(session);
    return () => {
      session.dispose();
      sessionRef.current = null;
      latestRef.current.onSessionChange(null);
      busyRef.current?.(false);
    };
  }, [props.environmentId]);

  useEffect(() => {
    if (voiceState.phase !== "recording") return;
    const timerId = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      session.tick();
      setElapsedSeconds(session.getElapsedSeconds());
    }, 500);
    return () => window.clearInterval(timerId);
  }, [voiceState.phase]);

  const busy = voiceInputBlocksSubmission(voiceState);
  const availability = resolveVoiceMicAvailability({
    codexVoiceAvailable: serverVoiceAvailable === true,
    composerDisabled: props.composerDisabled,
  });
  const availabilityLoading = serverVoiceAvailable === null;

  const handleStart = () => {
    setElapsedSeconds(0);
    props.focusDraft();
    void sessionRef.current?.start();
  };

  const renderInput = () => {
    if (!busy && voiceState.phase !== "error") {
      const startTooltip = availabilityLoading
        ? "Checking voice input availability…"
        : availability.available
          ? "Dictate with Codex - keeps recording in the background"
          : availability.reason;
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              availability.available ? (
                <Button
                  type="button"
                  variant={props.primary ? "default" : "ghost"}
                  size="icon-sm"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={handleStart}
                  onPointerEnter={prepareInput}
                  onFocus={prepareInput}
                  aria-label="Dictate"
                  data-chat-composer-voice="idle"
                />
              ) : (
                <span className="inline-flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled
                    aria-label={startTooltip}
                    data-chat-composer-voice="unavailable"
                  />
                </span>
              )
            }
          >
            <MicIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="top">{startTooltip}</TooltipPopup>
        </Tooltip>
      );
    }

    return (
      <div
        className={
          busy
            ? "relative flex min-w-0 flex-1 items-center gap-3"
            : "relative flex shrink-0 items-center"
        }
        data-chat-composer-voice={voiceState.phase}
      >
        {voiceState.phase === "error" ? (
          <div
            role="alert"
            className="absolute right-0 bottom-full z-10 mb-2 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-md"
          >
            <p className="text-xs">{voiceState.error ?? "Voice input failed."}</p>
            <div className="mt-1.5 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="micro"
                onClick={() => sessionRef.current?.dismissError()}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
        {voiceState.phase === "recording" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => sessionRef.current?.cancel()}
              aria-label="Cancel dictation and keep inserted text"
              title="Cancel dictation and keep inserted text"
            >
              <XIcon className="size-4" />
            </Button>
            <VoiceWaveform analyser={analyser} />
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              aria-label="Recording time"
            >
              {formatVoiceElapsed(elapsedSeconds)}
            </span>
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void sessionRef.current?.stop()}
              aria-label="Stop dictation"
              title="Stop dictation"
            >
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
            <span className="sr-only" role="status">
              Recording. Continues in the background for up to five minutes. Stop or cancel at any
              time.
            </span>
          </>
        ) : voiceState.phase === "error" ? (
          <Tooltip>
            <TooltipTrigger
              render={
                availability.available ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={handleStart}
                    aria-label="Retry dictation"
                  />
                ) : (
                  <span className="inline-flex shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled
                      aria-label={availability.reason}
                    />
                  </span>
                )
              }
            >
              <MicIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {availability.available ? "Retry dictation" : availability.reason}
            </TooltipPopup>
          </Tooltip>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => sessionRef.current?.cancel()}
              aria-label="Cancel voice input"
              title="Cancel voice input"
            >
              <XIcon className="size-4" />
            </Button>
            <span
              className="flex min-w-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"
              role="status"
            >
              <Spinner className="size-4" aria-hidden="true" />
              {voiceState.phase === "preparing"
                ? "Connecting microphone…"
                : "Finishing last words…"}
            </span>
          </>
        )}
      </div>
    );
  };
  return (
    <div className={`flex min-w-0 items-center ${busy ? "flex-1 gap-1" : "shrink-0"}`}>
      {renderInput()}
    </div>
  );
}
