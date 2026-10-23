/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class DictationAudioBuffer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(sampleRate * 60);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.count = 0;
    this.capturing = true;
    this.released = false;
    this.drained = false;
    this.failed = false;
    this.port.onmessage = ({ data }) => {
      if (data === "release") this.released = true;
      if (data === "stop") this.capturing = false;
    };
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output || this.failed) return true;
    output.fill(0);
    const input = inputs[0]?.[0];
    if (this.capturing && input) {
      if (this.count + input.length > this.samples.length) {
        this.failed = true;
        this.port.postMessage("overflow");
        return true;
      }
      for (const sample of input) {
        this.samples[this.writeIndex] = sample;
        this.writeIndex = (this.writeIndex + 1) % this.samples.length;
      }
      this.count += input.length;
    }
    if (this.released) {
      const available = Math.min(output.length, this.count);
      for (let index = 0; index < available; index++) {
        output[index] = this.samples[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.samples.length;
      }
      this.count -= available;
      if (!this.capturing && this.count === 0 && !this.drained) {
        this.drained = true;
        this.port.postMessage("drained");
      }
    }
    return true;
  }
}

registerProcessor("t3-dictation-buffer", DictationAudioBuffer);
