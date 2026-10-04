/**
 * The places the session schemas deliberately stop describing, as path
 * patterns with the reason each is loose. The checker fails when a loose spot
 * shows up that is not listed here, so looseness cannot creep in unnoticed;
 * the same list is summarized in the schema module's comment.
 */
export interface ExpectedLoosePath {
  pattern: RegExp;
  reason: string;
}

export const expectedLoosePaths: ExpectedLoosePath[] = [
  {
    pattern: /\{(server_)?tool_use\}\.input$/,
    reason: 'tool_use and server_tool_use input: the named tool defines its own input schema',
  },
  {
    pattern: /^assistant\.wireToolInputs$/,
    reason: 'wireToolInputs: a map from tool_use id to that tool input, as sent on the wire',
  },
  {
    pattern: /^user\.toolUseResult$/,
    reason:
      'toolUseResult for MCP tools and the task, team and messaging tools: third-party or unstable shapes',
  },
  {
    pattern: /^user\.mcpMeta$/,
    reason: 'mcpMeta: the MCP result _meta and structuredContent, defined by each MCP server',
  },
  {
    pattern: /^user\.serverClassifierContext\.context$/,
    reason: 'serverClassifierContext.context: the auto-mode classifier internal input',
  },
  {
    pattern: /\{prompt_snapshot\}\.tools\[\]\.schema$/,
    reason: 'prompt_snapshot tool schema: the tool own JSON Schema',
  },
  {
    pattern: /\{deferred_tools_record\}\.entries\[\]\.input_schema$/,
    reason: 'deferred tool input_schema: the tool own JSON Schema',
  },
  {
    pattern: /\{structured_output\}\.data$/,
    reason: 'structured_output data: whatever schema the caller asked the agent to fill',
  },
  {
    pattern: /^journal:result\.result$/,
    reason: 'journal result: the value a workflow agent returned, defined by the workflow script',
  },
  {
    pattern: /\.message\.(stop_details|container)$|\.applied_edits\[\]$/,
    reason:
      'assistant message stop_details, container and applied_edits: API objects, null or empty in real sessions',
  },
  {
    pattern: /^(progress\.data|content-replacement\.replacements\[\])$/,
    reason:
      'progress data and content-replacement entries: binary-only records with no local sample',
  },
  {
    pattern:
      /^(api-request(-shape|-blob)?\.(shape|params|message)|artifact-(comment-monitor|autoreact-ledger)\.artifacts)$/,
    reason: 'api-request and artifact bodies: binary-only records with no local sample',
  },
  {
    pattern: /\.usage\.fallback_credit$/,
    reason: 'usage fallback_credit: outcome of a fallback-credit token, null in real sessions',
  },
];
