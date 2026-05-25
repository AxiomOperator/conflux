Yes — **Hermes Agent’s “self-learning” is mostly externalized learning**, not model training.

It does **not** appear to fine-tune the LLM during normal use. Instead, it learns by writing, updating, searching, and reusing external artifacts: **memory files, session history, skills, prompts, and eventually evaluation-driven skill mutations**.

## The core idea

Hermes treats learning as:

> “Capture what worked, compress it into reusable instructions or memory, and load it again when relevant.”

That gives the agent a persistent improvement loop without changing the model weights.

In practical terms:

```text
Task happens
  ↓
Agent uses tools / hits errors / finds working path
  ↓
Agent stores useful facts in memory
  ↓
Agent may create or update a skill
  ↓
Future task loads memory or skill
  ↓
Agent performs better next time
```

That is the real “self-learning” mechanism.

---

# 1. Persistent memory: what the agent knows

Hermes has two small curated memory files:

| File        |                                                              Purpose |        Limit |
| ----------- | -------------------------------------------------------------------: | -----------: |
| `MEMORY.md` | Agent notes: environment facts, project conventions, lessons learned | ~2,200 chars |
| `USER.md`   |         User profile: preferences, communication style, expectations | ~1,375 chars |

These live under `~/.hermes/memories/` and are injected into the system prompt at the start of a session. Hermes says these memory entries are loaded as a **frozen snapshot** at session start, meaning changes made during a conversation are saved immediately but do not affect the current prompt until the next session. That preserves prompt caching and avoids constantly mutating the system prompt mid-run. ([Hermes Agent][1])

The agent can manage memory itself using a `memory` tool with actions like:

```text
add
replace
remove
```

Hermes specifically tells the agent to save things like user preferences, environment facts, corrections, conventions, completed work, and lessons learned. It also warns against saving vague, temporary, or easily rediscovered information. ([Hermes Agent][1])

So this part of “learning” is basically **curated long-term fact storage**.

For Conflux, this maps to:

```text
user_profile_memory
project_memory
tenant_memory
environment_memory
operational_lessons
```

But because Conflux is multi-user, you would need scoped memory boundaries:

```text
global/system memory
organization memory
team memory
project memory
user memory
agent memory
task/session memory
```

Hermes is more single-user/local-first in this area.

---

# 2. Session search: what the agent can recall

Hermes also stores past sessions in SQLite with FTS5 full-text search. The docs describe this as separate from curated memory: memory is small and always injected; session search is larger, automatic, and searched only when needed. ([Hermes Agent][1])

That distinction matters.

| System         | Purpose                          |
| -------------- | -------------------------------- |
| Memory         | Critical facts always in prompt  |
| Session search | Full historical recall on demand |

This is smart because not everything belongs in permanent memory. A past troubleshooting conversation, log file, or command history may be useful later, but it should not consume system-prompt tokens forever.

In Hermes:

```text
MEMORY.md / USER.md = high-value always-loaded memory
SQLite FTS5 sessions = searchable archive
```

For Conflux, I would expand this into:

```text
Postgres = durable sessions, events, task state, audit trail
Qdrant = semantic recall over conversations/docs/tasks
Redis/Dragonfly = short-lived runtime state
Object storage = artifacts, files, traces, outputs
```

This becomes much more powerful in a multi-user harness because recall can be scoped by tenant, project, channel, permission, and agent role.

---

# 3. Skills: how the agent learns procedures

This is the most important piece.

Hermes skills are markdown-based procedural memory. The docs describe skills as **on-demand knowledge documents** that live under `~/.hermes/skills/`. They use a progressive disclosure pattern so the agent does not load every skill into context every time. ([Hermes Agent][2])

A skill is basically a structured `SKILL.md` file:

```markdown
---
name: my-skill
description: Brief description of what this skill does
version: 1.0.0
---

# Skill Title

## When to Use
Trigger conditions for this skill.

## Procedure
1. Step one
2. Step two

## Pitfalls
- Known failure modes and fixes

## Verification
How to confirm it worked.
```

Hermes uses skills as reusable operating procedures. A skill can include:

```text
SKILL.md
references/
templates/
scripts/
assets/
```

The docs explicitly show an agent-created skill directory, for example `devops/deploy-k8s/`, under the main skills folder. ([Hermes Agent][2])

This is where “self-learning” becomes more than memory. The agent is not just remembering that something happened. It is turning a successful workflow into a reusable capability.

Example:

```text
User asks Hermes to deploy a Kubernetes app.
Hermes struggles, finds the right commands, fixes errors, validates the deployment.
Afterward, Hermes creates a deploy-k8s skill:
  - when to use it
  - required tools
  - command sequence
  - common failure modes
  - verification steps
Next time, Hermes can load that skill and avoid relearning the workflow.
```

That is procedural learning.

---

# 4. Agent-managed skill creation and updates

Hermes has a `skill_manage` tool that allows the agent to create, patch, edit, delete, and add supporting files to skills. The docs call this the agent’s **procedural memory**. It creates skills when it completes complex work, finds a working path after errors, receives user corrections, or discovers a non-trivial workflow. ([Hermes Agent][2])

The important triggers are:

```text
after a successful complex task
after 5+ tool calls
after errors/dead ends are resolved
after user correction
after discovering a repeatable workflow
```

The available actions include:

```text
create      new skill
patch       targeted update
edit        full rewrite
delete      remove skill
write_file  add supporting files
remove_file remove supporting files
```

Hermes prefers `patch` for skill improvement because it is more token-efficient than rewriting a whole skill. ([Hermes Agent][2])

This is the learning loop:

```text
Experience → Reflection → Skill Creation/Patch → Future Reuse
```

For Conflux, this is a major architectural feature. I would treat skills as first-class records, not just files:

```text
skills
skill_versions
skill_permissions
skill_sources
skill_eval_runs
skill_usage_events
skill_failure_events
skill_approval_status
skill_owner_user_id
tenant_id
project_id
```

That lets Conflux support shared team skills, private user skills, organization-approved skills, and agent-generated draft skills that require admin approval.

---

# 5. Progressive disclosure: how Hermes avoids token bloat

Hermes does not dump every skill into the prompt. It uses a tiered loading pattern:

```text
Level 0: skills_list()           → names/descriptions/categories
Level 1: skill_view(name)        → full skill content
Level 2: skill_view(name, path)  → specific reference file
```

The agent only loads the full skill when needed. ([Hermes Agent][2])

That is extremely important for Conflux.

A self-learning system will accumulate a lot of memory and skills. Without progressive disclosure, the context window gets destroyed. The harness needs a router/retriever that decides:

```text
What memory should be always loaded?
What memory should be searched?
What skills are relevant?
What skill version should be used?
What tenant/project/user scope applies?
What should be excluded for security reasons?
```

So Conflux should not treat learned knowledge as “just append more context.” It needs a retrieval and loading strategy.

---

# 6. Self-evolution repo: automated improvement through evaluations

There is also a separate repository called **hermes-agent-self-evolution**. That project is more explicit about optimization. It uses **DSPy + GEPA** to evolve and optimize skills, tool descriptions, system prompts, and eventually code. The README describes a loop where it reads a current skill/prompt/tool, generates an evaluation dataset, creates candidate variants, evaluates them, applies constraint gates, and produces the best variant as a PR. ([GitHub][3])

The stated process is:

```text
Read current skill/prompt/tool
  ↓
Generate eval dataset
  ↓
Use GEPA optimizer with execution traces
  ↓
Generate candidate variants
  ↓
Evaluate candidates
  ↓
Apply gates: tests, size limits, benchmarks
  ↓
Open PR with best variant
```

That matters because it separates **runtime learning** from **offline/evaluation-driven evolution**.

Hermes runtime learning:

```text
Agent creates/patches memories and skills during use.
```

Hermes self-evolution:

```text
External optimizer mutates skills/prompts/tools using traces and evals, then proposes changes through PR review.
```

The self-evolution repo explicitly says it does not require GPU training and works through API calls by mutating text, evaluating results, and selecting better variants. It also says human review is required before changes land; evolved variants must pass tests, size limits, semantic-preservation checks, and PR review. ([GitHub][3])

That is the safer pattern.

For Conflux, I would strongly copy that separation:

```text
Online learning:
  - Save memories
  - Draft skills
  - Patch private skills
  - Store traces
  - Track outcomes

Offline evolution:
  - Analyze traces
  - Generate eval sets
  - Propose skill/prompt/tool changes
  - Run tests
  - Require approval
  - Promote version
```

Do **not** let a production multi-user harness silently mutate global behavior without approval.

---

# 7. Architecture behind the loop

Hermes has a central `AIAgent` loop that builds prompts, resolves providers, dispatches tools, handles compression/caching, and persists sessions. The architecture docs list `run_agent.py` as the core conversation loop, `prompt_builder.py` for prompt assembly, `memory_manager.py` for memory orchestration, `hermes_state.py` for SQLite session state with FTS5, and `skill_commands.py` for skill slash commands. ([Hermes Agent][4])

The basic data flow is:

```text
User input
  → CLI/gateway
  → AIAgent.run_conversation()
  → build system prompt
  → resolve model/provider
  → call model
  → execute tool calls
  → final response
  → save session
```

For gateway messages, it authorizes the user, resolves the session key, creates an agent with session history, runs the conversation, and delivers the response through the platform adapter. ([Hermes Agent][4])

This is very close to the structure Conflux should have, except Conflux needs to be multi-user/multi-tenant from the start.

---

# 8. What “self-learning” does and does not mean

## It does mean

Hermes can:

```text
remember durable facts
search past conversations
create reusable workflow skills
patch existing skills after new lessons
load relevant skills on demand
use external memory providers
evolve skills/prompts offline using evals and traces
```

## It does not mean

Hermes is probably not:

```text
fine-tuning the model weights during normal use
changing the base LLM itself
magically improving without stored artifacts
safe to let mutate all behavior globally without review
equivalent to reinforcement learning in the strict ML-training sense
```

The learning is mostly **artifact-based adaptation**.

That is actually good. It is explainable, auditable, reversible, versionable, and portable.

---

# My take for Conflux

For **Conflux**, the right lesson from Hermes is this:

> Self-learning should be implemented as versioned memory, skills, traces, and evaluation-driven improvements — not as opaque model mutation.

I would define Conflux’s learning system around five layers:

## 1. Memory layer

Stores facts and preferences.

```text
user memory
project memory
tenant memory
agent memory
environment memory
```

## 2. Session/history layer

Stores raw conversations, tool calls, files, errors, corrections, and outcomes.

```text
sessions
messages
tool_calls
artifacts
trace_events
```

## 3. Skill layer

Stores reusable procedures learned from experience.

```text
skills
skill_versions
skill_files
skill_scripts
skill_templates
skill_permissions
```

## 4. Reflection layer

Decides what should be learned.

```text
Should this become memory?
Should this become a skill?
Should an existing skill be patched?
Should this require approval?
Was the task successful?
Did the user correct the agent?
```

## 5. Evolution layer

Improves skills/prompts/tools offline.

```text
trace mining
eval generation
candidate generation
benchmarking
security checks
human approval
promotion to active version
```

---

# Recommended Conflux learning loop

```text
1. User or automation runs a task.

2. Agent executes tools and produces a result.

3. Harness stores full trace:
   - prompt
   - model
   - tools used
   - errors
   - fixes
   - outputs
   - user feedback

4. Reflection job reviews the trace:
   - What was learned?
   - Is it user-specific, project-specific, or global?
   - Is it factual memory or procedural skill?
   - Does it need approval?

5. Conflux writes:
   - memory entry
   - skill draft
   - skill patch
   - evaluation case
   - follow-up task

6. Future tasks retrieve:
   - relevant user memory
   - project memory
   - similar sessions
   - applicable skills
   - current policy

7. Offline optimizer periodically improves:
   - skill wording
   - tool descriptions
   - routing prompts
   - validation checklists

8. Admin/user approves promotion.
```

That gives you the Hermes-style self-learning behavior, but with the governance needed for a real multi-user platform.

---

## Bottom line

Hermes self-learning works by externalizing experience into durable, reusable artifacts:

```text
MEMORY.md / USER.md = facts and preferences
SQLite FTS5 sessions = searchable history
SKILL.md files = reusable procedural knowledge
skill_manage = agent-created/agent-updated skills
self-evolution repo = eval-driven optimization of skills/prompts/tools
```

For **Conflux**, I would copy the pattern but make it enterprise/multi-user native:

```text
scoped memory
versioned skills
auditable traces
approval workflows
RBAC
tenant/project isolation
evaluation-driven promotion
admin-visible learning history
```

That is the difference between a clever single-user agent and a serious agentic harness.

[1]: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory "Persistent Memory | Hermes Agent"
[2]: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills "Skills System | Hermes Agent"
[3]: https://github.com/NousResearch/hermes-agent-self-evolution "GitHub - NousResearch/hermes-agent-self-evolution: ⚒ Evolutionary self-improvement for Hermes Agent — optimize skills, prompts, and code using DSPy + GEPA · GitHub"
[4]: https://hermes-agent.nousresearch.com/docs/developer-guide/architecture "Architecture | Hermes Agent"
