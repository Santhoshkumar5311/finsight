'use client';
import { useDialog } from '@/lib/useDialog';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X, ArrowUp, AudioLines, LoaderCircle } from 'lucide-react';
import { api } from '@/lib/api';
export default function Recorder({
  onClose,
  onSaved,
  mode,
}: {
  onClose: () => void;
  onSaved: () => void;
  mode: string;
}) {
  useDialog();
  const [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [blob, setBlob] = useState<Blob | null>(null),
    [preview, setPreview] = useState('');
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    canvas = useRef<HTMLCanvasElement | null>(null),
    frame = useRef(0);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(
      () =>
        setSeconds((s) => {
          if (s >= 179) recorder.current?.stop();
          return s + 1;
        }),
      1000,
    );
    return () => clearInterval(id);
  }, [recording]);
  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      void context.current?.close();
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  async function record() {
    try {
      setError('');
      setBlob(null);
      setSeconds(0);
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true },
      });
      stream.current = input;
      const ctx = new AudioContext();
      context.current = ctx;
      const source = ctx.createMediaStreamSource(input),
        filter = ctx.createBiquadFilter(),
        analyser = ctx.createAnalyser(),
        dest = ctx.createMediaStreamDestination();
      filter.type = 'highpass';
      filter.frequency.value = 85;
      source.connect(filter);
      filter.connect(analyser);
      filter.connect(dest);
      analyser.fftSize = 128;
      const bins = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(bins);
        const c = canvas.current;
        const g = c?.getContext('2d');
        if (c && g) {
          g.clearRect(0, 0, c.width, c.height);
          g.fillStyle = '#7d9a57';
          for (let i = 0; i < 48; i++) {
            const h = Math.max(4, (bins[i] / 255) * 70);
            g.beginPath();
            g.roundRect(i * 7, (90 - h) / 2, 3, h, 2);
            g.fill();
          }
        }
        frame.current = requestAnimationFrame(draw);
      };
      draw();
      const mime = ['audio/webm;codecs=opus', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const r = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : {});
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        setBlob(new Blob(chunks, { type: r.mimeType }));
        setRecording(false);
        input.getTracks().forEach((t) => t.stop());
        void ctx.close();
        context.current = null;
        cancelAnimationFrame(frame.current);
      };
      r.start();
      setRecording(true);
    } catch {
      setError(
        'Microphone access is unavailable. Allow microphone access or write a reflection below.',
      );
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      if (blob)
        body.append(
          'audio',
          blob,
          blob.type.includes('mp4') ? 'reflection.m4a' : 'reflection.webm',
        );
      if (text.trim()) body.append('text', text);
      await api('/api/diary', { method: 'POST', body });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-title"
        className="modal recorder"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn modal-close" aria-label="Close recorder" onClick={onClose}>
          <X size={20} />
        </button>
        <span className="eyebrow">
          <AudioLines size={15} /> YOUR MONEY, IN YOUR WORDS
        </span>
        <h2 id="record-title">A moment to reflect.</h2>
        <p>What’s on your mind about money today?</p>
        <div className={'record-ring ' + (recording ? 'recording' : '')}>
          <button
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            onClick={() => (recording ? recorder.current?.stop() : void record())}
          >
            {recording ? <Square size={26} fill="currentColor" /> : <Mic size={30} />}
          </button>
        </div>
        <div className="record-time">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </div>
        <canvas ref={canvas} width={336} height={90} />
        <span className="muted small">
          {recording
            ? 'Listening · noise suppression enabled'
            : blob
              ? 'Recording ready'
              : 'Tap to record · up to 3 minutes'}
        </span>
        {preview && <audio controls src={preview} />}
        <div className="divider-label">or put it into words</div>
        <textarea
          autoFocus
          placeholder="Today, I felt good about…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={12000}
        />
        {mode === 'demo' && (
          <p className="notice">
            Reflections and recordings are encrypted on this computer. Add a written note for
            search; automatic transcription requires live services.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          disabled={busy || recording || (!text.trim() && !blob)}
          className="button primary full"
          onClick={save}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={17} />}{' '}
          {busy
            ? mode === 'live'
              ? 'Transcribing & finding connections…'
              : 'Saving reflection…'
            : 'Save reflection'}
        </button>
      </section>
    </div>
  );
}
