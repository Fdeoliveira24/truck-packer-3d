## graphify

For any question about this repo's architecture, structure, components, or how to add/modify/find
code, your first action should be `graphify query "<question>"` when `graphify-out/graph.json`
exists. Use `graphify path "<A>" "<B>"` for relationship questions and `graphify explain "<concept>"`
for focused-concept questions. These return a scoped subgraph, usually much smaller than the full
report or raw grep output.

Triggers: "how do I…", "where is…", "what does … do", "add/modify a <component>",
"explain the architecture", or anything that depends on how files or classes relate.

If `graphify-out/wiki/index.md` exists, use it for broad navigation. Read `graphify-out/GRAPH_REPORT.md`
only for broad architecture review or when query/path/explain do not surface enough context. Only read
source files when (a) modifying/debugging specific code, (b) the graph lacks the needed detail, or
(c) the graph is missing or stale.

Type `/graphify` in Copilot Chat to build or update the graph.

## project-memory routing

- History/prior decision/previous fix/"why did we": run `tools/project-memory query "<question>"`.
- Code structure/ownership/"where is": use CODE Graphify against `graphify-out/graph.json`.
- Current behavior: verify directly in current source and active contracts/docs.
- Generic programming question: do not claim project memory retrieval happened unless it was actually run.
- Conflict: current source and current authoritative contract win over historical memory.
- Keep retrieval small: up to 3 short passages; never inject entire notes/folders or full graph artifacts.
