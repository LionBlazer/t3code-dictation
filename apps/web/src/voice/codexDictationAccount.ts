import type { ProviderInstanceId } from "@t3tools/contracts";

export async function chooseCodexDictationAccount(
  candidates: ReadonlyArray<ProviderInstanceId>,
  probe: (instanceId: ProviderInstanceId) => Promise<boolean>,
  isCurrent: () => boolean,
): Promise<ProviderInstanceId | null> {
  for (const candidate of candidates) {
    if (!isCurrent()) return null;
    const available = await probe(candidate).catch(() => false);
    if (!isCurrent()) return null;
    if (available) return candidate;
  }
  return null;
}
