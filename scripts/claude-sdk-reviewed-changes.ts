const publication = 'https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.330/sdk.d.ts';

/** Exact findings reconciled against the published SDK declaration. */
export const claudeSdkReviewedChanges = {
  '/ModelUsage/0/declaration/typeAnnotation/members/cacheCreationEphemeral1hInputTokens': {
    referenceUrl: publication,
    fingerprint: '00a86b5de854b0dc8f05de5fe9add78535d11fb16609bd6404be184ccd7e5973',
    reason:
      'The saved cost-state model usage schema already validates this optional numeric counter, and its transcript regression fixture covers it.',
  },
  '/ModelUsage/0/declaration/typeAnnotation/members/cacheCreationEphemeral5mInputTokens': {
    referenceUrl: publication,
    fingerprint: '6c496343a6a6c99d1501d55a8bfc6c33d43490393477fc1e3fceafdd9135368d',
    reason:
      'The saved cost-state model usage schema already validates this optional numeric counter, and its transcript regression fixture covers it.',
  },
  '/SDKMessageOrigin/0/declaration/typeAnnotation/types/3/members/runId': {
    referenceUrl: publication,
    fingerprint: '3adb6e15aab90a877f1de2f736eae16f50c3ed34e4438d6059ed26cb642aa24e',
    reason:
      'The published SDK documents the saved notification origin. The shared transcript schema validates it and has a regression fixture.',
  },
  '/SDKMessageOrigin/0/declaration/typeAnnotation/types/3/members/subkind/typeAnnotation/typeAnnotation/types/4':
    {
      referenceUrl: publication,
      fingerprint: '8ff650a167daccfe9d4197299a5a5d6fe5b59a9933db9a965596f7027543304c',
      reason:
        'The published SDK documents the saved notification origin. The shared transcript schema validates it and has a regression fixture.',
    },
  '/Settings/0/declaration/body/body/hooks/typeAnnotation/typeAnnotation/members/[index:TSStringKeyword]/typeAnnotation/typeAnnotation/elementType/members/hooks/typeAnnotation/typeAnnotation/elementType/types/0/members/onFailure':
    {
      referenceUrl: publication,
      fingerprint: '3eff008366ab89ce3c87a15ae8e22c93b05661d7d3706a44fccf9c2f05458f59',
      reason:
        'Skillset already validates and emits this classic hook failure mode. Existing tests exercise the handler projection.',
    },
  '/Settings/0/declaration/body/body/hooks/typeAnnotation/typeAnnotation/members/[index:TSStringKeyword]/typeAnnotation/typeAnnotation/elementType/members/hooks/typeAnnotation/typeAnnotation/elementType/types/3/members/onFailure':
    {
      referenceUrl: publication,
      fingerprint: 'b2cbd32b00aaadd56f90e30fa895aa8457325e5b870db2b10d900f6fb07f3a4d',
      reason:
        'Skillset already validates and emits this classic hook failure mode. Existing tests exercise the handler projection.',
    },
  '/Settings/0/declaration/body/body/hooks/typeAnnotation/typeAnnotation/members/[index:TSStringKeyword]/typeAnnotation/typeAnnotation/elementType/members/hooks/typeAnnotation/typeAnnotation/elementType/types/4/members/onFailure':
    {
      referenceUrl: publication,
      fingerprint: '34a83c26613ca50ddf4a4045ac95f14853d4f03c05486242c0b5e1aef8fa5229',
      reason:
        'Skillset already validates and emits this classic hook failure mode. Existing tests exercise the handler projection.',
    },
  '/AgentDefinition/0/declaration/typeAnnotation/members/autoCompactWindow': {
    referenceUrl: publication,
    fingerprint: '22415b41eb4f041c5c09836376bde7304304fda1ed6aded9cd46abbb6d824b4e',
    reason:
      'The corresponding Claude Code frontmatter already validates the documented minimum and preserves the number in the emitted agent.',
  },
};
