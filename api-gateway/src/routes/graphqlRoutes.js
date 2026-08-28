import express from "express";
import {
  authenticateToken,
  optionalAuthenticateToken,
} from "../middleware/auth.js";

export function createGraphqlRoutes({ proxies }) {
  const router = express.Router();

  router.use(
    "/graphql/post",
    optionalAuthenticateToken,
    proxies.postGraphql
  );
  router.use(
    "/graphql/comment",
    authenticateToken,
    proxies.commentGraphql
  );

  return router;
}
