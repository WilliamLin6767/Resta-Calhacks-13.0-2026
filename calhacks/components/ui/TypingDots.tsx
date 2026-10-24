// Three dots that bounce in turn while something is being worked on (.typing-dot in globals.css).
// With reduced motion they're still dots.
export default function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1 ${className}`}>
      <span className="sr-only">Working</span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" style={{ animationDelay: `${i * 150}ms` }} aria-hidden="true" />
      ))}
    </span>
  );
}
