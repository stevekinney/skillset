---
name: example-skill
description: An example skill demonstrating every skillset feature. Use it as a template for real skills.
license: MIT
allowed-tools: Read, Grep, Glob
when_to_use: Trigger when demonstrating how skillset compiles a skill for both tools.
argument-hint: '[topic]'
arguments: topic
model: sonnet
effort: medium
disable-model-invocation: true
openai:
  interface:
    display_name: 'Example Skill'
    short_description: 'Demonstrates the skillset source format.'
---

# Example Skill

<!-- #if claude -->

Research $topic and summarize what you find.

<!-- #else -->

Research the topic the user provided and summarize what you find.

<!-- #endif -->

## Live context

<!-- #if claude -->

- Today: !`date +%Y-%m-%d`
- Repo: !`basename "$(git rev-parse --show-toplevel 2>/dev/null)" || echo "(not a repo)"`

<!-- #else -->

- Run `date +%Y-%m-%d` and `git rev-parse --show-toplevel` to gather today's date and the repo name.

<!-- #endif -->

## Shared instructions

1. Read [references/notes.md](references/notes.md) for background.
2. Keep the summary under 200 words.
