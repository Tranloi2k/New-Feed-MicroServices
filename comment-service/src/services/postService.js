const POST_SERVICE_URL = process.env.POST_SERVICE_URL;

export async function getPostIdentity(postId) {
  if (!POST_SERVICE_URL || !process.env.SERVICE_SECRET) {
    throw new Error("Post service integration is not configured");
  }
  const response = await fetch(`${POST_SERVICE_URL}/internal/posts/${postId}`, {
    headers: { "X-Service-Token": process.env.SERVICE_SECRET },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) {
    throw new Error(response.status === 404 ? "Post not found" : "Post service unavailable");
  }
  const body = await response.json();
  return body.data;
}
