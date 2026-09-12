// Tool registry. Contract (see docs/TOOL_SPEC.md):
//   { name, description, input_schema (JSON Schema), execute(args) -> string }
// execute() must throw Error/HttpError with a user-readable message on failure.
import { webSearch, activeSearchProvider } from "./websearch.js";
import { fetchUrl } from "./urlfetch.js";
import { gameByUniverse, gameByPlace, userLookup } from "./roblox.js";

export const tools = [
  {
    name: "web_search",
    description:
      "Search the web and get back top results with titles, URLs, and snippets. Use for documentation, APIs, and up-to-date facts.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (args) => webSearch(args.query),
  },
  {
    name: "url_fetch",
    description:
      "Fetch a URL and return its content as text (HTML is converted to plain text). Use to read documentation pages, articles, or JSON API responses.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute http(s) URL" } },
      required: ["url"],
      additionalProperties: false,
    },
    execute: async (args) => fetchUrl(args.url),
  },
  {
    name: "roblox_game_lookup",
    description: "Look up a Roblox game by universeId. Returns name, game id, players, visits.",
    input_schema: {
      type: "object",
      properties: { universeId: { type: "integer", description: "The universe id" } },
      required: ["universeId"],
      additionalProperties: false,
    },
    execute: async (args) => gameByUniverse(args.universeId),
  },
  {
    name: "roblox_game_by_place",
    description:
      "Look up a Roblox game by placeId (e.g. the number in the Studio place URL). Resolves the universe first.",
    input_schema: {
      type: "object",
      properties: { placeId: { type: "integer", description: "The place id" } },
      required: ["placeId"],
      additionalProperties: false,
    },
    execute: async (args) => gameByPlace(args.placeId),
  },
  {
    name: "roblox_user_lookup",
    description: "Look up Roblox users by username. Returns id, display name, created date.",
    input_schema: {
      type: "object",
      properties: {
        usernames: { type: "array", items: { type: "string" }, description: "1 to 10 usernames" },
      },
      required: ["usernames"],
      additionalProperties: false,
    },
    execute: async (args) => userLookup(args.usernames),
  },
  {
    name: "echo",
    description: "Development utility: returns the given text unchanged. Useful for testing the tool pipeline end-to-end.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute: async (args) => String(args.text),
  },
];

export function listTools() {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
export function getTool(name) {
  return tools.find((t) => t.name === name) || null;
}
export { activeSearchProvider };
