export * from "./generated/api";
export * from "./generated/types";
// Both files name this: the zod path-parameter schema (api) and the query
// type (types). The schema is what the server validates with.
export { WithdrawPullRequestAcceptanceParams } from "./generated/api";
