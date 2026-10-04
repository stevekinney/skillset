/**
 * `z.string()` fields that look like small closed sets in real data but are
 * deliberately left as strings, each with the reason. The checker prints these
 * separately so a field that is genuinely undecided stands out.
 *
 * A pattern matches the `group:path` key the checker reports, for example
 * `response_item/function_call:.payload.namespace`.
 */
export const openStringFields: [pattern: RegExp, reason: string][] = [
  [
    /\.(?:name|namespace|server|server_name|tool_name|tool)$|executed_tool_calls\[\]\.name$/,
    'tool, namespace and MCP server names come from plugins, MCP servers and user configuration',
  ],
  [
    /rate_limits\.limit_(?:id|name)$/,
    'rate-limit buckets are named by the server, per model family',
  ],
  [
    /content_item_kinds\[\]$/,
    '`ContentItemKind` is a newtype over `String`, a free-form label with no enum behind it',
  ],
  [/(?:comp_hash|compaction_model_hash)$/, 'opaque compaction compatibility hashes, not a set'],
  [
    /\.(?:model_provider|model_provider_id|service_tier)$/,
    'Rust types these as `String`: providers and tiers are user configuration and server-defined',
  ],
  [
    /\.active_permission_profile\.id$/,
    'permission profile ids are user-definable (`:danger-full-access` is only a built-in)',
  ],
  [
    /environments\.\*\.(?:shell|status)$/,
    'Rust types the world-state environment as a free `serde_json::Map`',
  ],
  [
    /results\[\]\.type$/,
    'search results are raw `serde_json::Value`; only `text_result` has been seen',
  ],
  [/\.provenance\.model$|\.model$/, 'model names'],
  [/\.subpath$/, 'a path segment'],
  [/agent_(?:role|nickname)$/, 'agent roles and nicknames are user configuration'],
  [/\.branch$/, 'a git branch name'],
];
