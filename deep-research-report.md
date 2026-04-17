# Bounded relational verification for tiny handler and adapter bodies

## Why this target is the shortest bridge

Your current platform already has the right trust posture: it prefers **refusal + validator-gated apply** over “guessing,” and it already uses layered evidence (canonicalization, witnesses, differential validation, SMT-bounded checks). The remaining “highest-leverage bridge” is to make the validator strong enough to cover **small real function bodies** (request extraction → validation/defaulting → model construction → response writing) while continuing to reject loops, reflection-heavy code, and framework magic.

The research below converges on a practical architecture for that bridge:

- Treat every transform as **per-instance validation** (translation validation) rather than attempting to prove the whole transformer. This is exactly the stance of translation validation work, where each compiler run is followed by a validation phase. citeturn4view5turn6view0
- Reduce “before vs after” checking to a **single relational object** using a cross-product / product-program idea, because that allows you to reuse single-program verification machinery. citeturn3view1turn11view1
- Use **e-graphs** as a pre-proof normalizer and alignment helper, because most false mismatches are representation-level (different expression shapes) rather than real semantics differences. citeturn3view5turn15view1
- When proof is hard or incomplete, backstop with **differential counterexample generation** (symbolic diff + fuzz), and feed failures into repair. citeturn21view0turn19view0

The sources you listed map cleanly onto this architecture.

## Translation validation patterns to steal for RefactorPilot

### Alive2’s “no false alarms” stance is a template for validator outcomes

Alive2 validates **pairs of functions** by checking a **refinement** relation: for every possible input state, the optimized (target) function must exhibit a subset of the behaviors of the original (source) function; without undefined behavior this reduces to equivalence. citeturn6view0 This “subset of behaviors” framing is useful for your boundary transforms because it makes “what counts as safe” explicit: a refactor that introduces a new observable HTTP behavior is a failure.

The most directly stealable parts for RefactorPilot are not LLVM-specific—they are validator *policies*:

- **Boundedness is explicit and engineered, not an afterthought.** Alive2 bounds resource use by unrolling loops to a chosen factor and bounding time/memory. citeturn6view0turn6view2 This mirrors your “tiny adapter subset” focus: for Phase 5 you can simply reject loops; later you can reintroduce bounded unrolling selectively.
- **Unsupported features become “unknown” rather than “wrong.”** Alive2 attempts to over-approximate unsupported features (e.g., unknown intrinsics as unknown functions with broad effects), tags the over-approximation, and when it finds a potential bug it checks whether the SMT model depends on any over-approximated feature. If dependence exists, it does not report the transform incorrect; instead it reports which over-approximations blocked proof. It outright skips some features that are not easily over-approximated (e.g., function pointers). citeturn8view4turn7view4  
  This is almost exactly the refusal boundary behavior you want: tri-state validator output (proved / disproved with counterexample / unknown → refuse or escalate to testing).
- **Bounds are chosen strategically, with domain-specific guidance.** Alive2 documents tradeoffs and concrete guidance: unroll factor must be at least 2 for some cases; loop-manipulating optimizations may require much higher unroll factors (e.g., 64) due to transformations that “compress” iterations (vectorization). citeturn6view2  
  For RefactorPilot Phase 5, the direct analog is: if you reject loops, your “bound” is effectively 0 for loops and “small” for straight-line code; later, you can adopt bounded unrolling only for explicitly supported loop idioms (if ever).

What Alive2 “emits” in practice is not a human-checkable proof in a proof assistant; it emits (a) a decision about refinement within the bound and (b) diagnostics about what prevented proof when over-approximations are involved, grounded in SMT models. citeturn8view4turn7view4

### CoVaC’s cross-product is directly relevant to tiny handler bodies

CoVaC frames compiler validation as proving equivalence by reducing the problem to analysis of a **single system**: a **cross-product** of the two programs. It emphasizes that the approach is effective for **consonant** programs (structurally similar). citeturn3view1

That “consonant programs” condition is exactly why this matters for your target: tiny handler/adapter bodies produced by a disciplined refactoring pipeline are often *more consonant than arbitrary code* (same stages: extract request fields → validate/default → build response object → write JSON + status).

Stealable subset for RefactorPilot: you can construct a product program that runs “before” and “after” in lockstep over a shared abstract request/response state, and discharge equivalence/refinement by proving that corresponding observations match. This is a minimal, Phase 5-friendly way to get relational checking without needing the full generality of alignment-search frameworks. citeturn3view1turn11view1

### Synchronous-language translation validation reinforces the “automation first” constraint

The “translation validation for synchronous languages” work explicitly contrasts translation validation with compiler verification: instead of proving the translator correct in advance, each individual translation is followed by a validation phase verifying that the produced code correctly implements the submitted source; and a key feature for practicality is **full automation**. It also notes that validation tries to “unravel” the transformation, which becomes harder as optimizer sophistication increases. citeturn4view5

The takeaway for your bounded envelope is: do not chase whole-language correctness; keep the semantic subset small enough that unraveling is tractable and automatable—exactly consistent with rejecting loops, reflection, and framework magic in Phase 5. citeturn4view5turn8view4

## Product programs and alignment for relational verification

### KestRel shows how to build alignments, and also how they fail

KestRel’s contribution is an approach to relational verification that uses **e-graphs + equality saturation + algebraic realignment rules** to represent a space of candidate alignments, then uses a **data-driven extraction** process that examines **execution traces** to estimate semantic quality of alignments. citeturn11view1turn11view0 It then reifies the chosen alignment into an intermediate program annotated with **assume/assert**, which can be handed to off-the-shelf verifiers. citeturn11view3turn11view1

This matches your intended outcome almost line-for-line:

- “Represent before/after adapters as one relational object” maps to KestRel’s reification into a single intermediate program with assume/assert. citeturn11view3turn11view1
- “Fail early when alignment is bad” maps to KestRel’s explicit emphasis that verification is too expensive to use as the alignment metric, and that purely syntactic metrics miss semantic alignment; hence traces are used to approximate semantic fitness. citeturn11view0turn11view2
- “What subsets are realistic” is reflected by KestRel’s own empirical notes about where its data-driven search can fail: simulated annealing can fail when the alignment space is large, causing the MCMC search to converge too slowly, and in some cases syntactic extraction is the better starting point. citeturn12view0turn11view1

Smallest stealable subset for RefactorPilot (Phase 5): take KestRel’s *structure*, but drop the hard parts:

- Restrict to **straight-line, well-typed adapter code**, possibly with small conditionals, and (per your refusal boundary) reject loops entirely. This removes KestRel’s most complex trace heuristics around loops. citeturn11view2turn6view2
- Keep the idea that alignments operate over **disjoint variable namespaces** (alpha-renaming), because this makes product construction cleaner and matches your canonical IR approach. citeturn11view1
- Keep the “assume/assert reification” idea so the output artifact is a single verification object you can hand to your SMT backend (or your existing obligation solver). citeturn11view3

### The algebra of alignment gives you a vocabulary for “alignment witnesses”

The “algebra of alignment” work introduces an explicit algebra (BiKAT, extending Kleene Algebra with Tests) intended to subsume prior alignment formulations and enable **constructive proof of adequacy by equational reasoning**. citeturn13view1turn13view2 It explicitly discusses alignments as “witnesses” for certain relational properties, with correctness conditions expressed equationally. citeturn13view3turn13view2

For RefactorPilot, the most stealable part is not implementing BiKAT as a full theorem-proving backend; it is using BiKAT as design guidance for what a **proof-carrying alignment artifact** might look like:

- An “alignment witness” is a first-class object that justifies how steps in “before” and “after” correspond, and adequacy must be provable (even if only in a bounded SMT encoding at first). citeturn13view3turn13view2
- The algebraic framing makes it easier to define “bad alignment” early: if you cannot construct a witness within your supported semantic subset, treat that as a refusal trigger rather than attempting heroic verification. citeturn13view2turn8view4

This is Phase 6 material insofar as it influences how you structure and store “alignment evidence,” but the immediate Phase 5 implementation can still benefit by logging alignment decisions in a witness-like structured format for later upgrading.

## Equality saturation and e-graphs for normalization and pre-proof equivalence

### egg’s two key ideas translate directly to “canonicalize first, prove second”

The egg paper describes e-graphs as representing a congruence relation over many expressions and equality saturation as a rewrite-driven technique for optimization and synthesis; it focuses on making equality saturation fast and extensible via (1) **rebuilding** and (2) **e-class analyses**. citeturn3view5turn14view0turn14view1

The stealable subset for your handler/adapter semantics is:

- Use e-graphs to represent many equivalent adapter expressions (e.g., equivalent ways of constructing a response body or setting fields), then extract a canonical minimal-cost representation before generating SMT obligations. The paper explicitly describes extraction as selecting an optimal term from an e-class according to a cost function, and explains how extraction can be done efficiently when the cost is local (even “on the fly” via e-class analyses). citeturn14view3turn14view4turn14view1
- Use e-class analyses to attach semantic metadata that influences extraction and rewriting (egg frames them as integrating domain-specific analyses into the e-graph). citeturn14view1turn14view2 For RefactorPilot, the analysis payload could be things like “this expression is pure,” “this is a request-field read,” “this is a response status write,” “this is a JSON body constructor,” enabling stronger canonicalization and earlier refusal triggers.

The egg repository positions egg as a reusable library for building optimizers, synthesizers, and verifiers using e-graphs/equality saturation, reinforcing that it’s meant to be used as infrastructure rather than a one-off compiler pass. citeturn4view3

Where e-graphs stop helping: e-graphs excel at equational reasoning under a rewrite theory, but they do not automatically decide semantic equivalence when effects, control-flow, or “hidden” framework semantics dominate. That boundary is consistent with your plan to reject loops and mutation-heavy logic; it’s also consistent with KestRel’s need to reify and hand off to verifiers. citeturn11view3turn6view2

### HEC is a proof that equality saturation can scale as an equivalence checker, but it’s more than you need now

HEC presents an equivalence checking framework based on e-graph rewriting that takes MLIR as input and aims to verify both control-flow and datapath transformations. It combines static rewrite rules with **dynamic rewriting capabilities** for cases where transformation parameters and metadata vary and cannot be captured by purely static rules. citeturn15view1turn16view3 It demonstrates verification of loop transformations (unrolling, tiling, fusion) and reports finding real transformation bugs (e.g., loop-boundary check errors and memory RAW violations) in a compiler tool. citeturn16view4turn16view1

The minimum subset to steal for RefactorPilot is conceptual:

- Treat equality saturation not only as an optimizer but as a **verification engine**: if both before and after normalize into the same canonical e-graph equivalence class under your handler/adapter rewrite theory, you can discharge some obligations without SMT (or reduce SMT complexity). citeturn15view1turn14view3
- Keep in mind HEC’s warning that static rewrite rules can be insufficient in transformations that introduce runtime-dependent metadata; HEC motivates dynamic rewrites for such cases. citeturn16view3 For Phase 5 you can avoid this entirely by refusing those cases and limiting transforms to ones whose semantics are captured by a small static rewrite set.

Given your explicit “reject loops” constraint, most of HEC’s loop-handling machinery is intentionally out of scope for now. citeturn6view2turn16view4

## Differential validation for paired adapter checks

### CrossHair diffbehavior is a ready-made “counterexample generator” for Python diffs

CrossHair’s diffbehavior compares two functions and finds inputs that distinguish them, printing the “given” input and the differing post-execution results (including mutated argument state). citeturn21view0 It does this by using an SMT solver to explore execution paths and search for arguments, sharing the engine used for contract checking. citeturn21view0

Crucially for your refusal boundary and safety posture, the docs explicitly list limitations/caveats:

- absence of a counterexample does not guarantee equivalence,
- it is best targeted at the smallest piece of logic,
- arguments need type annotations and must be deep-copyable and equality-comparable to detect mutation,
- only deterministic behavior can be analyzed,
- CrossHair will actually run your code and may apply arguments to it. citeturn21view0

It also exposes side-effect controls (audit-event based blocking/unblocking), and controls exception equivalence while searching for counterexamples. citeturn21view2turn17view1

Smallest stealable subset: for Phase 5, use diffbehavior as an automated counterexample producer for “adapter body equivalence” when:

- the function is small,
- effects are either absent or explicitly permitted,
- you can provide strong type annotations,
- you can snapshot pre/post state cleanly. citeturn21view0turn21view2

This maps almost directly to your “witnesses + differential validation” layers: diffbehavior is a witness generator that complements SMT obligations, and it naturally yields actionable counterexamples for repair. citeturn21view0turn8view4

### Go fuzzing yields regression artifacts that fit validator-gated workflows

Go’s fuzzing documentation emphasizes that Go fuzzing is coverage-guided and integrated into the standard toolchain (Go 1.18+). citeturn17view2 It explains baseline coverage, interesting inputs (coverage-expanding), and corpus management. citeturn17view3turn19view1

Two details are especially stealable for RefactorPilot:

- When a failure is found, the **failing input is written to** `testdata/fuzz/...` and can be re-run via a `go test -run=...` invocation; the doc explicitly notes that this failing input becomes part of the seed corpus and will be run by default with `go test`, serving as a regression test after fixing the bug. citeturn19view0  
  This is perfect for your “validator finds mismatch → repair loop”: the system can automatically materialize a regression artifact.
- The doc specifies constraints on fuzz target argument types and seed corpus entry types (must match fuzzing arguments, and only certain primitive types are allowed). citeturn19view3turn19view4  
  This suggests you should encode HTTP adapter test inputs into these admissible types (e.g., `[]byte` representing a serialized request, plus integers for headers/status), matching your existing “boundary subset” approach.

### gopls can be used as a strong static oracle, but it openly warns about runtime/reflection gaps

The gopls transformation docs describe transformations as including behavior-preserving changes (refactorings/formatting/simplifications), plus fixes and editing support. citeturn20view2

For rename specifically, gopls documents that its renaming algorithm “takes great care” to detect potential compilation errors, including:

- shadowing that would put references out of scope, and
- renaming methods in ways that would break interface satisfaction (it inspects conversions to interfaces and checks validity). citeturn20view0

But it also explicitly states that rename can still introduce **dynamic errors**, and calls out reflection-heavy packages (e.g., `encoding/json`, `text/template`) as cases where there is “no substitute for good judgment and testing.” citeturn20view0

This is exactly aligned with your refusal boundary strategy:

- Use gopls as an oracle for “this refactor does not introduce a compile error under the Go type system+package model.”
- Treat reflection-sensitive cases as “need additional validation or refusal,” and rely on fuzz/differential tests to catch dynamic breakage. citeturn20view0turn19view0

## Synthesis-backed repair with SemGuS-style tiny DSLs

SemGuS is described as a framework allowing a user to provide both **syntax (grammar)** and **semantics** of constructs; it accepts a recursively defined big-step semantics, and the SemGuS front-end language is SMT-LIB2-inspired with a grammar section and a semantics section. citeturn17view5turn17view6 The site also states that semantics can be encoded using Constrained Horn Clauses (CHC). citeturn17view6

The SemGuS paper sharpens the practical “repair loop” connection: it describes an algorithm capable of both synthesizing programs and proving unrealizability by encoding SemGuS problems as a proof search over CHCs, and claims novelty in proving unrealizability even for imperative programs with unbounded loops over an infinite syntactic search space. citeturn18view0

Smallest stealable subset for RefactorPilot is not “general synthesis”; it’s a **bounded, semantics-typed repair DSL for adapters**:

- Grammar: small set of adapter-building combinators (extract request field, parse/validate/default, construct model, set status/header, emit JSON body).
- Semantics: your existing canonical IR small-step or big-step semantics for that adapter subset.
- Search: CEGIS-like loop where each counterexample from SMT/fuzz/diffbehavior prunes the candidate space; CHC-based methods are a principled way to structure this, but Phase 5 can start with enumerative + SMT constraints and store the SemGuS-shaped problem format for later. citeturn18view0turn19view0turn21view0

“Monotonic improvement” in practice becomes: each failed candidate yields a concrete counterexample (input + observed mismatch), which is added as a constraint; the candidate set shrinks monotonically even if you do not fully mechanize CHC-based proofs yet. citeturn18view0turn21view0

## Matrix of stealable ideas, module impact, risks, cost, and priority

| paper/tool | stealable idea | RefactorPilot module impact | risk | estimated implementation cost | priority |
|---|---|---|---|---|---|
| entity["book","Alive2: Bounded Translation Validation for LLVM","pldi 2021 paper"] | Translation validation as a per-transform, bounded SMT refinement check; explicit triaging of unsupported features via over-approx + “don’t report incorrect if proof depends on over-approx,” and “skip some features entirely.” citeturn6view0turn8view4turn6view2 | Validator core: introduce explicit tri-state outcomes (proved / disproved with model / unknown with blockers); strengthen refusal boundary policy; add “blockers list” that drives escalation to fuzz/diff. citeturn8view4turn19view0 | Assumes a crisp semantics for the subset and SMT encodings; failure mode is “bounded miss” (bugs beyond bound) and “unknown due to over-approx,” plus loop/feature exclusions. citeturn6view0turn8view4turn6view2 | Medium (3–6 weeks to design + implement tri-state validator outcomes and blockers, assuming SMT plumbing exists) | Phase 5 (highest) |
| entity["book","CoVaC: Compiler Validation by Program Analysis of the Cross-Product","fm 2008 paper"] | Cross-product construction to reduce equivalence checking to analysis of one composed system; best for “consonant” structurally similar programs. citeturn3view1 | Product-program generator for tiny handlers; pushes you toward “single relational object” verification artifacts. citeturn3view1turn11view3 | Assumes the two programs are structurally similar; failure mode is poor scalability or inability to align when structures diverge. citeturn3view1turn11view0 | Medium (4–8 weeks for straight-line + small-branch cross-product in your IR) | Phase 5 (high) |
| entity["book","Translation validation for synchronous languages","icalp 1998 paper"] | Crisp statement of translation validation as “validate each run,” with full automation as the practicality requirement and difficulty increasing with optimizer sophistication (“unraveling” transformations). citeturn4view5 | Product and roadmap discipline: keeps the envelope intentionally small enough for automation; strengthens “refuse rather than guess” positioning. citeturn4view5turn8view4 | Primarily conceptual; risk is overfitting to compiler patterns (needs translation to your request/response domain). citeturn4view5 | Low (days to integrate as design constraints + test strategy) | Later (supporting rationale) |
| entity["book","KestRel: Relational Verification using E-Graphs for Program Alignment","oopsla 2025 paper"] | Alignment search as e-graph space + equality saturation, using execution traces as a semantic fitness proxy; reify to assume/assert intermediate program for off-the-shelf verification. citeturn11view1turn11view0turn11view3 | Product-program alignment module; “alignment witness” artifacts; early failure detection when alignment quality is bad; optional trace-driven fallback when syntactic alignment fails. citeturn11view0turn12view0 | Assumes you can execute candidate alignments to collect traces; failure mode is large alignment space causing slow/failed convergence (MCMC/annealing), and verification backend limitations. citeturn12view0turn11view1 | High (2–4 months for full trace-driven alignment; Medium if you steal only syntactic alignment + assume/assert reification) citeturn11view3turn12view0 | Phase 6 (but steal a small Phase 5 slice) |
| entity["book","An algebra of alignment for relational verification","popl 2023 paper"] | BiKAT as an explicit algebra enabling adequacy proofs by equational reasoning; alignments as witnesses with correctness conditions expressible equationally. citeturn13view2turn13view3 | “Witness format” and proof-carrying alignment design; informs how you store/compose alignments even before full mechanization. citeturn13view3turn11view3 | Heavy theoretical surface area; risk is spending time implementing algebra rather than shipping bounded checker; best used as design guide. citeturn13view2 | Medium (2–6 weeks to extract a practical witness schema; high to implement full BiKAT reasoning) citeturn13view2 | Later (design guidance), Phase 6 for witness schema |
| entity["book","egg: Fast and Extensible Equality Saturation","popl 2021 paper"] + entity["company","GitHub","code hosting platform"] repo | Rebuilding + e-class analyses as pragmatic ways to make EqSat fast/extensible; extraction via cost functions; library-grade infrastructure for verifiers/optimizers. citeturn14view0turn14view1turn4view3 | E-graph canonicalization layer before SMT; build a minimal rewrite library for handler semantics; reduce false mismatches and obligation complexity. citeturn14view3turn14view4 | Assumes you can encode the adapter semantics as equational rewrites; failure mode is e-graph blowup with too-rich rewrites, or missing rewrites leading to residual SMT hardness. citeturn14view3turn11view3 | Medium (4–8 weeks for a minimal rewrite library + extraction cost model) | Phase 5 (high) |
| entity["book","HEC: Equivalence Verification Checking for Code Transformation via Equality Saturation","arxiv 2025 paper"] | EqSat as equivalence checker at scale; hybrid static + dynamic rewrites; demonstrates finding real semantic bugs in transformations. citeturn15view1turn16view4turn16view1 | Long-term direction: expand e-graph verifier from straight-line handlers toward limited control flow; informs how to preserve/represent structured constructs if you later widen the envelope. citeturn16view3turn15view2 | Assumes MLIR-like structured IR and dynamic rewrite generation; failure mode is complexity/scaling (e-classes/time) especially with control-flow-heavy transforms. citeturn16view3turn16view0 | High (2–6 months if emulated; low if used only as inspiration) citeturn16view3turn15view1 | Later (unless you decide to widen beyond straight-line) |
| entity["organization","CrossHair","python symbolic analysis tool"] diffbehavior docs | SMT-guided counterexample search for behavioral diffs; prints concrete distinguishing inputs and post-states; explicit caveats and side-effect controls. citeturn21view0turn21view2 | Python differential validation layer; counterexample artifact pipeline feeding repair; refusal gating based on determinism/type-annotation requirements. citeturn21view0turn21view2 | Not complete: “no counterexample” ≠ equivalence; requires type annotations; only deterministic behavior; may execute side-effects unless blocked/unblocked explicitly. citeturn21view0turn21view2 | Low–Medium (1–3 weeks to integrate as an optional validator tier with structured counterexample capture) | Phase 5 (high for Python) |
| entity["book","Go fuzzing documentation","go 1.18+ docs"] | Coverage-guided fuzzing built into toolchain; failing inputs written to `testdata/fuzz/...` and become default regression tests with `go test`. citeturn17view2turn19view0 | Go differential validation + artifact generation; automated regression artifact emission on mismatch; stabilizes repair loop by turning mismatches into permanent tests. citeturn19view0turn19view1 | Fuzz arg type constraints; fuzzing can miss semantic mismatches if oracles are weak or if environment effects dominate; needs deterministic harness for adapters. citeturn19view3turn17view2 | Medium (2–5 weeks to build structured request/response fuzz harnesses + oracles + artifact plumbing) | Phase 5 (highest for Go) |
| entity["book","Gopls code transformation features","go.dev docs"] | Use gopls as a static “oracle”: rename rejects changes that introduce compile errors (shadowing, interface breakage), but warns about dynamic/reflection hazards where testing is needed. citeturn20view0turn20view2 | Go transformation oracle layer: post-transform gopls checks; use gopls failures as refusal signals; use “reflection hazard” as escalation trigger to fuzzing. citeturn20view0turn19view0 | gopls focuses on compile-time safety; it explicitly warns rename can still cause runtime errors via reflection or type assertions; cannot replace testing. citeturn20view0turn20view2 | Low (days–2 weeks; much already in place if you already call gopls for rename flows) | Phase 5 (medium) |
| entity["book","SemGuS: Semantics-Guided Synthesis","framework + format"] | Specify repair as grammar + semantics (big-step) and solve via CHC-style encodings; SemGuS research emphasizes algorithms that can synthesize and prove unrealizability. citeturn17view6turn18view0 | Repair engine upgrade: replace ranked heuristics with DSL+constraints; unify repair search with validator obligations; supports “monotonic improvement” by accumulating counterexamples. citeturn18view0turn21view0 | Biggest risk is overbuilding: if the DSL is too expressive, search explodes; if too small, it can’t repair real mismatches. Requires crisp adapter semantics in IR. citeturn18view0turn17view6 | Medium–High (1–3 months for a useful tiny DSL + solver loop; can stage by emitting SemGuS-shaped problems first) citeturn17view6turn18view0 | Phase 6 (high), later for full SemGuS integration |

