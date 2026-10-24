// What shows while the AI is reading or writing. A slow light sweeps across the words
// (.ai-thinking in globals.css); with reduced motion it's plain gray text.
export default function AiThinking({ label = "Thinking...", className = "" }: { label?: string; className?: string }) {
  return (
    <p role="status" className={`text-sm text-gray-500 ${className}`}>
      <span className="ai-thinking">✦ {label}</span>
    </p>
  );
}
