import { claudeModTriageRules } from './claude-mod-drift-triage.js';
import {
  codexAppServerReferenceFingerprints,
  codexAppServerTriageRules,
} from './codex-app-server-drift-triage.js';
import { codexConfigurationTriageRules } from './codex-configuration-drift-triage.js';
import type { corpora } from './provider-artifacts.js';

export const triageLabels = {
  'skillset-format': 'Affects a Skillset format',
  'upstream-only': 'Upstream-only',
  'needs-verification': 'Needs verification',
} as const;

type Corpus = (typeof corpora)[number];
type TriageCategory = keyof typeof triageLabels;
export const triageCategories = [
  'skillset-format',
  'upstream-only',
  'needs-verification',
] as const satisfies readonly TriageCategory[];
type Triage = { category: TriageCategory; reason: string };
export type FindingAction = 'review-skillset' | 'verify-scope' | 'reference-only' | 'reconciled';
type Rule = Triage & { paths: readonly string[] };

const rules: Partial<Record<Corpus, { artifact: string; rules: readonly Rule[] }>> = {
  'Codex configuration': {
    artifact: 'config.schema.json',
    rules: codexConfigurationTriageRules,
  },
  'Codex App Server JSON-RPC': {
    artifact: 'codex_app_server_protocol.schemas.json',
    rules: codexAppServerTriageRules,
  },
  'Claude Code Mods': {
    artifact: 'claude-code.d.ts',
    rules: claudeModTriageRules,
  },
  'Claude Agent SDK declarations': {
    artifact: 'sdk.d.ts',
    rules: [
      {
        category: 'skillset-format',
        paths: ['/AgentDefinition/0/declaration/typeAnnotation/members/autoCompactWindow'],
        reason: 'Skillset validates the corresponding Claude subagent frontmatter field.',
      },
      {
        category: 'skillset-format',
        paths: ['/SDKMessageOrigin/0/declaration/typeAnnotation/types/3/members'],
        reason: 'Skillset parses the task-notification origin stored on Claude user records.',
      },
      {
        category: 'skillset-format',
        paths: ['/Settings/0/declaration/body/body/hooks'],
        reason:
          'The SDK Settings declaration includes classic hook settings that Skillset validates.',
      },
      {
        category: 'skillset-format',
        paths: [
          '/ModelUsage/0/declaration/typeAnnotation/members/cacheCreationEphemeral1hInputTokens',
          '/ModelUsage/0/declaration/typeAnnotation/members/cacheCreationEphemeral5mInputTokens',
        ],
        reason: 'Skillset parses both cache-write token counters in saved cost-state records.',
      },
      {
        category: 'upstream-only',
        paths: [
          '/archiveSession',
          '/unarchiveSession',
          '/SDKSessionInfo/0/declaration/typeAnnotation/members/archived',
        ],
        reason:
          'The SDK stores archive state beside the transcript and returns it in its session inventory. Skillset parses the transcript itself.',
      },
      {
        category: 'upstream-only',
        paths: [
          '/SDKBackgroundTasksChangedMessage',
          '/SDKAssistantMessage/0/declaration/typeAnnotation/members/agent_id',
          '/SDKMessage',
          '/SDKRateLimitInfo',
          '/SDKResultError',
          '/SDKResultSuccess',
          '/SDKSessionWritesLostMessage',
          '/SDKStartupFailureReason',
          '/SDKSystemMessage',
          '/SDKTaskNotificationMessage',
          '/SDKTaskProgressMessage',
          '/SDKTaskStartedMessage',
          '/SDKTaskUpdatedMessage',
          '/SDKUserMessage/0/declaration/typeAnnotation/members/agent_id',
          '/module coreTypes/ExportNamedDeclaration/0/specifiers/SDKSessionWritesLostMessage',
        ],
        reason:
          'These changes describe SDK stream envelopes. Skillset separately validates saved task-notification origin and usage data.',
      },
      {
        category: 'upstream-only',
        paths: [
          '/BUILTIN_TOOL_NAMES',
          '/DeniedModelsMatch',
          '/LEGACY_TOOL_NAME_ALIASES',
          '/McpSdkServerConfig',
          '/Options/0/declaration/typeAnnotation/members/mcpServersDelivery',
          '/PublishedSandboxSettingsSchema',
          '/Query/0/declaration/body/body/reloadPlugins',
          '/ResolvedSettings/0/declaration/typeAnnotation/members/machinePolicy',
          '/SDKPermissionRuleEntry',
          '/SandboxSettings',
          '/SandboxSettingsSchema',
          '/USAGE_TRANSITION_PREFIXES',
          '/import from child_process',
          '/matchDeniedModels',
        ],
        reason:
          'These declarations are used by the SDK for in-process MCP, settings resolution, policy, and subprocess handling.',
      },
      {
        category: 'upstream-only',
        paths: [
          'additionalMarketplaces',
          'allowedMarketplaces',
          'blockedMarketplaces',
          'extraKnownMarketplaces',
          'strictKnownMarketplaces',
          'allowNestedModelAccessUnderForceLogin',
          'attributionProject',
          'attributionProjectPolicy',
          'autoMode',
          'desktopMcpServersListScope',
          'disableReplyCheck',
          'disableWindowsBashCommandSplit',
          'idleCompaction',
          'permissions',
          'sandbox',
          'skipAutoPermissionPrompt',
          'sshHostCommands',
          'useAutoModeDuringPlan',
        ].map((name) => `/Settings/0/declaration/body/body/${name}`),
        reason: 'Skillset leaves these Claude Code host settings to their owning configuration.',
      },
      {
        category: 'upstream-only',
        paths: [
          '/HookCallbackMatcher',
          '/SDKHookCallbackMatcher',
          '/SDKControlInitializeResponse',
          '/SDKControlGetContextUsageResponse',
          '/SDKControlGetUsageResponse',
          '/ControlErrorResponse',
          '/ControlResponse',
          '/SDKControlElicitationRequest',
          '/SDKControlInitializeRequest',
          '/SDKControlMcpCallRequest',
          '/SDKControlMcpStatusRequest',
          '/SDKControlPermissionRulesState',
          '/SDKControlReadFileResponse',
          '/SDKControlReloadPluginsRequest',
          '/SDKControlRequestInner',
          '/SDKControlSetHasSubscribersRequest',
        ],
        reason:
          'Skillset implements classic hook configuration and payloads. The Agent SDK owns callback registration and the control protocol.',
      },
    ],
  },
  'Claude Code settings (SchemaStore)': {
    artifact: 'claude-code-settings.json',
    rules: [
      {
        category: 'upstream-only',
        paths: ['/properties/env/propertyNames/pattern'],
        reason:
          'Skillset validates MCP entries. Claude Code owns the separate settings environment map.',
      },
      {
        category: 'upstream-only',
        paths: ['/properties/blockedMarketplaces', '/properties/strictKnownMarketplaces'],
        reason: 'Skillset does not author Claude Code marketplace policy settings.',
      },
    ],
  },
};

/** Classify scope independently of whether this exact change was reviewed. */
export function classifyFinding(corpus: Corpus, artifact: string, path: string): Triage {
  if (corpus === 'Codex hook payloads') {
    return {
      category: 'skillset-format',
      reason: 'Skillset parses generated Codex lifecycle hook payload contracts.',
    };
  }
  const scope = rules[corpus];
  const rule =
    scope?.artifact === artifact
      ? scope.rules.find(({ paths }) =>
          paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
        )
      : undefined;
  return rule
    ? { category: rule.category, reason: rule.reason }
    : {
        category: 'needs-verification',
        reason: 'No scoped rule establishes how this path relates to Skillset.',
      };
}

/** Label findings while preserving their paths, fingerprints, and review evidence. */
export function triageFindings<Finding extends { path: string; fingerprint?: string }>(
  corpus: Corpus,
  artifact: string,
  findings: Finding[],
  reconciled = false,
) {
  return findings.map((finding) => {
    const triage = classifyFinding(corpus, artifact, finding.path);
    const action = findingAction(
      corpus,
      artifact,
      triage.category,
      finding.fingerprint,
      reconciled,
    );
    return { ...finding, triage: { ...triage, action } };
  });
}

function findingAction(
  corpus: Corpus,
  artifact: string,
  category: TriageCategory,
  fingerprint: string | undefined,
  reconciled: boolean,
): FindingAction {
  if (reconciled) return 'reconciled';
  if (category === 'needs-verification') return 'verify-scope';
  if (category === 'upstream-only') return 'reference-only';
  const auditedWireDifference =
    corpus === 'Codex App Server JSON-RPC' &&
    artifact === 'codex_app_server_protocol.schemas.json' &&
    fingerprint !== undefined &&
    codexAppServerReferenceFingerprints.has(fingerprint);
  return auditedWireDifference ? 'reference-only' : 'review-skillset';
}

/** Count all three categories, including those with no findings. */
export function countTriage(findings: Iterable<{ triage: Triage }>) {
  const counts = { 'skillset-format': 0, 'upstream-only': 0, 'needs-verification': 0 };
  for (const { triage } of findings) counts[triage.category]++;
  return counts;
}
