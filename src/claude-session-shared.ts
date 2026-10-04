import { z } from 'zod';

/**
 * Building blocks shared by the Claude Code session transcript schemas.
 *
 * A session is a JSONL file: one JSON record per line, under
 * `~/.claude/projects/<project>/<session-id>.jsonl`, with each subagent's own
 * transcript in `<session-id>/subagents/agent-<id>.jsonl` and each workflow
 * agent's in `<session-id>/subagents/workflows/<workflow>/agent-<id>.jsonl`.
 * Workflow runs also leave a `journal.jsonl` beside their agents; that is a
 * workflow bookkeeping log with its own record vocabulary (see
 * `claude-session-workflow-journal.ts`), not a transcript.
 *
 * Every object is a `z.looseObject`: a field a newer Claude Code adds must
 * never make a record fail to parse.
 */

/**
 * `CLAUDE_CODE_ENTRYPOINT` values the binary (2.1.288) recognizes. The
 * transcript stores whatever the launching surface set; `cli`,
 * `claude-desktop` and `sdk-cli` are the ones seen in real sessions.
 */
export const claudeSessionEntrypoints = [
  'cli',
  'sdk-cli',
  'sdk-ts',
  'sdk-py',
  'mcp',
  'claude-vscode',
  'claude-desktop',
  'claude-in-teams',
  'claude-code-github-action',
  'local-agent',
  'claude_in_slack',
  'claude-in-slack',
  'remote',
  'remote_baku',
  'remote_cowork',
  'remote_desktop',
  'remote_mobile',
  'remote_projects',
] as const;

/** The permission modes Claude Code records on `permission-mode` and `user` records. */
export const claudeSessionPermissionModes = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
] as const;

/** Effort levels recorded per turn and on `assistant` records. */
export const claudeSessionEffortLevels = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** The colors a subagent or teammate can be given. */
export const claudeSessionAgentColors = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const;

/** Why a tool call was denied, as recorded on the `user` record carrying its result (`toolDenialKind`). */
export const claudeSessionToolDenialKinds = [
  'user-rejected',
  'permission-rule',
  'automode-blocked',
  'automode-unavailable',
  'automode-parsing-error',
  'interrupted',
  'cancelled',
] as const;

/** `error` on an assistant record that stands for an API failure (the same set hooks see as `StopFailure.error`). */
export const claudeSessionApiErrors = [
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'rate_limit',
  'overloaded',
  'invalid_request',
  'model_not_found',
  'server_error',
  'unknown',
  'max_output_tokens',
  'cloud_credential_error',
] as const;

/** `stop_reason` values the Messages API reports; `null` while a message is still streaming. */
export const claudeSessionStopReasons = [
  'end_turn',
  'max_tokens',
  'stop_sequence',
  'tool_use',
  'pause_turn',
  'refusal',
  'model_context_window_exceeded',
] as const;

/** Fields every conversation-chain record (`user`, `assistant`, `system`, `attachment`) carries. */
export const transcriptFields = {
  uuid: z.string(),
  // `null` for the first record of a session and for records severed by a compaction.
  parentUuid: z.string().nullable(),
  sessionId: z.string(),
  timestamp: z.string(),
  isSidechain: z.boolean(),
  // Hard-coded to `external` in the binary; it is a build-channel marker, not a user role.
  userType: z.literal('external'),
  cwd: z.string(),
  version: z.string(),
  // Conditional in the binary (`CLAUDE_CODE_ENTRYPOINT` may be unset), so optional here.
  entrypoint: z.enum(claudeSessionEntrypoints).optional(),
  gitBranch: z.string().optional(),
  // Present on subagent and teammate transcripts.
  agentId: z.string().optional(),
  agentName: z.string().optional(),
  teamName: z.string().optional(),
  // A human-readable session slug (`adjective-adjective-noun`).
  slug: z.string().optional(),
  // A snake_case twin of `sessionId`, written by SDK-launched sessions.
  session_id: z.string().optional(),
};

/** A record of one `type`, with no shared fields (the metadata and bookkeeping records). */
export function sessionRecord<Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) {
  return z.looseObject({ type: z.literal(type), ...shape });
}

/** A conversation-chain record of one `type`: the shared transcript fields plus its own. */
export function transcriptRecord<Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) {
  return z.looseObject({ type: z.literal(type), ...transcriptFields, ...shape });
}

/** Any JSON object whose keys are not modelled (tool inputs, MCP payloads, maps keyed by id). */
export const looseRecord = z.record(z.string(), z.unknown());

/**
 * Where a user-side message came from, on `user` records and `queued_command`
 * attachments: the human at the keyboard, a task notification, a coordinator,
 * a channel, an observer, or another session (`peer`). Shaped after the
 * binary's own `origin` schema, with the extra peer fields real sessions carry.
 */
export const messageOrigin = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('human') }),
  z.looseObject({ kind: z.literal('channel'), server: z.string() }),
  z.looseObject({
    kind: z.literal('peer'),
    from: z.string(),
    // The sending session's permission class: `bypass` runs tools without asking.
    fromMode: z.enum(['bypass', 'prompting']).optional(),
    name: z.string().optional(),
    fromSession: z.string().optional(),
    inbound_origin: z.string().optional(),
    senderTaskId: z.string().optional(),
    body: z.string().optional(),
    verifiedPeerPid: z.number().optional(),
    handback: z.boolean().optional(),
    hopChain: z.array(z.string()).optional(),
    msg_id: z.string().optional(),
  }),
  z.looseObject({
    kind: z.literal('task-notification'),
    subkind: z
      .enum(['scheduled-trigger', 'peer-send-message', 'projects-relay', 'session-inbox'])
      .optional(),
    // Why a scheduled trigger fired: a short lowercase token (`scheduled`, `manual`, `retry`, ...).
    fireReason: z.string().optional(),
    // `session-task` when the notification reports on work this session itself launched.
    producer: z.literal('session-task').optional(),
  }),
  z.looseObject({ kind: z.literal('coordinator') }),
  z.looseObject({ kind: z.literal('unclassified') }),
  z.looseObject({ kind: z.literal('observer'), from: z.string(), senderTaskId: z.string() }),
  z.looseObject({ kind: z.literal('auto-continuation') }),
  z.looseObject({ kind: z.literal('observer-activity') }),
  // Named in the binary's origin switch; no shape is published for it.
  z.looseObject({ kind: z.literal('slack-ping') }),
]);
