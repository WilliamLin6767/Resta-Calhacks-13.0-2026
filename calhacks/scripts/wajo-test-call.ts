// One-off: a single harmless test call through Wajo's ask_fo, then poll
// get_fo_reply until it finishes, and print the conversation turns.
// Run from calhacks/:  node --env-file=.env.local scripts/wajo-test-call.ts +14153351037
// Never prints the API key.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const number = process.argv[2];
if (!number || !/^\+1\d{10}$/.test(number)) {
  console.error("Pass the number to call in E.164, e.g. +14155550123");
  process.exit(1);
}
const key = process.env.WAJO_API_KEY;
if (!key) {
  console.error("WAJO_API_KEY is not set.");
  process.exit(1);
}

const client = new Client({ name: "calhacks-wajo-test-call", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://mcp.api.wajo.ai/fo"), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  })
);

const message = [
  `Please place one phone call now to ${number}. This is a test of a restaurant's supplier-calling system.`,
  "On the call: say you are an AI assistant testing a calling system for a restaurant called Pho Berkeley,",
  "ask the person to confirm they can hear you clearly, thank them, and hang up. Keep it under one minute.",
  "Do not buy anything, do not send any email or text message, and do not call any other number.",
  "When done, report: whether someone answered, what they said, and how long the call took.",
].join(" ");

type Reply = { status: string; conversationId: string; response?: string; progress?: string; elapsedSeconds?: number };

const asked = await client.callTool({ name: "ask_fo", arguments: { message, newConversation: true } });
let reply = asked.structuredContent as Reply;
console.log("ask_fo ->", JSON.stringify(reply));

const started = Date.now();
while (reply.status === "working" && Date.now() - started < 10 * 60 * 1000) {
  const polled = await client.callTool({
    name: "get_fo_reply",
    arguments: { conversationId: reply.conversationId, waitSeconds: 40 },
  });
  reply = polled.structuredContent as Reply;
  console.log(`[${Math.round((Date.now() - started) / 1000)}s] get_fo_reply ->`, reply.status, reply.progress ?? "");
}
console.log("FINAL:", JSON.stringify(reply, null, 2));

const convo = await client.callTool({ name: "get_fo_conversation", arguments: { conversationId: reply.conversationId } });
console.log("CONVERSATION:", JSON.stringify(convo.structuredContent, null, 2));

await client.close();
