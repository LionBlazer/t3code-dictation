import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { voiceAvailability } from "@t3tools/client-runtime/voice-input";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { runtime } from "../lib/runtime";
import { usePreparedConnection } from "../state/session";
import { chooseCodexDictationAccount } from "./codexDictationAccount";

export function useCodexVoiceAvailability(
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId | ReadonlyArray<ProviderInstanceId>,
  enabled: boolean,
) {
  const connection = usePreparedConnection(environmentId);
  const prepared = connection._tag === "Some" ? connection.value : null;
  const lastWarm = useRef(0);
  const warmRef = useRef(() => {});
  const candidates = typeof instanceId === "string" ? [instanceId] : instanceId;
  const key = JSON.stringify([environmentId, candidates]);
  const [result, setResult] = useState<{
    key: string;
    available: boolean;
    instanceId: ProviderInstanceId | null;
  } | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- A new connection or probe lifetime invalidates the previous server response.
    setResult(null);
    if (!enabled) return;
    if (!prepared) return;
    lastWarm.current = 0;
    const aborter = new AbortController();
    let generation = 0;
    const warm = () => {
      if (document.visibilityState === "hidden" || Date.now() - lastWarm.current < 15_000) return;
      lastWarm.current = Date.now();
      const requestGeneration = ++generation;
      void (async () => {
        const isCurrent = () => !aborter.signal.aborted && requestGeneration === generation;
        const instanceId = await chooseCodexDictationAccount(
          candidates,
          async (candidate) => {
            const response = await runtime.runPromise(voiceAvailability(prepared, candidate), {
              signal: aborter.signal,
            });
            return response.codexVoiceAvailable;
          },
          isCurrent,
        );
        if (isCurrent()) setResult({ key, available: instanceId !== null, instanceId });
      })();
    };
    warmRef.current = warm;
    warm();
    // Returning after the server's idle warm slot expires should start preparing
    // before the user clicks the mic, without keeping a CLI alive in the background.
    window.addEventListener("focus", warm);
    document.addEventListener("visibilitychange", warm);
    return () => {
      aborter.abort();
      warmRef.current = () => {};
      window.removeEventListener("focus", warm);
      document.removeEventListener("visibilitychange", warm);
    };
  }, [key, prepared, candidates, enabled]);
  const prepare = useStableCallback(() => {
    warmRef.current();
  });
  return {
    available: !enabled ? false : result?.key === key ? result.available : null,
    instanceId: enabled && result?.key === key ? result.instanceId : null,
    prepare,
  };
}
