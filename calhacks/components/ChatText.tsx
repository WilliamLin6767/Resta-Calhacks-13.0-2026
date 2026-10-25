import { Fragment, type ReactNode } from "react";

// An assistant reply as text. The model sometimes answers in Markdown: **bold** shows as bold,
// "- " list markers as bullets and "# " headings as bold lines, instead of the raw symbols.
// Everything else is left as typed (the parent keeps whitespace-pre-wrap).
export function chatText(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => {
    let body = line.replace(/^(\s*)[-*] /, "$1• ");
    const heading = /^#{1,6} +/.test(body);
    if (heading) body = body.replace(/^#{1,6} +/, "");
    const parts = body.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 === 1 ? <strong key={j} className="font-semibold">{part}</strong> : part));
    return (
      <Fragment key={i}>
        {i > 0 && "\n"}
        {heading ? <strong className="font-semibold">{parts}</strong> : parts}
      </Fragment>
    );
  });
}
