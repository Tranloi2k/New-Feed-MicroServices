export async function togglePostLike(
  tx,
  { postId, userId, likedByName },
  enqueueEvent
) {
  const post = await tx.post.findFirst({
    where: { id: postId, isHidden: false },
  });

  if (!post) return null;

  const existingLike = await tx.postLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });

  if (existingLike) {
    await tx.postLike.delete({
      where: { postId_userId: { postId, userId } },
    });
    await tx.post.updateMany({
      where: { id: postId, likeCount: { gt: 0 } },
      data: { likeCount: { decrement: 1 } },
    });

    return {
      liked: false,
      post: await tx.post.findUnique({ where: { id: postId } }),
    };
  }

  await tx.postLike.create({ data: { postId, userId } });
  const updatedPost = await tx.post.update({
    where: { id: postId },
    data: { likeCount: { increment: 1 } },
  });
  await enqueueEvent(tx, "post.liked", {
    postId,
    postAuthorId: post.userId,
    likedBy: userId,
    likedByName,
  });

  return { liked: true, post: updatedPost };
}
