# Wajo MCP tools

Listed from https://mcp.api.wajo.ai/fo on 2026-10-24 by scripts/wajo-list-tools.ts (listTools only; no tool was called).

Server: wajo-fo 0.1.0

## Server instructions

# Fo

Fo is a professional bits-to-atoms mover: it takes what the user asks for in
the digital world and gets it done in the real one (email, calendar, calls,
purchases, and the user's connected integrations), from their own Wajo
account.

- Send the user's request to Fo with `ask_fo`, verbatim and with the context
  Fo needs to act.
- If `ask_fo` returns status `working`, Fo is still busy: keep calling
  `get_fo_reply` yourself (with the same `conversationId` the reply carried;
  each call waits up to 40 seconds for Fo to finish or take its next step)
  until the status is `complete` or `failed`. Relay the `progress` line to the
  user in one short sentence each time so they know Fo is working. Do not ask the user to check
  anything or come back later, and do not send another `ask_fo` while a turn
  is still working.
- If a reply says Fo is waiting for the user's answer, put Fo's question (the
  `progress` line) to the user and send their answer with `ask_fo` instead of
  polling.
- After roughly ten minutes of `working`, tell the user Fo is still on it and
  keeps working even if they leave, and ask whether to keep waiting.
- By default `ask_fo` continues the user's current conversation in this app.
  Start a fresh one (`newConversation: true`) only when the user clearly
  changes topic or asks for a fresh start.
- When the user refers to something they discussed with Fo before, or asks
  what they talked about, call `list_fo_conversations`; it covers every
  channel the user talks to Fo on (chat, email, texting, Slack, voice, and
  this app). Read a thread with `get_fo_conversation` when the details
  matter, and continue it by passing its `conversationId` to `ask_fo`.
- A `conversationId` is always one the server gave you, from
  `list_fo_conversations` or an earlier reply. Never invent or guess one;
  without an id, the current conversation is used. It is an internal handle
  with no meaning to the user: never show it to them.
- When the user wants to talk to Fo out loud, explain something at length, or
  have a live back-and-forth, call `start_fo_call` and give them the link it
  returns as a link to tap. It opens a voice call with Fo on the device they
  are using (no phone number involved), works once, and expires after 10
  minutes; if the host shows a call panel with the result, say they can also
  start the call right there. Call `start_fo_call` again for a fresh link if
  it was not opened in time.
- Relay Fo's reply to the user faithfully. Fo may ask a clarifying question or
  ask for confirmation before acting; pass that back and send the user's
  answer with `ask_fo`.


## Tools (5)

### ask_fo

Send the user's request to Fo, a professional bits-to-atoms mover: Fo takes what the user asks for here and gets it done in the real world from their own Wajo account. It can read and send their email, manage their calendar, place calls, make purchases, and use the integrations they have connected. Continues the user's current Fo conversation by default; pass conversationId (from list_fo_conversations or an earlier reply) to continue a specific one, or set newConversation only when the user clearly changes topic or asks for a fresh start. Long turns return status="working" with a progress line: then keep calling get_fo_reply yourself (each call waits up to 40 seconds) and relay its progress to the user in a sentence until the status is complete or failed; do not send another ask_fo until it settles, and never ask the user to check back. If a reply says Fo is waiting for the user's answer, put Fo's question to the user and send their answer with ask_fo instead of polling. The conversationId is an internal handle: never show it to the user.

Annotations:

```json
{
  "title": "Ask Fo",
  "readOnlyHint": false,
  "destructiveHint": true,
  "idempotentHint": false,
  "openWorldHint": true
}
```

Input schema:

```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "The user's request for Fo, verbatim. Required."
    },
    "conversationId": {
      "type": "string",
      "description": "Continue a specific Fo conversation (an id from list_fo_conversations or an earlier reply). Omit to use the current conversation."
    },
    "newConversation": {
      "type": "boolean",
      "description": "Start a fresh Fo conversation instead of continuing the current one. Default false. Not combinable with conversationId."
    }
  },
  "required": [
    "message"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "response": {
      "type": "string",
      "description": "Fo's reply when complete, or polling guidance when working."
    },
    "status": {
      "type": "string",
      "enum": [
        "complete",
        "working",
        "failed"
      ]
    },
    "conversationId": {
      "type": "string",
      "description": "The conversation the turn ran on. Internal handle; never show it to the user."
    },
    "progress": {
      "type": "string",
      "description": "While working: a one-line account of what Fo is doing, to relay to the user."
    },
    "elapsedSeconds": {
      "type": "integer",
      "description": "While working: seconds since the turn began."
    }
  },
  "required": [
    "status",
    "conversationId"
  ],
  "additionalProperties": false
}
```

### get_fo_conversation

Read the recent transcript of one of the user's Fo conversations (the most recent ~40 turns, oldest first). Pass a conversationId from list_fo_conversations. Use it to recall what the user and Fo discussed before continuing the thread with ask_fo.

Annotations:

```json
{
  "title": "Read a Fo conversation",
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

Input schema:

```json
{
  "type": "object",
  "properties": {
    "conversationId": {
      "type": "string",
      "description": "The conversation to read, from list_fo_conversations. Required."
    }
  },
  "required": [
    "conversationId"
  ],
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "conversation": {
      "type": "object",
      "properties": {
        "conversationId": {
          "type": "string",
          "description": "Server-issued id; pass it back as conversationId."
        },
        "title": {
          "type": "string",
          "description": "Display name, \"Untitled\" when the session has none."
        },
        "channel": {
          "type": "string",
          "description": "Origin: chat (web, the app, an AI app), email, sms, whatsapp, telegram, slack, voice, cron, hook, x."
        },
        "startedAt": {
          "type": "string",
          "format": "date-time",
          "description": "RFC 3339; absent when unknown."
        }
      },
      "required": [
        "conversationId",
        "title",
        "channel"
      ],
      "additionalProperties": false
    },
    "turns": {
      "type": "array",
      "description": "The most recent turns, oldest first. Absent when there are none.",
      "items": {
        "type": "object",
        "properties": {
          "role": {
            "type": "string",
            "enum": [
              "user",
              "assistant"
            ]
          },
          "text": {
            "type": "string"
          },
          "at": {
            "type": "string",
            "format": "date-time",
            "description": "RFC 3339; absent when unknown."
          },
          "runId": {
            "type": "string",
            "description": "The run that produced the turn; a conversation.reply webhook carries the same runId. Absent when unknown."
          }
        },
        "required": [
          "role",
          "text"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "conversation"
  ],
  "additionalProperties": false
}
```

### get_fo_reply

Wait for and fetch Fo's reply after ask_fo returned status="working". Each call waits up to waitSeconds (default 40) for Fo to finish or take its next step, then returns status="complete" with the reply, "failed" with a user-safe explanation, or "working" with a fresh progress line and elapsedSeconds. While the user is waiting, keep calling this yourself and relay progress in one sentence so they know Fo is on it; never ask the user to check anything or come back later. If the response says Fo is waiting for the user's answer, put Fo's question to the user and send their answer with ask_fo instead of polling. After roughly ten minutes of "working", tell the user Fo is still on it and keeps working even if they leave, and ask whether to keep waiting. Pass the conversationId the ask_fo reply carried, or omit it for the current conversation; it is an internal handle, never show it to the user.

Annotations:

```json
{
  "title": "Get Fo's reply",
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

Input schema:

```json
{
  "type": "object",
  "properties": {
    "conversationId": {
      "type": "string",
      "description": "The conversation to poll (from the ask_fo reply). Omit to poll the current conversation."
    },
    "waitSeconds": {
      "type": "integer",
      "minimum": 0,
      "maximum": 40,
      "description": "How long to wait for Fo to finish before answering. Default 40; 0 answers immediately."
    }
  },
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "response": {
      "type": "string",
      "description": "Fo's reply when complete, polling guidance when working, a user-safe explanation when failed."
    },
    "status": {
      "type": "string",
      "enum": [
        "complete",
        "working",
        "failed"
      ]
    },
    "conversationId": {
      "type": "string",
      "description": "The conversation polled. Internal handle; never show it to the user."
    },
    "progress": {
      "type": "string",
      "description": "While working: a one-line account of what Fo is doing, to relay to the user."
    },
    "elapsedSeconds": {
      "type": "integer",
      "description": "While working: seconds since the turn began."
    }
  },
  "required": [
    "response",
    "status",
    "conversationId"
  ],
  "additionalProperties": false
}
```

### list_fo_conversations

List the user's previous conversations with Fo across every channel (chat, email, texting, Slack, voice, and this app), most recently active first, up to 50. Each entry carries a conversationId to pass to get_fo_conversation (read the transcript) or ask_fo (continue the thread). Use it when the user refers to something they discussed with Fo before or asks what they talked about.

Annotations:

```json
{
  "title": "List Fo conversations",
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "conversations": {
      "type": "array",
      "description": "Most recently active first, at most 50. Absent when the user has no Fo conversations.",
      "items": {
        "type": "object",
        "properties": {
          "conversationId": {
            "type": "string",
            "description": "Server-issued id; pass it back as conversationId."
          },
          "title": {
            "type": "string",
            "description": "Display name, \"Untitled\" when the session has none."
          },
          "channel": {
            "type": "string",
            "description": "Origin: chat (web, the app, an AI app), email, sms, whatsapp, telegram, slack, voice, cron, hook, x."
          },
          "startedAt": {
            "type": "string",
            "format": "date-time",
            "description": "RFC 3339; absent when unknown."
          }
        },
        "required": [
          "conversationId",
          "title",
          "channel"
        ],
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

### start_fo_call

Start a live voice call with Fo from the device the user is on right now (phone or computer, no phone number involved): returns a link the user opens to talk to Fo in the browser. Use it when the user wants to talk to Fo out loud, explain something at length, or have a live back-and-forth. Relay the link to the user as a link to tap. It is personal to them, works once, and expires after 10 minutes; call this again for a fresh link if it was not opened in time.

Annotations:

```json
{
  "title": "Call Fo",
  "readOnlyHint": false,
  "destructiveHint": false,
  "idempotentHint": false,
  "openWorldHint": false
}
```

Input schema:

```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

Output schema:

```json
{
  "type": "object",
  "properties": {
    "joinUrl": {
      "type": "string",
      "format": "uri",
      "description": "The link the user opens on their device to talk to Fo. Works once."
    },
    "expiresAt": {
      "type": "string",
      "format": "date-time",
      "description": "RFC 3339; the link stops working at this time if it has not been opened."
    }
  },
  "required": [
    "joinUrl",
    "expiresAt"
  ],
  "additionalProperties": false
}
```
