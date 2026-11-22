const versionTwoPaths = (names: readonly string[]) =>
  names.map((name) => `/definitions/v2/${name}`);

// Scope boundaries for the generated App Server schema. Shared definitions are
// checked against tagged protocol types and rollout persistence rules.
export const codexAppServerTriageRules = [
  {
    category: 'skillset-format',
    paths: [
      '/definitions/v2/ContentItem/oneOf/type=input_audio',
      '/definitions/v2/ContentItem/oneOf/type=output_text/properties/annotations',
      '/definitions/v2/ContentItem/oneOf/type=output_text/properties/logprobs',
      '/definitions/v2/FunctionCallOutputContentItem/oneOf/type=input_audio',
      '/definitions/v2/ResponseItem/oneOf/type=additional_tools',
      ...[
        'message',
        'function_call',
        'custom_tool_call',
        'image_generation_call',
        'local_shell_call',
        'tool_search_call',
        'web_search_call',
      ].map(
        (variant) =>
          `/definitions/v2/ResponseItem/oneOf/type=${variant}/properties/encrypted_content`,
      ),
      '/definitions/v2/ResponseItem/oneOf/type=function_call/properties/status',
      '/definitions/v2/ResponseItem/oneOf/type=message/properties/status',
      '/definitions/v2/MessagePhase',
      '/definitions/v2/PlanType',
    ],
    reason:
      'Tagged Codex persistence types use the corresponding fields or values in local rollouts, which Skillset parses.',
  },
  {
    category: 'skillset-format',
    paths: [
      '/definitions/v2/AnswerAnnotation',
      '/definitions/v2/AnswerReplacement',
      '/definitions/v2/HelplineSubject',
      '/definitions/v2/TrustedContacts',
      '/definitions/v2/AgentMessageDisplay',
      '/definitions/v2/AgentMessageModeration',
      '/definitions/v2/ThreadItem/oneOf/type=agentMessage/properties/moderation',
      '/definitions/v2/ThreadItem/oneOf/type=mcpToolCall/properties/environmentId',
      '/definitions/v2/ThreadRealtimeFrameChannels',
      '/definitions/v2/ThreadRealtimeHandoffMode',
      '/definitions/v2/ThreadRealtimeVoiceTranscript',
      '/definitions/v2/ItemCompletedNotification/properties/contentTokenCount',
    ],
    reason:
      'The corresponding moderation, realtime, or completion data appears in the tagged durable format. Wire details can differ.',
  },
  {
    category: 'skillset-format',
    paths: versionTwoPaths(['ImageGenerationInputImage', 'ThreadItem/oneOf/type=imageGeneration']),
    reason:
      'App Server exposes the same standalone image extension fields that Codex stores in a rollout Extension item.',
  },
  {
    category: 'skillset-format',
    paths: versionTwoPaths(['BlockReason', 'CodexErrorInfo', 'WebSearchProvider']),
    reason:
      'Skillset reads the corresponding stored moderation or error values, or validates the corresponding Codex tools table enum. Wire encodings can differ.',
  },
  {
    category: 'upstream-only',
    paths: versionTwoPaths([
      'Account',
      'AccountSecuritySetupAction',
      'AccountSecuritySetupNotice',
      'AccountSession',
      'AccountSessionWorkspace',
      'AccountSessionWorkspaceKind',
      'AccountUpdateReason',
      'AccountUpdatedNotification',
      'GatewayAuth',
      'GatewayOAuthChangedNotification',
      'GatewayOAuthLoginParams',
      'GatewayOAuthLoginResponse',
      'GatewayOAuthPrompt',
      'GatewayOAuthReadParams',
      'GatewayOAuthReadResponse',
      'GetAccountResponse',
      'GetAccountSecuritySetupResponse',
      'NullableGatewayOAuthLoginParams',
      'NullableGatewayOAuthReadParams',
    ]),
    reason:
      'These describe App Server authentication and account state. Skillset configures standalone MCP servers without reading the accounts API.',
  },
  {
    category: 'upstream-only',
    paths: [
      '/definitions/McpServerElicitationRequestParams',
      ...versionTwoPaths([
        'ListMcpServerStatusParams',
        'McpResourceReadParams',
        'McpServerOauthLoginCompletedNotification',
        'McpServerOauthLoginParams',
        'McpServerOauthLoginResponse',
        'McpServerStatus',
        'McpServerStatusUpdatedNotification',
        'McpServerToolCallParams',
      ]),
    ],
    reason:
      'These are live MCP management and tool-call RPCs. Skillset handles MCP configuration and stored tool-call items separately.',
  },
  {
    category: 'upstream-only',
    paths: versionTwoPaths([
      'ApplicationRequirements',
      'ApplicationStorageRequirements',
      'BedrockProviderId',
      'BrowserUseExtensionRequirements',
      'BrowserUseRequirements',
      'Config/properties/client_search_provider',
      'ConfigRequirements',
      'ConfigRequirementsReadResponse',
      'GcpProviderId',
      'ModelListParams',
      'ModelProviderCapabilitiesReadResponse',
      'ModelProviderConfigWriteParams',
      'ModelProviderConfigWriteResponse',
      'ModelProviderDefaultSetParams',
      'ModelProviderError',
      'ModelProviderListParams',
      'ModelProviderListResponse',
      'ModelProviderSummary',
      'NetworkRequirements',
      'OtelExporter',
      'OtelHttpProtocol',
      'OtelRequirements',
      'OtelTlsConfig',
      'OtelToolResultLogConfig',
      'ProviderSettings',
      'ProviderSettingsPatch',
      'RequestHeader',
    ]),
    reason:
      'These are App Server settings and model provider RPC types. Skillset reads and emits local settings files.',
  },
  {
    category: 'upstream-only',
    paths: [
      '/definitions/CommandExecutionApprovalKind',
      ...versionTwoPaths([
        'EnvironmentSkillsParams',
        'FeedbackSaveParams',
        'FeedbackSaveResponse',
        'HookEventName',
        'HookMetadata',
        'HookRunSummary',
        'ManagedHooksRequirements',
        'MisalignmentErrorDetails',
        'ProcessExitedNotification',
        'Project',
        'ReviewDelivery',
        'SkillMetadata',
        'SkillSummary',
      ]),
    ],
    reason:
      'These are live App Server controls, metadata, or policy contracts. Skillset reads local hook payloads, skill files, and stored events.',
  },
  {
    category: 'upstream-only',
    paths: versionTwoPaths([
      'AdditionalContextEntry',
      'QueuedSubmission',
      'RealtimeVoice',
      'RealtimeVoicesList',
      'ThreadAttachmentOwner',
      'ThreadAttachmentOwnerListParams',
      'ThreadAttachmentOwnerListResponse',
      'ThreadGoalClearParams',
      'ThreadGoalMutationOrigin',
      'ThreadGoalSetParams',
      'ThreadItem/oneOf/type=subAgentActivity/properties/model',
      'ThreadItem/oneOf/type=subAgentActivity/properties/reasoningEffort',
      'ThreadItem/properties',
      'ThreadItem/type',
      'ThreadItemOutputDeferral',
      'ThreadPredictionResult',
      'ThreadPredictionUpdatedNotification',
      'ThreadReadState',
      'ThreadReadStateChangedNotification',
      'ThreadReadStateOperation',
      'ThreadRealtimeCoverage',
      'ThreadRealtimeEntry',
      'ThreadRealtimeItem',
      'ThreadRealtimeOrder',
      'ThreadSearchPartialNotification',
      'ThreadSectionChangedNotification',
      'ThreadUnreadPosition',
      'ThreadUsage',
      'Turn/properties/rootTurnId',
      'TurnStartParams',
      'TurnToolOutput',
      'UserInput/oneOf/type=audio',
    ]),
    reason:
      'These are App Server thread views, control requests, or live metadata. Skillset parses the distinct types serialized by the rollout writer.',
  },
  {
    category: 'upstream-only',
    paths: [
      '/definitions/ClientRequest',
      '/definitions/ServerNotification',
      '/definitions/InitializeCapabilities',
      '/definitions/v2/ThreadItemsListParams',
      '/definitions/v2/ThreadListParams',
      '/definitions/v2/HooksListParams',
    ],
    reason:
      'These are App Server request or notification contracts. Skillset does not use an App Server client.',
  },
] as const;

// Exact wire differences whose Skillset counterparts were checked in the compatibility reference.
export const codexAppServerReferenceFingerprints: ReadonlySet<string> = new Set([
  'da702a07ef8a9c701ef86b3511b87c02540c6aa3283849f2b4bca6a43384ac10', // AgentMessageDisplay
  '65462a26491f9d17ad50c3f2aa73f065d457ac2ab923b1989944427544ac6a50', // AgentMessageModeration
  '1c161b3c04d188a80ed4e9be2e74b6958f3eb94f36360545426ab55dd5863205', // BlockReason
  'ed7cb8e38e279170bc4c95e36fd9b4be84f93e7a9b03aa59df7c71df827d046e', // CodexErrorInfo/anyOf
  '557fa8bfc88f9f662cd923b9fd7c4b2458ab2181a96dbad5c5b74cdb38e342bb', // CodexErrorInfo/oneOf
  '13ccacecbd517a60d448016d471ec69c5ad37cba11c63c98c94cb819b88daa2c', // ContentItem/oneOf/type=output_text/properties/annotations
  'ac0de6bf65b2a5b0053dfed56a5cf2f230b71ae9cdfb1583f892c789e5b25f43', // ContentItem/oneOf/type=output_text/properties/logprobs
  '28e42dfe6aa7ac54acb5ebbdd9ad7fc800f93c98f0c9dde5eb7cb97afb18dabd', // ItemCompletedNotification/properties/contentTokenCount
  '9341b38c335486d28873d0b1d8f9f22f63730354eea7132940dda288aaf78c95', // ResponseItem/oneOf/type=additional_tools
  'dd6578ebf7c4a5bafc8fa2a429f80507012da408f3e35dc6b1f9a0118cce51dd', // ResponseItem/oneOf/type=custom_tool_call/properties/encrypted_content
  '3ed4136719948f81711db03161864b2a4573d6381196502b09fd35bd9debd109', // ResponseItem/oneOf/type=function_call/properties/encrypted_content
  '932e894778023f1d8cf3b2021471b63ac3620b02fc5f851d733d7789115f74ac', // ResponseItem/oneOf/type=function_call/properties/status
  '711719b5f8fe69fda22d0119e4162fc10937662ea2e2464b1ea35d36f5b1cc50', // ResponseItem/oneOf/type=image_generation_call/properties/encrypted_content
  '1dfb7f7045aab74991291b922b6bd808c7ea76d491a481b0d7d0460296790819', // ResponseItem/oneOf/type=local_shell_call/properties/encrypted_content
  '7413771ce0bfe874c759e459c16c64612dbadec8b3ca13eccaf7f769a99cbc74', // ResponseItem/oneOf/type=message/properties/encrypted_content
  '506a6ee046db590b483788749c6d7e3ee5b13f1f23894ef1d9f83f6ac6f803c8', // ResponseItem/oneOf/type=message/properties/status
  '76071f4dc265c8fcb3fe3568ade9ff78133fdc557f920960bdd916d52fb48ff8', // ResponseItem/oneOf/type=tool_search_call/properties/encrypted_content
  'e265ee7da39ffea8401ae550fc06c72ae1cffd93d22124d844c0b83a9ca4117d', // ResponseItem/oneOf/type=web_search_call/properties/encrypted_content
  '30111aa0a2488e84a3bb08236028db783d95afc02659d767efd2491af65e6fef', // ThreadItem/oneOf/type=agentMessage/properties/moderation
  'eba0e46e28cc9c4c07e7075f970eef85b4b0270fccd3e75239ff6050475410d3', // ThreadItem/oneOf/type=mcpToolCall/properties/environmentId
  '2c8d2eafecb2e044142903dfefb439f253f7399e80d5bdbb9ce5e679f7879032', // WebSearchProvider
]);
