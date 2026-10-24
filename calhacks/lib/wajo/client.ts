// The only code that talks to Wajo (server only). Wajo is an MCP server; its
// agent, Fo, places calls from the account owner's Wajo account. Tool names
// and schemas are in lib/wajo/TOOLS.md:
//
//   ask_fo               start a call (new conversation) or answer Fo's question
//   get_fo_reply         poll: working / complete / failed, with a progress line
//   get_fo_conversation  the turns of one conversation (our transcript)
//
// Fo isn't given to Claude as a tool: only our server calls these, and only
// for a call request the owner approved (lib/calls/service.ts).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

export const WAJO_MCP_URL = "https://mcp.api.wajo.ai/fo";

export class WajoError extends Error {}

const FoReplySchema = z.object({
  status: z.enum(["complete", "working", "failed"]),
  conversationId: z.string(),
  response: z.string().optional(),
  progress: z.string().optional(),
  elapsedSeconds: z.number().optional(),
});
export type FoReply = z.infer<typeof FoReplySchema>;

const ConversationSchema = z.object({
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string(), at: z.string().optional() }))
    .optional(),
});
export type FoTurn = NonNullable<z.infer<typeof ConversationSchema>["turns"]>[number];

export type WajoOptions = { apiKey?: string; fetch?: FetchLike; url?: string };

// What the rest of the app uses. An interface so tests can swap in a fake.
export type WajoApi = {
  startCall(message: string): Promise<FoReply>;
  answer(conversationId: string, text: string): Promise<FoReply>;
  getCallStatus(conversationId: string): Promise<FoReply>;
  getTranscript(conversationId: string): Promise<FoTurn[]>;
};

// One connection per operation: these are rare, and it keeps nothing open between requests.
async function callTool<T extends z.ZodType>(name: string, args: Record<string, unknown>, schema: T, opts: WajoOptions): Promise<z.infer<T>> {
  const apiKey = opts.apiKey ?? process.env.WAJO_API_KEY;
  if (!apiKey) throw new WajoError("WAJO_API_KEY is not set on the server.");

  const transport = new StreamableHTTPClientTransport(new URL(opts.url ?? WAJO_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const client = new Client({ name: "calhacks-calls", version: "0.1.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = Array.isArray(result.content) ? result.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "";
      throw new WajoError(`Wajo ${name} failed: ${text || "no details"}`);
    }
    const parsed = schema.safeParse(result.structuredContent);
    if (!parsed.success) throw new WajoError(`Wajo ${name} returned something unexpected.`);
    return parsed.data;
  } catch (err) {
    if (err instanceof WajoError) throw err;
    // Never include the request (it carries the key); the message is enough.
    throw new WajoError(`Could not reach Wajo: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await client.close().catch(() => {});
  }
}

export function createWajo(opts: WajoOptions = {}): WajoApi {
  return {
    // A fresh conversation per call, so calls never mix.
    startCall: (message) => callTool("ask_fo", { message, newConversation: true }, FoReplySchema, opts),
    answer: (conversationId, text) => callTool("ask_fo", { message: text, conversationId }, FoReplySchema, opts),
    // waitSeconds 0: answer now, our status route polls on its own schedule.
    getCallStatus: (conversationId) => callTool("get_fo_reply", { conversationId, waitSeconds: 0 }, FoReplySchema, opts),
    getTranscript: async (conversationId) =>
      (await callTool("get_fo_conversation", { conversationId }, ConversationSchema, opts)).turns ?? [],
  };
}
