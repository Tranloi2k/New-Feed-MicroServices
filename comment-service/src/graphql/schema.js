import { gql } from "graphql-tag";

const typeDefs = gql`
  type User {
    id: Int!
    username: String!
    email: String!
    fullName: String
    avatarUrl: String
  }

  type Comment {
    id: Int!
    postId: Int!
    userId: Int!
    user: User
    content: String!
    parentCommentId: Int
    likeCount: Int!
    createdAt: String!
    updatedAt: String!
    replies: [Comment]
  }

  type CommentsResponse {
    comments: [Comment!]!
    hasMore: Boolean!
    nextCursor: Int
  }

  input CreateCommentInput {
    postId: Int!
    content: String!
    parentCommentId: Int
  }

  type CreateCommentResponse {
    success: Boolean!
    message: String!
    comment: Comment
  }

  type Query {
    getComments(postId: Int!, limit: Int, cursor: Int): CommentsResponse!
  }

  type Mutation {
    createComment(input: CreateCommentInput!): CreateCommentResponse!
    deleteComment(id: Int!): CreateCommentResponse!
  }

  type Subscription {
    """
    Subscribe to new comments on a specific post.
    Real-time updates when a comment is created.
    """
    commentAdded(postId: Int!): Comment!

    """
    Subscribe to comment updates on a specific post.
    Real-time updates when a comment is edited.
    """
    commentUpdated(postId: Int!): Comment!

    """
    Subscribe to comment deletions on a specific post.
    Returns the ID of the deleted comment.
    """
    commentDeleted(postId: Int!): Int!
  }
`;

export default typeDefs;
