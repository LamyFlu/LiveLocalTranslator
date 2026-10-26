// Streaming low-pass + fractional resampling for the ASR copy only.
// Playback never passes through this class. State survives audio render quanta.
export class PCMResampler {
  constructor(inputRate, outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || !Number.isFinite(outputRate) || outputRate <= 0) throw Error('Invalid audio sample rate');
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.step = inputRate / outputRate;
    this.index = 0;
    this.next = 0;
    this.previous = 0;
    this.head = 0;
    this.history = new Float32Array(63);
    this.coefficients = new Float64Array(63);
    const cutoff = Math.min(inputRate, outputRate) * 0.45 / inputRate;
    let sum = 0;
    for (let i = 0; i < 63; i++) {
      const n = i - 31;
      const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
      const value = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 62));
      this.coefficients[i] = value;
      sum += value;
    }
    for (let i = 0; i < 63; i++) this.coefficients[i] /= sum;
  }

  push(channels, output) {
    if (!channels.length) return;
    for (let i = 0; i < channels[0].length; i++) {
      let mono = 0;
      for (const channel of channels) mono += channel[i];
      mono /= channels.length;
      let filtered = mono;
      if (this.inputRate !== this.outputRate) {
        this.history[this.head] = mono;
        filtered = 0;
        for (let k = 0; k < 63; k++) filtered += this.coefficients[k] * this.history[(this.head - k + 63) % 63];
        this.head = (this.head + 1) % 63;
      }
      while (this.next <= this.index) {
        const fraction = this.index === 0 ? 1 : this.next - (this.index - 1);
        output(this.previous + (filtered - this.previous) * fraction);
        this.next += this.step;
      }
      this.previous = filtered;
      this.index++;
    }
  }
}
