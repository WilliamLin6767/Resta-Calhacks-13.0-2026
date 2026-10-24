import { describe, expect, it } from "vitest";
import { createWajo, WajoError } from "../wajo/client";

type ToolOut = Record<string, unknown> | { isError: true; text: string };

// A tiny stand-in for Wajo's MCP server over HTTP: answers initialize and tools/call
// with JSON, and records what was sent (tool calls and the Authorization header).
function fakeWajoServer(tools: Record<string, (args: Record<string, unknown>) => ToolOut>) {
  const sent: { tool: string; args: Record<string, unknown>; auth: string | null }[] = [];
  const fetch = async (_url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(null, { status: 405 }); // no server-sent events
    if (method === "DELETE") return new Response(null, { status: 200 });
    const msg = JSON.parse(String(init?.body));
    if (msg.id === undefined) return new Response(null, { status: 202 }); // a notification
    let result: unknown;
    if (msg.method === "initialize") {
      result = { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-wajo", version: "0" } };
    } else if (msg.method === "tools/call") {
      sent.push({ tool: msg.params.name, args: msg.params.arguments, auth: new Headers(init?.headers).get("authorization") });
      const out = tools[msg.params.name](msg.params.arguments);
      result = "isError" in out
        ? { isError: true, content: [{ type: "text", text: out.text }] }
        : { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
    } else {
      return Response.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not found" } });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "session-1" },
    });
  };
  return { fetch, sent };
}

describe("Wajo client", () => {
  it("starts a call in a new conversation, with the key in the header", async () => {
    const server = fakeWajoServer({ ask_fo: () => ({ status: "working", conversationId: "conv-1", progress: "Dialing" }) });
    const wajo = createWajo({ apiKey: "test-key", fetch: server.fetch });
    expect(await wajo.startCall("Please call +14153351037")).toEqual({ status: "working", conversationId: "conv-1", progress: "Dialing" });
    expect(server.sent).toEqual([{ tool: "ask_fo", args: { message: "Please call +14153351037", newConversation: true }, auth: "Bearer test-key" }]);
  });

  it("answers in the same conversation, and polls without waiting", async () => {
    const server = fakeWajoServer({
      ask_fo: () => ({ status: "working", conversationId: "conv-1" }),
      get_fo_reply: () => ({ status: "complete", conversationId: "conv-1", response: "Done" }),
    });
    const wajo = createWajo({ apiKey: "k", fetch: server.fetch });
    await wajo.answer("conv-1", "Yes, go ahead.");
    expect((await wajo.getCallStatus("conv-1")).response).toBe("Done");
    expect(server.sent.map((s) => s.args)).toEqual([
      { message: "Yes, go ahead.", conversationId: "conv-1" },
      { conversationId: "conv-1", waitSeconds: 0 },
    ]);
  });

  it("reads the conversation turns", async () => {
    const server = fakeWajoServer({
      get_fo_conversation: () => ({ conversation: { conversationId: "conv-1", title: "t", channel: "chat" }, turns: [{ role: "assistant", text: "Reached Tony." }] }),
    });
    expect(await createWajo({ apiKey: "k", fetch: server.fetch }).getTranscript("conv-1")).toEqual([{ role: "assistant", text: "Reached Tony." }]);
  });

  it("turns tool errors and odd replies into WajoError", async () => {
    const failing = fakeWajoServer({ ask_fo: () => ({ isError: true, text: "Not allowed" }) });
    await expect(createWajo({ apiKey: "k", fetch: failing.fetch }).startCall("x")).rejects.toThrow(/Not allowed/);
    const odd = fakeWajoServer({ get_fo_reply: () => ({ status: "dialing" }) });
    await expect(createWajo({ apiKey: "k", fetch: odd.fetch }).getCallStatus("c")).rejects.toBeInstanceOf(WajoError);
  });

  it("needs the API key", async () => {
    const saved = process.env.WAJO_API_KEY;
    delete process.env.WAJO_API_KEY;
    await expect(createWajo().startCall("x")).rejects.toThrow(/WAJO_API_KEY/);
    if (saved !== undefined) process.env.WAJO_API_KEY = saved;
  });
});
