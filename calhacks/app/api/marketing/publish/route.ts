import { bufferConfig } from "@/lib/marketing/buffer";
import { readPostEdit } from "@/lib/marketing/edit";
import { PublishError } from "@/lib/marketing/publish";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";
import { ownerAction } from "@/lib/agent/gate";
import { sessionLabel } from "@/lib/session";

export const maxDuration = 60;

const perVisitor = createRateLimiter({ limit: 1, windowMs: 20 * 1000 });
const wholeApp = createRateLimiter({ limit: 8, windowMs: 24 * 60 * 60 * 1000 });

function errorResponse(message: string, status: number, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers });
}

// POST /api/marketing/publish
// The Publish button: renders one draft as a JPEG and sends it to Instagram through Buffer.
// It goes through the approval gate (publish_post), whose executor is lib/marketing/publish.ts.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const config = bufferConfig();
  if ("error" in config) return errorResponse(config.error, 500);

  let body: { id?: unknown } & Parameters<typeof readPostEdit>[0];
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send the edited post.", 400);
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("Send the post id.", 400);
  const edit = readPostEdit(body);
  if ("error" in edit) return errorResponse(edit.error, 400);

  const visitor = perVisitor(clientIp(request));
  if (!visitor.ok) {
    return errorResponse(`Wait ${visitor.retryAfterSeconds} seconds before posting another one.`, 429, {
      "Retry-After": String(visitor.retryAfterSeconds),
    });
  }
  const app = wholeApp("marketing-publish");
  if (!app.ok) return errorResponse("The daily posting limit for this demo has been reached.", 429);

  try {
    const { result } = await ownerAction(
      await getSupabase(),
      { tool: "publish_post", title: `Post to Instagram: ${edit.headline}`, summary: `Published post #${id} about ${edit.dishName} from the Marketing page.`, args: { post_id: id, edit } },
      sessionLabel(request),
    );
    return Response.json({ id: result.id, status: result.status, externalLink: result.externalLink });
  } catch (err) {
    if (err instanceof PublishError) return errorResponse(err.message, err.status);
    return errorResponse(err instanceof Error ? err.message : "Could not publish the post.", 500);
  }
}
