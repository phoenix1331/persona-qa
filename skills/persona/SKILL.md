---
description: Creates a new PersonaQA persona from a plain-English description, validated against the schema and saved for review. Use for "/personaqa:persona new", or "add a persona who...".
argument-hint: "new \"<description of the person>\""
allowed-tools: Agent, Read
---

# PersonaQA persona

Arguments: `$ARGUMENTS`

## new

If the arguments start with `new`, the rest is the description (quotes optional). If it is empty, ask the user to describe the person: their device and connection, how patient they are, how they read, and anything that makes the app hard for them.

Start one `personaqa:persona-writer` subagent with the prompt `Description: <description>`.

Relay its reply: the file path, the YAML and the reasoning. Then tell the user:

1. Review and edit the file; personas describe behaviour, never stereotypes.
2. It runs like any persona: `/personaqa:run <id> <mission>`.
3. Commit it so the team shares it.

## Anything else

Explain that the only sub-command is `new "<description>"`, and that `/personaqa:validate` checks existing personas.
