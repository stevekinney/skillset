function symbols(names: string) {
  return names
    .trim()
    .split(/\s+/u)
    .map((name) => `/module claude-code/${name}`);
}

/** Scope rules for declarations compared against the Claude Code 2.1.330 Mod surface. */
export const claudeModTriageRules = [
  {
    category: 'skillset-format',
    paths: [
      '/module claude-code/AgentSpec/0/typeAnnotation/members/autoCompactWindow',
      '/module claude-code/AgentTeammateRecord',
      '/module claude-code/PromptOrigin/0/declaration/typeAnnotation/types/15/members/asUser',
      '/module claude-code/SessionAppendResult',
      '/module claude-code/SessionMessage/0/declaration/typeAnnotation/members/uuid',
    ],
    reason:
      'These declarations overlap with fields in Claude frontmatter and saved transcripts used by Skillset.',
  },
  {
    category: 'upstream-only',
    paths: [
      '/module claude-code/PluginState',
      '/module claude-code/PluginHookEntry',
      '/module claude-code~1shader',
      '/module claude-code~1testing',
      '/module claude-code/module global/module WebAssembly',
    ],
    reason:
      'Claude supplies these declarations for plugin registration and the runtime shader, testing, and WebAssembly APIs.',
  },
  {
    category: 'upstream-only',
    paths: symbols(`
      Atom AtomFunction AtomOptions ChunkOf CoreEngineInterface DeclaredAttachmentInput
      DeclaredEvents DeclaredEventsOf DeclaredPair DeclaredStateChange DeriveFunction Derived
      EngineEventOf EngineResultOf EventCalls Frozen IndexFree InvalidatableEventName
      IsDiscriminant KnownKeys MatchedNames Matcher MatcherFor MatcherValueAcross MatcherValueOf
      MatcherValues MemberOfFunction NarrowedMember Next NextOrigin NextResultFor On OpEventOf
      OpValueOf OpenMatcher ReadFunction Shaped ShapedValue SourceValues StarNext StateAddress
      StateDollar StateFamily StateGetEvent StateName StateRead StateRef StateSetEvent
      StateSetOptions StateSetResult StateValue StateWrite StreamNext StreamingEventName TagKeys
      TargetTier UndeclaredAttachmentInput UpdateFunction atom derive memberOf read update
    `),
    reason:
      'These declarations define the runtime Mod registration, dispatch, and state APIs. The tagged declaration download exposes these APIs to Mod authors.',
  },
  {
    category: 'upstream-only',
    paths: symbols(`
      AbovePromptRow ClientElements Color Elements InputProps PaneOpenArgs ProgressProps
      RenderInputOf Selection ShaderProps Space SpeakOptions SpeakRequest StyledElement
      ThemeAmbience ThemeBackdrop ThemeBackdropGlass ThemeBoxRule ThemeColor ThemeColorGround
      ThemeColorInputs ThemeColorName ThemeColors ThemeCue ThemeFill ThemeFillGradient
      ThemeFillVector ThemeGenericFont ThemeGradient ThemeGradientGround ThemeGround
      ThemeGroundBase ThemeKey ThemeLayerEnvelope ThemeLayerMix ThemeMessageRule ThemeNoiseDrone
      ThemeNoiseLayer ThemeNoiseScatter ThemeNoiseWave ThemeNote ThemeResult ThemeScene
      ThemeSetArgs ThemeSound ThemeStyle ThemeStyleColor ThemeTiling ThemeToneDrone ThemeToneLayer
      ThemeToneScatter ThemeToneWave ThemeToolRule ThemeTypeRule ThemeVector ThemeVectorGround
      UiBlitResult UiCopyArgs UiCopyResult UiFaultInput UiFaultPhase UiFaultResult UiNotifyResult
      UiOpenResult UiPlaceArgs UiPlaceResult UiPointerInput UiPointerResult UiSelection
      UiViewResult WasmBytes WasmCompileInput BoxProps TextProps ButtonProps BoxHoverProps
      TextHoverProps MarkdownProps RenderElement RenderPropsOf RenderSurface RenderComponent
    `),
    reason:
      'Claude uses these types for rendering, themes, audio, and WebAssembly at runtime. The corresponding types ship with Claude.',
  },
  {
    category: 'upstream-only',
    paths: symbols(`
      CancelNotifyArgs CommandRunResult ContextApiUsage ContextSkill EnvSetResult FsEntry
      FsReadBytesOptions FsReadCall FsReadOptions FsReadTextOptions GlobNext HttpBody HttpCompress
      HttpInit HttpResponse InstructionFile McpConnectRefusal McpConnectResult NotifyOptions
      PluginHostSource PluginHosts PluginProvides PluginRegisterInput PluginRegisterUses
      PluginValidateAdvice PluginValidateDirectory PluginValidateDirectoryFinding
      PluginValidateFile PluginValidateFinding PluginValidateGatingHook PluginValidateHook
      PluginValidateMatcher PluginValidateModule PluginValidateNouns PluginValidatePerGpu
      PluginValidateReport PluginValidateShader PluginValidateShaderCost PluginValidateWasm
      PluginValidateWasmFile ProcessRunResult ProcessSpawnChunk ProcessSpawnRequest
      ProcessSpawnResult SettingsKeyRead SettingsLayer SettingsLayerSource SettingsObjectRead
      SettingsReadArgs SettingsReadInput SettingsReadOverloads TelemetryAttribute TelemetryChoice
      TelemetryDestination TelemetryLogArgs TelemetryLogInput TelemetryLogResult
      TelemetryMarkInput TelemetryMarkKind TelemetryMarkResult TelemetryProp TelemetryRecordEntry
      TelemetryRowArgs TelemetryRowEntry TelemetrySpan VcsChange VcsDetectInput VcsDetectResult
      VcsDiffFile VcsDiffInput VcsDiffResult VcsIsolateInput VcsIsolateResult VcsListInput
      VcsListResult VcsListedCopy VcsReleaseInput VcsReleaseResult VcsStatusInput VcsStatusResult
      VcsWorkingCopy
    `),
    reason:
      'These are runtime host services, settings snapshots, and plugin loader or validator events. Skillset does not consume those interfaces.',
  },
  {
    category: 'upstream-only',
    paths: symbols(`
      AgentCallArgs AgentCallOptions AgentInfo AgentLimits AgentOfferInput AgentReportInput
      AgentReportResult AgentReportReview AgentRequest AgentSpawnArgs AgentSpawnInput
      AgentSpawnResult AgentStatus ApiContentBlock ApiMessage BuiltinToolInputs BuiltinToolResults
      ModelApiError ModelCompleteInput ModelCompleteOptions ModelCompleteRequest
      ModelCompleteResult ModelEffort ModelForkRequest ModelForkResult ModelForkUsage
      ModelTextBlock ModelUsage PlanModeDetail PlanModeExitDetail PlanModeReentryDetail
      PromptAttachmentDetailOf PromptAttachmentInput PromptAutocompleteInput
      PromptAutocompleteResult PromptAutocompleteSuggestion PromptChangeInput PromptChangeOrigin
      PromptChangeResult PromptDecoration PromptEditResult PromptFillArgs PromptFillInput
      PromptFillResult PromptFilled PromptMedia PromptMediaArgs PromptMentionAttached
      PromptMentionInput PromptMentionResult PromptPaintArgs PromptPainted PromptSectionResult
      PromptSubmitArgs PromptSubmitAttachment PromptSubmitCommand PromptSubmitInput
      RegisteredToolSpec SessionAppendArgs SessionAppendDoor SessionAppendInput
      SessionAppendMessage SessionAppendOrigin SessionCompacted SessionContextBreakdown
      SessionCost SessionIdentity SessionInfo SessionMachine SessionMessagesAgentArgs
      SessionMessagesApiArgs SessionMessagesApiResult SessionMessagesArgs SessionMessagesCall
      SessionMessagesDeny SessionMessagesMainApiArgs SessionMessagesResult SessionMessagesValue
      SessionReceiveEvent SessionReceiveInput SessionReceiveOrigin SessionSendAddress
      SessionSendArgs SessionSendInput SessionSendOrigin SessionSendResult SessionStopInput
      SessionStopResult SessionUsage SkillFrontmatter SkillFrontmatterList SkillFrontmatterValue
      SkillPromptArgs SkillPromptInput SkillSource ToolCallInput ToolCallResult ToolCheckApprover
      ToolCheckInput ToolCheckResult ToolDescribeInput ToolDescribeResult ToolInfo ToolJudgeInput
      ToolJudgeResult ToolMcpServer ToolOfferInput ToolOfferResult ToolRequestMeta ToolResultOf
      ToolResultSummary ToolSpec ToolUseSummary TurnCompleteResult TurnStartInput TurnStepResult
      TurnStepServerToolUse TurnUsage WaitingAgent WaitingFor
    `),
    reason:
      'These symbols describe Mod calls, events, or views of live conversations. Skillset has separate configuration and durable transcript schemas.',
  },
] as const;
