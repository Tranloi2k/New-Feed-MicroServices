import { gql } from "graphql-tag";

const typeDefs = gql`
  type User {
    id: Int!
    username: String!
    email: String!
    fullName: String
    avatarUrl: String
  }

  type Post {
    id: Int!
    userId: Int!
    user: User
    content: String
    postType: String!
    mediaUrls: [String]
    location: String
    likeCount: Int!
    commentCount: Int!
    shareCount: Int!
    createdAt: String!
    updatedAt: String!
  }

  type NewsFeedResponse {
    posts: [Post!]!
    hasMore: Boolean!
    nextCursor: Int
  }

  input CreatePostInput {
    content: String
    postType: String!
    mediaUrls: [String!]
    location: String
  }

  type CreatePostResponse {
    success: Boolean!
    message: String!
    post: Post
  }

  type Query {
    getNewsFeed(limit: Int, cursor: Int): NewsFeedResponse!
    getPost(id: Int!): Post
  }

  type Mutation {
    createPost(input: CreatePostInput!): CreatePostResponse!
    deletePost(id: Int!): CreatePostResponse!
  }
`;

export default typeDefs;
