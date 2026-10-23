# Dictation and chat model ownership

Dictation is an input capability of the connected environment. It does not belong
to the thread's selected model or provider. The composer collects enabled Codex
instances in that environment, tries the selected instance first when it is Codex,
then probes the remaining instances until one has a ChatGPT login.

```text
Composer → available Codex account → authenticated T3 HTTP handshake
                                  → Codex app-server → ephemeral voice thread
Microphone ───────────────────────── WebRTC ────────────────── OpenAI
Editable draft ← user transcript events ← WebRTC data channel
Send → thread's independently selected chat model
```

Codex owns login, token refresh, and realtime negotiation. T3 never extracts Codex
credentials or calls ChatGPT's private transcription HTTP endpoint. Account
availability is checked through `account/read` in the existing app-server client.
Only user input transcript events reach the draft; model answers and output audio
are not played or inserted. Dictation never submits a chat turn automatically.

Each recording has an ephemeral thread with executable tools and inherited MCP
servers disabled. The recording stays pinned to its originating environment and
account, including cancellation after a delayed handshake. The shared voice input
controller owns draft identity, late results, cancellation, and the recording cap.
Changing chat models does not change the transcription provider.

Microphone capture does not wait for realtime negotiation. An AudioWorklet holds
up to 60 seconds of PCM in memory while WebRTC connects, then drains that audio
into the same WebRTC track before live samples. Stopping during connection keeps
the captured phrase and waits for its audio and transcript to finish. Cancellation
disposes the buffer and microphone. Audio is never written to a recording file.

This uses the experimental Codex realtime interface from PR #12275, rather than a
stable standalone transcription API. Successful authentication alone cannot prove
that an account's current rollout includes realtime access; the handshake remains
the final capability check. Web and desktop share this path. Mobile retains its
existing native dictation path.
