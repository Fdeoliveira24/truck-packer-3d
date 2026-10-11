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

## Editor Authority and AutoPack/Manual Placement Work

Before editing AutoPack, manual placement, editor drag/rotate, Truck Change, handling rules, assessment, or any operation-lifecycle work:

1. **Read first:** `docs/engineering/autopack-engine-contract.md` — specifically the "Editor Authority and Automation Boundary" section.
2. **Understand:** Cargo Planner 3D is a manual load-planning workspace first. AutoPack is an assistant. Hard physical geometry is always enforced, but handling/planning rules should warn rather than block.
3. **Reference:** `docs/product/TP3D-MASTER-TODO-V6.md` Section 5.5 for Phase C execution status.
4. **Implementation guard:** Load the `tp3d-autopack-guard` skill before implementing AutoPack/editor/manual-placement work.

Key principle: Do not convert assessment/handling rules into manual mutation locks unless the contract explicitly classifies the condition as hard physical geometry (truck/container boundaries, collision, Wheel Wells, Front Overhang, unsupported placement).

## project-memory routing

- History/prior decision/previous fix/"why did we": run `bash tools/project-memory query "<question>"`.
- Code structure/ownership/"where is": use Graphify against `graphify-out/graph.json`.
- Current behavior: verify directly in current source and active contracts/docs.
- Generic programming question: do not claim project memory retrieval happened unless it was actually run.
- Conflict: current source and current authoritative contract win over historical memory.
- Keep retrieval small: up to 3 short passages; never inject entire notes/folders or full graph artifacts.

## current roadmap

`docs/product/TP3D-MASTER-TODO-V6.md` is the current operational roadmap and approved queue.
`docs/product/TP3D-MASTER-TODO-V5.md` is frozen/historical — do not use it to determine active work.
