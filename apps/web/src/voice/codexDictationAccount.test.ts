import { ProviderInstanceId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { chooseCodexDictationAccount } from "./codexDictationAccount";

const first = ProviderInstanceId.make("codex-first");
const second = ProviderInstanceId.make("codex-second");

it("uses another subscription when the preferred account is unavailable", async () => {
  const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(chooseCodexDictationAccount([first, second], probe, () => true)).resolves.toBe(
    second,
  );
  expect(probe.mock.calls.map(([id]) => id)).toEqual([first, second]);
});

it("tries another subscription after an account error", async () => {
  const probe = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(true);
  await expect(chooseCodexDictationAccount([first, second], probe, () => true)).resolves.toBe(
    second,
  );
});

it("stops probing after the first authenticated subscription", async () => {
  const probe = vi.fn().mockResolvedValue(true);
  await expect(chooseCodexDictationAccount([first, second], probe, () => true)).resolves.toBe(
    first,
  );
  expect(probe).toHaveBeenCalledOnce();
});

it("discards late availability after a connection or draft change", async () => {
  let current = true;
  let complete!: (available: boolean) => void;
  const probe = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  const chosen = chooseCodexDictationAccount([first, second], probe, () => current);
  current = false;
  complete(true);
  await expect(chosen).resolves.toBeNull();
  expect(probe).toHaveBeenCalledOnce();
});

it("returns unavailable without probing when no account is configured", async () => {
  const probe = vi.fn();
  await expect(chooseCodexDictationAccount([], probe, () => true)).resolves.toBeNull();
  expect(probe).not.toHaveBeenCalled();
});
