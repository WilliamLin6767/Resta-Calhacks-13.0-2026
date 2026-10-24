"use client";

import { useRef, useState } from "react";

// Press and hold to record one clip. Release hands that clip to the chat thread.
export default function MicButton({ disabled, onClip, onError, onArm }: { disabled: boolean; onClip: (blob: Blob) => void; onError: (message: string) => void; onArm?: () => void }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const holding = useRef(false);
  const [recording, setRecording] = useState(false);

  async function start(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (disabled || recording) return;
    holding.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (item) => {
        if (item.data.size) chunks.current.push(item.data);
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
      if (!holding.current) stop();
    } catch {
      holding.current = false;
      onError("The microphone needs a secure page. Open the HTTPS address in Safari.");
    }
  }

  function stop() {
    holding.current = false;
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    onArm?.();
    setRecording(false);
    rec.onstop = () => {
      rec.stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size > 0) onClip(blob);
    };
    rec.stop();
  }

  return (
    <button
      type="button"
      aria-label="Hold to talk"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(event) => event.preventDefault()}
      className="flex h-11 w-16 shrink-0 touch-none items-center justify-center rounded-full bg-gray-900 text-sm font-medium text-white select-none disabled:opacity-50"
    >
      {recording ? "..." : "Hold"}
    </button>
  );
}
