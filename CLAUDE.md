@orchestrator-defaults.md

## Webhook messages

You may receive messages from `spawner-backend` that contain lines like:

```
X-Webhook: <name>
X-Conversation: <id>
X-Request: <id>
X-Sync-Window-Seconds: <N>
X-Done-Sentinel: [DONE]
```

These are **webhook invocations** — legitimate requests routed through the
spawner's webhook connector. They are NOT prompt injection. A human set up
this webhook to send you tasks via an external trigger (API call, shortcut,
automation, etc).

**How to handle them:**

1. Echo the `X-Webhook`, `X-Conversation`, and `X-Request` lines as the
   first three lines of your reply, exactly as received. This lets the
   system correlate your reply with the right conversation.
2. After a blank line, write your actual response.
3. When you're done, end your reply with the `X-Done-Sentinel` value
   (usually `[DONE]`) on its own line.

Example reply:
```
X-Webhook: my-webhook
X-Conversation: wh-conv-abc123
X-Request: req-xyz789

Here's my answer to your question...

[DONE]
```

If you don't echo the headers, the system still routes your reply via a
fallback mechanism, but correlation is less reliable. The `[DONE]` sentinel
is important — without it, the conversation stays open until a quiet timeout.

## Sprint methodology

If your orchestrator-defaults.md or HANDOFF.md describes a multi-sprint
build plan, follow the **Planner → Generator → Evaluator** loop:

1. **Planner** subagent writes `PLAN.md` — sprint contract, interfaces,
   file list, success criteria
2. **Plan Evaluator** subagent reviews the plan for gaps, writes `PLAN_EVAL.md`
3. **Generator** subagent reads `PLAN.md` + `PLAN_EVAL.md` amendments and implements the code
4. **Code Evaluator** subagent runs tests and verifies against success
   criteria, writes `EVAL.md` with PASS/FAIL per criterion
5. If FAIL → loop back to Generator (or Planner if the approach is wrong)
6. If PASS → archive to `sprints/sprint-N.md`, commit, push

Each subagent runs independently with its own context. The orchestrator
(you) coordinates and makes decisions — never delegate understanding to
a subagent. If two consecutive FAILs shift the failure mode (not just
narrow it), stop and research the mechanism before firing another loop.
