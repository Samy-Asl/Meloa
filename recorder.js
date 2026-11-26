class MonoRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.remaining = options.processorOptions.frames;
    this.chunk = new Float32Array(2048);
    this.used = 0;
    this.port.onmessage = () => this.finish();
  }
  flush() {
    if (this.used) this.port.postMessage(this.chunk.slice(0, this.used));
    this.used = 0;
  }
  finish() {
    if (this.remaining < 0) return;
    this.flush();
    this.remaining = -1;
    this.port.postMessage(null);
  }
  process(inputs) {
    const input = inputs[0][0];
    if (this.remaining <= 0) return false;
    if (!input) return true;
    for (const value of input) {
      this.chunk[this.used++] = value;
      if (this.used === this.chunk.length) this.flush();
      if (!--this.remaining) {
        this.finish();
        return false;
      }
    }
    return true;
  }
}
registerProcessor('meloa-mic', MonoRecorder);
