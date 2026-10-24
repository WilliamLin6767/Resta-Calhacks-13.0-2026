// Publishes one image post to the restaurant's Instagram channel through Buffer.
// https://developers.buffer.com/guides/posts-and-scheduling.html

const ENDPOINT = "https://api.buffer.com";

export type PublishedPost = {
  id: string;
  status: string;
  externalLink: string | null;
  error: string | null;
};

type GraphError = { message?: string };
type CreatePayload = {
  __typename?: string;
  message?: string;
  post?: { id: string; status: string; externalLink?: string | null; error?: { message: string } | null };
};

export function bufferConfig(): { key: string; channelId: string } | { error: string } {
  const key = process.env.BUFFER_API_KEY;
  const channelId = process.env.BUFFER_CHANNEL_ID;
  if (!key || !channelId) {
    return { error: "BUFFER_API_KEY and BUFFER_CHANNEL_ID are missing. Add them to the server env file. They are not sent to the browser." };
  }
  return { key, channelId };
}

export async function publishToInstagram(input: { text: string; imageUrl: string; alt: string }): Promise<PublishedPost> {
  const config = bufferConfig();
  if ("error" in config) throw new Error(config.error);

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id status externalLink error { message } } }
          ... on MutationError { message }
        }
      }`,
      variables: {
        input: {
          text: input.text,
          channelId: config.channelId,
          schedulingType: "automatic",
          mode: "shareNow",
          assets: [{ image: { url: input.imageUrl, metadata: { altText: input.alt } } }],
          metadata: { instagram: { type: "post", shouldShareToFeed: true, isAiGenerated: false } },
        },
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as { errors?: GraphError[]; data?: { createPost?: CreatePayload } } | null;
  if (!response.ok) throw new Error(`Buffer returned ${response.status}.`);
  if (body?.errors?.length) throw new Error(body.errors.map((error) => error.message ?? "Buffer rejected the post.").join(" "));

  const payload = body?.data?.createPost;
  if (!payload) throw new Error("Buffer did not return a post.");
  if (payload.__typename !== "PostActionSuccess" || !payload.post) {
    throw new Error(payload.message ?? "Buffer rejected the post.");
  }
  return {
    id: payload.post.id,
    status: payload.post.status,
    externalLink: payload.post.externalLink ?? null,
    error: payload.post.error?.message ?? null,
  };
}
