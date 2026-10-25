import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { chatText } from "@/components/ChatText";

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, chatText(text)));

describe("chatText", () => {
  it("shows **bold** as bold and list markers as bullets", () => {
    expect(html("Low:\n- **Bean sprouts:** 10 lb")).toBe('Low:\n• <strong class="font-semibold">Bean sprouts:</strong> 10 lb');
  });

  it("shows a heading as a bold line", () => {
    expect(html("## This week\nAll good")).toBe('<strong class="font-semibold">This week</strong>\nAll good');
  });

  it("leaves plain text, lone asterisks and math alone", () => {
    expect(html("3 * 4 = 12, and -5 is fine")).toBe("3 * 4 = 12, and -5 is fine");
  });
});
