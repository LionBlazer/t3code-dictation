import type { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { makeEnvironmentHttpApiGroupClient } from "../rpc/http.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  type EnvironmentHttpAuthHeaders,
} from "../state/environmentHttpAuth.ts";

type VoiceClient = Effect.Success<ReturnType<typeof makeEnvironmentHttpApiGroupClient<"voice">>>;

const requestVoice = Effect.fn("voiceInput.requestVoice")(function* <A, E, R>(
  prepared: PreparedConnection,
  endpoint: "availability" | "start" | "stop" | "finish" | "polish",
  request: (input: {
    client: VoiceClient;
    headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>,
) {
  const signer = yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared,
    signer,
    remoteAuthorization,
    group: "voice",
    method: "POST",
    timeoutMs: 45_000,
    url: (urls) => urls[endpoint](),
    request,
  });
});

export const voiceAvailability = (prepared: PreparedConnection, instanceId: ProviderInstanceId) =>
  requestVoice(prepared, "availability", ({ client, headers }) =>
    client.availability({ headers, payload: { instanceId } }),
  );
export const startVoice = (
  prepared: PreparedConnection,
  instanceId: ProviderInstanceId,
  sdp: string,
) =>
  requestVoice(prepared, "start", ({ client, headers }) =>
    client.start({ headers, payload: { instanceId, sdp } }),
  );
export const stopVoice = (prepared: PreparedConnection, sessionId: string) =>
  requestVoice(prepared, "stop", ({ client, headers }) =>
    client.stop({ headers, payload: { sessionId } }),
  );
