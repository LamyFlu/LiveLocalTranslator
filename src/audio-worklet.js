import {PCMResampler} from './pcm-resampler.js';
class MonoCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.resampler = new PCMResampler(sampleRate, 16000);
    this.buf = new Float32Array(320);
    this.at = 0;
  }
  process(inputs, outputs) {
    const channels = inputs[0];
    if (channels?.length) this.resampler.push(channels, value => {
      this.buf[this.at++] = value;
      if (this.at === 320) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(320);
        this.at = 0;
      }
    });
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('mono-capture', MonoCapture);
