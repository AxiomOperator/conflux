
---

# Synapse

**Synapse** is the standalone visual activity layer for the Conflux agentic harness.

Where **Conflux** is the runtime, orchestration, memory, and governance layer for multi-user self-learning AI agents, **Synapse** is the live operational view into that system. It visually shows how agents, users, tools, tasks, memory, skills, workflows, and events interact in real time.

The concept is similar to a visualization of the human brain: signals firing, pathways forming, memories being accessed, and different regions becoming active based on what the system is doing.

In Conflux, those “signals” are agent activity.

---

## Simple description

> **Synapse is a standalone observability and activity visualization site for Conflux. It shows the harness thinking, learning, routing, remembering, and acting in real time through an interactive brain-like network view.**

---

## Longer product description

**Synapse** is the visual intelligence layer of the Conflux platform. It provides a real-time, interactive map of activity across the agentic harness, showing how users, agents, tools, memory stores, skills, workflows, and system events connect.

Instead of presenting activity as only logs, tables, or dashboards, Synapse represents the harness as a living network. Agent executions appear as signals moving through the system. Tool calls light up as active pathways. Memory retrievals show which knowledge nodes were accessed. Skill creation and updates appear as new pathways being formed. Multi-agent delegation is visualized as activity moving between specialized nodes.

Synapse gives administrators, developers, and power users a way to understand not only **what** happened, but **how** the harness arrived there.

---

## What Synapse shows

Synapse would visually represent things like:

| Harness Activity       | Synapse Visualization                      |
| ---------------------- | ------------------------------------------ |
| User submits a task    | Signal enters the network from a user node |
| Agent starts reasoning | Agent node activates                       |
| Tool call happens      | Pathway lights up from agent to tool       |
| Memory is retrieved    | Memory node pulses or expands              |
| Skill is loaded        | Skill node attaches to the active workflow |
| Subagent is delegated  | Signal branches to another agent node      |
| Workflow continues     | Signal moves across connected nodes        |
| Error occurs           | Node/path changes state visually           |
| Approval is required   | Flow pauses at a human gate                |
| Learning occurs        | New memory or skill node is created        |
| Task completes         | Signal resolves into an output artifact    |

---

## Better conceptual definition

> **Synapse is a real-time cognitive map for Conflux. It transforms agent activity, memory access, tool usage, workflow execution, and learning events into an interactive network visualization, giving users a clear view of how the harness operates internally.**

---

## Human brain analogy

In the human brain, a synapse is the connection point where signals pass between neurons.

In Conflux:

* **Users** are input sources.
* **Agents** are active processing nodes.
* **Tools** are motor functions.
* **Memory** is long-term knowledge.
* **Skills** are learned behaviors.
* **Workflows** are neural pathways.
* **Events** are electrical signals.
* **Policies and approvals** are control gates.
* **Learning** is the formation or strengthening of pathways.

So the name **Synapse** fits because it represents the points of connection and activity inside the system.

---

## Positioning statement

> **Synapse is the brain-view for Conflux — a standalone visual interface that shows the live activity, memory access, tool usage, workflow execution, and self-learning behavior of the harness as an interactive neural network.**

---

## More technical positioning

> **Synapse is a standalone observability and visualization application for Conflux that consumes event streams, traces, workflow state, memory activity, tool calls, and agent lifecycle events to render a real-time interactive graph of the harness.**

---

## What makes it different from a normal dashboard

A normal dashboard shows:

```text
requests per minute
latency
errors
token usage
tool calls
task status
```

Synapse should show:

```text
which agent acted
why it acted
what memory it used
which tools it called
which skill was loaded
which workflow path was followed
where the task branched
where the agent failed
where learning happened
what changed after the task
```

That makes Synapse more than observability. It becomes **agentic explainability**.

---

## Possible tagline options

**Best overall:**

> **Synapse: The live brain-view of Conflux.**

Other options:

> **See the harness think.**

> **A visual nervous system for self-learning agents.**

> **Real-time visibility into agents, memory, tools, and learning.**

> **The activity map for multi-user AI orchestration.**

> **Watch intelligence move through the harness.**

---

## Recommended architecture description

Synapse should probably be separate from the Conflux core runtime.

Conflux emits structured events:

```text
agent.started
agent.reasoning
tool.called
tool.completed
memory.searched
memory.loaded
skill.loaded
skill.created
skill.updated
workflow.started
workflow.paused
workflow.completed
approval.requested
error.raised
learning.proposed
learning.accepted
```

Synapse consumes those events and renders them visually.

That separation is important because Synapse should not be responsible for executing agents. It should observe, replay, inspect, and explain harness activity.

```text
Conflux Core
  ↓ emits events/traces
Event Stream / Trace Store
  ↓ consumed by
Synapse
  ↓ renders
Live Graph / Timeline / Replay / Activity Map
```

---

## Feature ideas for Synapse

The core UI could include:

| Feature                    | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| Live Neural Graph          | Brain-like map of active users, agents, tools, memory, and workflows |
| Task Replay                | Reconstruct a previous agent run step-by-step                        |
| Memory Activation View     | Show which memory nodes were retrieved and used                      |
| Skill Pathways             | Show which skills were used, created, or patched                     |
| Agent Delegation Map       | Show how work moved between agents                                   |
| Tool Activity View         | Show external systems touched by agents                              |
| Error Path Tracing         | Highlight where a workflow failed or got stuck                       |
| Learning Events            | Show when the harness proposed or created new knowledge              |
| User/Tenant Isolation View | Show activity scoped to a user, team, project, or tenant             |
| Audit Trail Overlay        | Connect visual activity to raw logs and trace records                |

---

## Clean final description

You could describe it like this in a design doc:

> **Synapse is a standalone visual observability site for the Conflux agentic harness. It provides a real-time, brain-like network view of harness activity, showing users, agents, tools, memory, skills, workflows, approvals, and learning events as connected nodes and live signals. Synapse is designed to make agentic systems understandable by showing not only what happened, but how activity moved through the harness, which knowledge was used, which tools were called, where decisions branched, and where new learning was created.**

And the shortest version:

> **Synapse is the live brain-view of Conflux: a standalone visual interface that shows the harness thinking, acting, remembering, and learning in real time.**
