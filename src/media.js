import { makeCanvas, sampleImage, SAMPLES } from './engine/image.js';
import { download } from './engine/export.js';

export class MediaSession {
  constructor(onFrame, onChange, onError) {
    this.onFrame = onFrame;
    this.onChange = onChange;
    this.onError = onError;
    this.fps = 12;
    this.time = 0;
    this.duration = 0;
    this.mirrored = false;
    this.playing = false;
    this.message = 'No moving source is active.';
    this.generation = 0;
    this.recording = false;
  }

  async openVideo(file) {
    this.stop();
    const generation = this.generation;
    if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
      if (typeof ImageDecoder !== 'function') throw new Error('Animated GIF decoding is unavailable here. Use a local video instead.');
      const decoder = new ImageDecoder({ type: 'image/gif', data: file.stream() });
      try {
        await decoder.tracks.ready;
        await decoder.completed;
        if (generation !== this.generation) return;
        const count = decoder.tracks.selectedTrack?.frameCount || 0;
        if (!count || count > 600) throw new Error('Choose a GIF with between 1 and 600 frames.');
        this.decoder = decoder;
        this.gifFrames = count;
        this.gifIndex = 0;
        this.duration = count / this.fps;
        this.message = file.name + ' · GIF frames sampled at target FPS';
        await this.capture();
        this.play();
      } finally {
        if (this.decoder !== decoder) decoder.close();
      }
      return;
    }
    const url = URL.createObjectURL(file);
    this.url = url;
    await this.openElement({ src: url }, file.name, generation, false);
  }

  async camera() {
    this.stop();
    const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires a supported browser and a secure context.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    this.stream = stream;
    await this.openElement({ srcObject: stream }, 'Local camera', generation, true);
  }

  async openElement(source, name, generation, camera) {
    const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, loop: !camera, ...source });
    this.video = video;
    try {
      await video.play();
      if (generation !== this.generation) return;
      this.duration = Number.isFinite(video.duration) ? video.duration : 0;
      this.message = name;
      this.play();
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      throw new Error('This browser could not start the selected media. ' + error.message);
    }
  }

  animate() {
    this.stop();
    this.procedural = true;
    this.duration = Math.PI * 2;
    this.message = 'Orbit study · procedural loop';
    this.play();
  }

  play() {
    if (!this.video && !this.procedural && !this.decoder) throw new Error('Open a video or start the orbital animation first.');
    if (this.playing) {
      this.pause();
      return;
    }
    this.playing = true;
    this.video?.play().catch(this.onError);
    this.onChange();
    this.tick();
  }

  pause() {
    clearTimeout(this.timer);
    this.playing = false;
    this.video?.pause();
    this.onChange();
  }

  async tick() {
    if (!this.playing) return;
    const generation = this.generation;
    try {
      await this.capture();
    } catch (error) {
      if (generation === this.generation) {
        this.pause();
        this.onError(error);
      }
      return;
    }
    if (generation !== this.generation || !this.playing) return;
    if (this.procedural) this.time = (this.time + 1 / this.fps) % this.duration;
    if (this.decoder) this.gifIndex = (this.gifIndex + 1) % this.gifFrames;
    this.timer = setTimeout(() => this.tick(), 1000 / this.fps);
  }

  async capture() {
    if (this.procedural) {
      const frame = sampleImage(SAMPLES[1], this.time);
      this.onFrame({ canvas: frame.canvas, name: 'Orbit frame.png', type: 'image/png', size: 0 }, this.time);
      return;
    }
    if (this.decoder) {
      const decoder = this.decoder;
      const { image } = await decoder.decode({ frameIndex: this.gifIndex });
      try {
        if (decoder !== this.decoder) return;
        this.time = this.gifIndex / this.fps;
        this.frameFrom(image, image.displayWidth, image.displayHeight);
      } finally {
        image.close();
      }
      return;
    }
    const video = this.video;
    if (!video?.videoWidth || video.readyState < 2) return;
    this.time = video.currentTime;
    this.frameFrom(video, video.videoWidth, video.videoHeight);
  }

  frameFrom(source, width, height) {
    const scale = Math.min(1, 1000 / Math.max(width, height));
    const canvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const ctx = canvas.getContext('2d');
    if (this.mirrored && this.stream) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    this.onFrame({ canvas, name: 'Media frame.png', type: 'image/png', size: 0 }, this.time);
  }

  async seek(time) {
    if (!this.procedural && !this.decoder && (!this.video || !this.duration)) return;
    this.pause();
    this.time = Math.max(0, Math.min(this.duration, time));
    if (this.decoder) this.gifIndex = Math.min(this.gifFrames - 1, Math.round(this.time * this.fps));
    if (this.video && this.video.currentTime !== this.time) {
      const video = this.video;
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true });
        video.currentTime = this.time;
        setTimeout(resolve, 800);
      });
    }
    await this.capture();
    this.onChange();
  }

  record(canvas) {
    if (this.recording) {
      this.stopRecording();
      return;
    }
    if (!this.playing) throw new Error('Start media playback before recording.');
    if (typeof MediaRecorder !== 'function' || !canvas.captureStream || !MediaRecorder.isTypeSupported('video/webm')) {
      throw new Error('WebM recording is unavailable in this browser.');
    }
    this.recordStream = canvas.captureStream(this.fps);
    const chunks = [];
    const recorder = new MediaRecorder(this.recordStream, { mimeType: 'video/webm' });
    recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
    recorder.onstop = () => {
      if (chunks.length) download(new Blob(chunks, { type: 'video/webm' }), 'ascii-catalyst.webm');
    };
    recorder.onerror = () => this.onError(new Error('The browser could not record the artwork stream.'));
    recorder.start(1000);
    this.recorder = recorder;
    this.recording = true;
    this.recordLimit = setTimeout(() => this.stopRecording(), 120000);
    this.onChange();
  }

  stopRecording() {
    clearTimeout(this.recordLimit);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.recordStream?.getTracks().forEach((track) => track.stop());
    this.recording = false;
    this.recorder = null;
    this.recordStream = null;
    this.onChange();
  }

  stop() {
    this.generation++;
    this.pause();
    this.stopRecording();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) {
      this.video.srcObject = null;
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.decoder?.close();
    Object.assign(this, { video: null, stream: null, url: null, decoder: null, procedural: false, time: 0, duration: 0 });
    this.message = 'No moving source is active.';
    this.onChange();
  }
}
