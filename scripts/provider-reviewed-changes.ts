import { claudeSdkReviewedChanges } from './claude-sdk-reviewed-changes.js';
import type { corpora } from './provider-artifacts.js';

/** Evidence that a specific structural change was reconciled. */
export type ReviewedChange = { referenceUrl: string; fingerprint: string; reason: string };

const reviewedCodexConfiguration =
  'https://raw.githubusercontent.com/openai/codex/rust-v0.171.0/codex-rs/core/config.schema.json';

const reviewedCodexAppServer =
  'https://raw.githubusercontent.com/openai/codex/rust-v0.171.0/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json';

// Copy an exact path and fingerprint from --json after reviewing the change.
// Other changes in the same artifact stay open.
export const reviewedChanges: Partial<
  Record<(typeof corpora)[number], Record<string, Record<string, ReviewedChange>>>
> = {
  'Codex configuration': {
    'config.schema.json': {
      '/definitions/HookStateToml/properties/trusted_content_hash': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: '35dc7c60d7525fba83fefcb8167097edd0a3e4ff22a2d923443f882fc2887d2b',
        reason:
          'An isolated hook sync preserved the field byte for byte in config.toml. Codex 0.171.0 parsed that configuration.',
      },
      '/definitions/HooksToml/properties/PostModelRequest': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'd6b24995c272212a8cc5de98992b938a332a18a3f82a2dede630af42c8918020',
        reason:
          'Codex 0.171.0 discovered and dispatched the Skillset-emitted PostModelRequest hook.',
      },
      '/definitions/HooksToml/properties/PreModelRequest': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: '8aa912ab5b18e95826a6c6bf2ae859177de95d16b28cf6e099d696aa2a6cea86',
        reason:
          'Codex 0.171.0 discovered and dispatched the Skillset-emitted PreModelRequest hook.',
      },
      '/definitions/McpEmaTokenEndpointAuthMethod': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'cc5d10e387cce00cbdd3ffe6ff5c9733b345434ea0caef568b1953564f4cabac',
        reason: 'Skillset validates both authentication methods from the Codex 0.171.0 enum.',
      },
      '/definitions/McpServerOAuthConfig/properties/token_endpoint_auth_method': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: '4adc8b2fdd77b43017dee1f99086da2ac21440cc28b496d7e1a338b67b180f36',
        reason: 'Codex 0.171.0 loaded the Skillset-emitted MCP EMA authentication configuration.',
      },
      '/definitions/PluginMcpServerConfig/properties/ema_auth': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: '7056a6d10b34801138c968d6bab5975bf8a0acd95a3df4b5e827bf6c5077d644',
        reason:
          'Plugin host policy is outside the projection. Export rejects manifest EMA auth per the tagged Codex loader.',
      },
      '/definitions/PluginMcpServerEmaAuthConfig': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'e49a539d76dd98124f34abac054f80a2b15f41b6f6a1d25bfed283bafd648226',
        reason: 'The removed plugin host-policy type has no Skillset mapping.',
      },
      '/definitions/Preset': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: '9026de0aebea05190fc63b75d40ef70943680c4b0d980512edf83aa4a02275e6',
        reason:
          'TOML editing now preserves basic and literal multiline preset input verbatim, including text that matches a managed table header.',
      },
      '/definitions/ToolsToml/properties/client_search_provider': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'a47aeb23d6bcf7c9d074c5265bd010e0494bc9eb56e058f47d02967821f1b19b',
        reason:
          'Skillset validates and emits the field and warns that Codex drops the role tools table.',
      },
      '/definitions/Tui/properties/presets': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'c0a6d19e5902ab5b534ec09a5841ad41033d720ab19019ed9b9cbf26a50165a5',
        reason:
          'Config splicing fixtures preserve the new preset table and its multiline prompt while updating a managed MCP entry.',
      },
      '/definitions/WebSearchProvider': {
        referenceUrl: reviewedCodexConfiguration,
        fingerprint: 'f0f6127ccd15d67f9298a6b59d869f7fe7a046e277436b3a8adf51e4588373f5',
        reason:
          'Codex 0.171.0 accepted both enum values in root configuration and rejected an invalid value.',
      },
    },
  },
  'Codex App Server JSON-RPC': {
    'codex_app_server_protocol.schemas.json': {
      '/definitions/v2/ImageGenerationInputImage': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'c6ec3017800d3bf759628390680eb30c87c9831e4b364769f588daee7071c479',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/anyOf': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '2aeba61c6530dc692e0c768549dbb92e117b847a69426e680892a359ccebeb85',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/properties/generationId': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'ae7d993d6949752dd73d60f316b87459725b0372ccbe2b758f8873d363633054',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/properties/inputImages': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '71b977ba93de5a2d127ec356766b263dba383b8d31d61a1e3d0300af2249fa5d',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/properties/result': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '2a37ba58e1b8723a0d5851c9eb56cce37fbf571aa7f5ab93459c2776d7088f25',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/ThreadItem/oneOf/type=imageGeneration/required/result': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'f738627a62924c12d98e5ba3991aad17ffe30b5cf2cf1bac3501fd3feaeb41a5',
        reason:
          'The tagged standalone image extension uses this exact field shape in both App Server and stored rollout items. Portable regression fixtures cover the current and transitional forms.',
      },
      '/definitions/v2/AnswerAnnotation': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '76643fdbea4a6e2fb05bf76d454e4c43b7cc9cb3ba4ccfb783d2c23c869b766f',
        reason:
          'Matches the tagged on-disk moderation display contract and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/AnswerReplacement': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'a3e325f0cf67ea37637e7941db69faa118328efcbd150592599016154160c08d',
        reason:
          'Matches the tagged on-disk moderation display contract and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/HelplineSubject': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'cd360beaafd79834eca74296aa77b142e0e0586c4097ba95aa6222c0d26c65b9',
        reason:
          'Matches the tagged on-disk moderation display contract and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/TrustedContacts': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '363945d9ac9704f12e92c60ecfdf399e3fd98b4de7638795a058cc690042c112',
        reason:
          'Matches the tagged on-disk moderation display contract and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/ThreadRealtimeFrameChannels': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '38c1df88fed38ed49e0a768fa382bba601d43ff2b76587d0e0699a046e3e31bf',
        reason:
          'Matches the shared shape in tagged on-disk realtime records and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/ThreadRealtimeHandoffMode': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'e69c6db31e32162771c907fe0d1600cb089e82097ef86f8a52cdb199d5075227',
        reason:
          'Matches the shared shape in tagged on-disk realtime records and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/ThreadRealtimeVoiceTranscript': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'd0c30438920388b132ede0d192ee7d798e05d7680d15f19b785de077b75eaf13',
        reason:
          'Matches the shared shape in tagged on-disk realtime records and is covered by a source-derived rollout fixture.',
      },
      '/definitions/v2/ContentItem/oneOf/type=input_audio/anyOf': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '4ee3a920eff16e0685f3605eb99f698d664ee3b72e3746369838d993ddcff3a6',
        reason:
          'The durable content schema supports both audio_url and file_id. File-backed audio appeared in the 0.171.0 loopback rollout.',
      },
      '/definitions/v2/ContentItem/oneOf/type=input_audio/properties/audio_url': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'a63a737951644cbb050939343a95dd81468a3a02de99c826c054ce62011029a0',
        reason:
          'The durable content schema supports both audio_url and file_id. File-backed audio appeared in the 0.171.0 loopback rollout.',
      },
      '/definitions/v2/ContentItem/oneOf/type=input_audio/required/audio_url': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'e316b7fcab5cb343352c990fc7c3b36025a927d7af5eac4f77ed28b2a5dffb12',
        reason:
          'The durable content schema supports both audio_url and file_id. File-backed audio appeared in the 0.171.0 loopback rollout.',
      },
      '/definitions/v2/FunctionCallOutputContentItem/oneOf/type=input_audio/anyOf': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '738128f7e886b14d509950d5b860affde8d7738430494bc2705af550952701e5',
        reason:
          'The durable tool output uses the same tagged AudioReference and has a regression for file-backed audio.',
      },
      '/definitions/v2/FunctionCallOutputContentItem/oneOf/type=input_audio/properties/audio_url': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '488d282e0500ba975adc6d1e8bba4bdae03261cbfebd4bdbb70a723e5b7d2851',
        reason:
          'The durable tool output uses the same tagged AudioReference and has a regression for file-backed audio.',
      },
      '/definitions/v2/FunctionCallOutputContentItem/oneOf/type=input_audio/required/audio_url': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '75df3c12a8add0966e39dee8981d56f702c1a04ad991a2f29e67fa2dc4c6bad8',
        reason:
          'The durable tool output uses the same tagged AudioReference and has a regression for file-backed audio.',
      },
      '/definitions/v2/MessagePhase/oneOf/1/enum/final_answer': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '9cfaba43a45174ffc7e93c3bc2f4a97d346ccbb4e3e7332c6728c18c55532e2d',
        reason:
          'The 0.171.0 rollout retained partial_answer in raw messages and completed items. Existing final_answer records still parse.',
      },
      '/definitions/v2/MessagePhase/oneOf/1/enum/partial_answer': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '0ee2198bc6dc122b7e854896967b58203b2f8cb466f4a64487bafb9e77913408',
        reason:
          'The 0.171.0 rollout retained partial_answer in raw messages and completed items. Existing final_answer records still parse.',
      },
      '/definitions/v2/MessagePhase/oneOf/2': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '176f614931fbe0ebaea78d0cadfa5b401ca30426ac50be2732b0f6acbe01801d',
        reason:
          'The 0.171.0 rollout retained partial_answer in raw messages and completed items. Existing final_answer records still parse.',
      },
      '/definitions/v2/PlanType/enum/sci': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: '9c7f1534ba486f989afd8c596ce1014510bbe6bab0164ef774e58899024411df',
        reason:
          'The tagged PlanType is embedded in persisted token counts and both new values have regression coverage.',
      },
      '/definitions/v2/PlanType/enum/sci_plus': {
        referenceUrl: reviewedCodexAppServer,
        fingerprint: 'db7b6e16e1fd76f0df2baa2ba7ef82e3d33c17115c7c243fc5111a15fd5ca219',
        reason:
          'The tagged PlanType is embedded in persisted token counts and both new values have regression coverage.',
      },
    },
  },
  'Claude Code Mods': {
    'claude-code.d.ts': {
      '/module claude-code/AgentSpec/0/typeAnnotation/members/autoCompactWindow': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: '294816561c2f63311166caccf8e2ba10af6bb42e8d109f33b3124e54e75c854b',
        reason:
          'Tagged AgentSpec shares the agent Markdown schema. Skillset already validates and emits autoCompactWindow with the documented minimum.',
      },
      '/module claude-code/AgentTeammateRecord': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: 'd32d1424ec699b71e38f9d4669e0a756ed479b670dc261c32d8d0b66d0a7d1ef',
        reason:
          'The saved teammate tool result already types the tagged roster fields and the older and current tool result spellings.',
      },
      '/module claude-code/PluginHookEntry': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: '2a1143918fc1ecdf1507f1c84a354a256d4765fff2f8ae7bb69cab889a650694',
        reason:
          'Native handler validation and the Mod bundle regression preserve classic command arguments and hook registration.',
      },
      '/module claude-code/SessionAppendResult': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: '8e7484c6eca6a678bce5aab00b0abd0b5f6fccb6d735eec0d55a9d84f234410a',
        reason:
          'Claude Code 2.1.330 saved queued and delivered plugin_note records. Skillset now types both shapes and the strict checker parsed all captured notes.',
      },
      '/module claude-code/SessionMessage/0/declaration/typeAnnotation/members/uuid': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: '594313c49b34855a7476df9f0298f9db052a10c17bd56f3c30583d5e8baac33c',
        reason:
          'This Mod projection uses the saved row ID. The transcript schema already requires a string uuid on every conversation-chain record.',
      },
      '/module claude-code/PromptOrigin/0/declaration/typeAnnotation/types/15/members/asUser': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: 'b3f1acb1360f171863bcfdaeffd4c5dcd7bafd13167b5032303f84df1ec59504',
        reason:
          'Claude Code 2.1.330 persisted the plugin origin and system turn attribution. Skillset now validates both.',
      },
      '/module claude-code/PluginState': {
        referenceUrl:
          'https://raw.githubusercontent.com/anthropics/claude-code/v2.1.330/mods/types/claude-code.d.ts',
        fingerprint: '357d5f034c5c24f258a1551d9435fed55e03cb8f42d17f0ca66a5b8c4d5d69b1',
        reason:
          'The exported declaration merged with the tagged interface and Claude 2.1.330 tested the Mod reading and writing its declared state.',
      },
    },
  },
  'Claude Agent SDK declarations': {
    'sdk.d.ts': claudeSdkReviewedChanges,
  },
  'Claude Code settings (SchemaStore)': {
    'claude-code-settings.json': {
      '/properties/env/propertyNames/pattern': {
        referenceUrl:
          'https://raw.githubusercontent.com/SchemaStore/schemastore/bf7c6745505ccace5568dc0d7f4ae29647e9b41a/src/schemas/json/claude-code-settings.json',
        fingerprint: 'd78c604a093c261aef0d08a545b95da4c941a2c08981bd9a2c86ff5017c20f98',
        reason:
          'Claude Code 2.1.330 passed a lowercase settings variable to a synced hook. Skillset preserves that settings map and now recognizes lowercase references in MCP projection.',
      },
    },
  },
};
