import { afterEach, expect, it, vi } from "vite-plus/test";

type Processor = {
  port: { onmessage: (event: { data: string }) => void; postMessage: ReturnType<typeof vi.fn> };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

async function setup() {
  vi.resetModules();
  let ProcessorClass!: new () => Processor;
  vi.stubGlobal("sampleRate", 8);
  vi.stubGlobal(
    "AudioWorkletProcessor",
    class {
      port = { onmessage: () => {}, postMessage: vi.fn() };
    },
  );
  vi.stubGlobal("registerProcessor", (_name: string, implementation: new () => Processor) => {
    ProcessorClass = implementation;
  });
  const modulePath: string = "./voiceAudioBuffer.worklet.js";
  await import(modulePath);
  const processor = new ProcessorClass();
  const render = (samples: number[] = []) => {
    const output = new Float32Array(2);
    processor.process([[new Float32Array(samples)]], [[output]]);
    return [...output];
  };
  const message = (data: string) => processor.port.onmessage({ data });
  return { processor, render, message };
}

afterEach(() => vi.unstubAllGlobals());

it("captures the first words before connection and releases them in order", async () => {
  const { render, message } = await setup();
  expect(render([1, 2])).toEqual([0, 0]);
  expect(render([3, 4])).toEqual([0, 0]);
  message("release");
  expect(render([5, 6])).toEqual([1, 2]);
  expect(render()).toEqual([3, 4]);
  expect(render()).toEqual([5, 6]);
});

it("retains a short recording stopped before Codex connects", async () => {
  const { processor, render, message } = await setup();
  render([1, 2]);
  message("stop");
  render([9, 9]);
  expect(processor.port.postMessage).not.toHaveBeenCalled();
  message("release");
  expect(render()).toEqual([1, 2]);
  expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith("drained");
  expect(render()).toEqual([0, 0]);
  expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
});

it("fails explicitly when a slow connection exhausts the bounded buffer", async () => {
  const { processor, render } = await setup();
  for (let frame = 0; frame < 240; frame++) render([1, 2]);
  render([3, 4]);
  expect(processor.port.postMessage).toHaveBeenCalledExactlyOnceWith("overflow");
});
