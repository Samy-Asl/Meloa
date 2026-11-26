import { transcribe } from './listen.js';

self.onmessage = ({ data }) => {
  const { samples, rate, mode, bpm, enhanced } = data;
  self.postMessage(transcribe(samples, rate, mode, bpm, enhanced));
};
