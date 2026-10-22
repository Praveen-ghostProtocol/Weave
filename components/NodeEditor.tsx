"use client";

// Node editor panel (DESIGN.md §4 "Node editor"): fixed-width 420px panel,
// not a modal. Reads/writes via useGraph directly — no prop-drilled API,
// per the architecture decision that components talk to the shared state
// container themselves. Positioning this panel inside the app layout is the
// integration task's job, not this component's (it just assumes it gets
// slotted into a flex/grid parent at full height).
//
// AI drafting assist (`ai-node-drafting`) lives here too: one quiet
// secondary button under the title, which swaps the Notes region for a few
// AI-written questions and turns the answers into a draft. Deliberately NOT
// two equal buttons offering "write it yourself" or "use AI" — the editor
// already IS the write-it-yourself path, and presenting it as a mode to
// choose makes the default feel like a decision. Same grammar as the export
// sidebar: the primary action is untouched, AI is additive and secondary.
import {
  forwardRef,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { getDescendants } from "@/lib/graph/parent";
import { useGraph } from "@/lib/storage/useGraph";
import { useSession } from "@/lib/supabase/useSession";

interface DraftQuestion {
  text: string;
  /** Absent means free text. Never an empty array. */
  options?: string[];
}

interface NodeEditorProps {
  nodeId: string | null;
  onClose: () => void;
  /**
   * Pre-selects "Part of" when opening a brand-new node. Set when the user
   * came here via "Add a sub-node" from a node they were reading, so the
   * relationship they just expressed is already filled in rather than
   * something they have to re-state in the dropdown.
   */
  initialParentId?: string;
  /**
   * Asks the parent to swap this panel for a new node nested under `id`.
   * Routed upward rather than handled here because the page owns the
   * unsaved-changes check and the remount key.
   */
  onAddChild?: (id: string) => void;
}

// Exposed to the parent so it can check for unsaved changes before swapping
// which node this panel edits (e.g. clicking a different graph node, or
// "+ New node", while mid-edit) — a `key` change remounts this component
// directly, bypassing its own Cancel button and any state it holds, so the
// parent needs to ask *before* triggering that remount, not after.
export interface NodeEditorHandle {
  isDirty: () => boolean;
}

type AiStatus = "idle" | "asking" | "drafting" | "error";

/**
 * One interview question: a row of tappable options with an "Other" escape,
 * or a plain textarea when the model offered no options.
 *
 * The answer is always a single string whichever path produced it, so the
 * drafting call never needs to know the difference — no second shape to
 * validate server-side, and nothing breaks if a question comes back in a
 * different style on a later run.
 */
function QuestionField({
  id,
  question,
  value,
  onChange,
}: {
  id: string;
  question: DraftQuestion;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = question.options ?? [];
  const hasOptions = options.length > 0;
  // "Other" is on whenever there is an answer that is not one of the
  // options. Derived rather than stored, so it cannot drift out of step
  // with the value: picking a chip turns it off by itself.
  const isOther = hasOptions && value.trim().length > 0 && !options.includes(value);
  const [otherOpen, setOtherOpen] = useState(false);
  const showOther = isOther || otherOpen;

  if (!hasOptions) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="text-sm font-medium leading-snug text-[var(--ink)]">
          {question.text}
        </label>
        <textarea
          id={id}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="resize-none rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] leading-normal text-[var(--ink)]"
        />
      </div>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium leading-snug text-[var(--ink)]">
        {question.text}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                // Tapping the chosen chip again clears it. Every answer is
                // optional, so un-answering has to be reachable.
                onChange(selected ? "" : opt);
                setOtherOpen(false);
              }}
              className={`rounded-full border px-3 py-1 text-[13px] transition-transform active:scale-[0.98] ${
                selected
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-[var(--line)] text-[var(--ink)]"
              }`}
            >
              {opt}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showOther}
          onClick={() => {
            onChange("");
            setOtherOpen(!showOther);
          }}
          className={`rounded-full border px-3 py-1 text-[13px] transition-transform active:scale-[0.98] ${
            showOther
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-[var(--line)] text-[var(--ink-muted)]"
          }`}
        >
          Other
        </button>
      </div>
      {showOther && (
        <textarea
          id={id}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="In your own words"
          className="resize-none rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] leading-normal text-[var(--ink)]"
        />
      )}
    </fieldset>
  );
}

const NodeEditor = forwardRef<NodeEditorHandle, NodeEditorProps>(function NodeEditor(
  { nodeId, onClose, initialParentId, onAddChild },
  ref,
) {
  const { graph, addNode, updateNode, deleteNode, setParent } = useGraph();
  const { user, loading: sessionLoading } = useSession();
  const existing = nodeId ? graph.nodes.find((n) => n.id === nodeId) ?? null : null;

  // IMPORTANT: this panel stays mounted (it's not a modal — DESIGN.md), so
  // switching which node is open changes the `nodeId` prop on an already-
  // mounted instance. useState's initializer only runs once per mount, so
  // without a remount the form would keep showing the previous node's text
  // and silently save it under the new node's id on Save. The caller MUST
  // render this with `key={nodeId ?? "new"}` so React remounts (and these
  // initializers re-run) whenever the edited node's identity changes —
  // this is React's own recommended fix for "reset state when a prop
  // changes" (see react.dev/learn/you-might-not-need-an-effect), not an
  // oversight. An effect-based resync was tried and reverted: it works but
  // trips the project's set-state-in-effect lint rule and is strictly more
  // code for the same result.
  const [title, setTitle] = useState(existing?.title ?? "");
  const [domain, setDomain] = useState(existing?.domain ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [parentId, setParentId] = useState<string>(
    existing?.parentId ?? initialParentId ?? ""
  );

  // --- AI drafting assist state ---
  // Interview mode replaces the Notes region in place (same panel, same
  // width) rather than opening a modal or a second panel — identical
  // reasoning to the export sidebar's result block.
  // A question is either a free-text box or a small set of taps with an
  // "Other" escape. Typing five long answers was what made this feature
  // tiring in real use; options turn the categorical ones into a tap
  // without letting the whole interview collapse into guessed buckets.
  const [questions, setQuestions] = useState<DraftQuestion[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);
  // When the Notes field already has content, a draft lands here for the
  // user to place rather than silently overwriting their writing.
  const [proposed, setProposed] = useState<string | null>(null);
  // Synchronous double-submit guard, same reasoning as ExportPanel's: the
  // button's `disabled` relies on React committing state before a second
  // click lands, which is timing, not a lock. Each of these calls reserves
  // budget against the user's quota.
  const aiInFlightRef = useRef(false);

  const inInterview = questions !== null;

  const uid = useId();
  const titleId = `${uid}-title`;
  const domainId = `${uid}-domain`;
  const domainListId = `${uid}-domainlist`;
  const parentSelectId = `${uid}-parent`;
  const bodyId = `${uid}-body`;

  // Previously-used domain tags for the <datalist> autocomplete (DESIGN.md's
  // resolved Open Question 2: free-form text, not a closed enum).
  const knownDomains = useMemo(() => {
    const set = new Set<string>();
    for (const n of graph.nodes) {
      if (n.domain) set.add(n.domain);
    }
    return Array.from(set).sort();
  }, [graph.nodes]);

  // Candidate parents: every node except this one and its own
  // descendants, so a cycle cannot be picked. setParent still throws on
  // one anyway — the UI is UX, not the gate.
  const parentOptions = useMemo(() => {
    const excluded = new Set<string>(nodeId ? [nodeId, ...getDescendants(graph, nodeId)] : []);
    return graph.nodes
      .filter((n) => !excluded.has(n.id))
      .map((n) => ({ id: n.id, title: n.title || "Untitled" }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [graph, nodeId]);

  // Gates the "Title is required" message so it doesn't scold the user the
  // instant a blank new-node form opens, before they've touched anything —
  // shown once they've left the field or tried to save, not on mount.
  const [titleTouched, setTitleTouched] = useState(false);

  const canSave = title.trim().length > 0;
  const hasTitle = title.trim().length > 0;
  const isDirty =
    title !== (existing?.title ?? "") ||
    domain !== (existing?.domain ?? "") ||
    body !== (existing?.body ?? "") ||
    parentId !== (existing?.parentId ?? initialParentId ?? "") ||
    // Typed answers and an unplaced draft are unsaved work too — without
    // these, switching nodes mid-interview discards them with no warning.
    answers.some((a) => a.trim().length > 0) ||
    proposed !== null;

  useImperativeHandle(ref, () => ({ isDirty: () => isDirty }), [isDirty]);

  /** Shared plumbing for both AI calls: guards, status, error mapping. */
  async function callAi<T>(
    url: string,
    payload: unknown,
    status: AiStatus,
  ): Promise<T | null> {
    // Signed out: prompt instead of firing a request the server would
    // reject anyway. While the session is still loading we let it go and
    // handle a 401 below rather than guessing from an unsettled `user`.
    // The server checks auth itself — this is UX, not the gate.
    if (!sessionLoading && !user) {
      setSignInPrompt(true);
      setAiStatus("idle");
      setAiError(null);
      return null;
    }
    if (aiInFlightRef.current) return null;
    aiInFlightRef.current = true;
    setSignInPrompt(false);
    setAiStatus(status);
    setAiError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // 401 means the session lapsed mid-visit — the same discoverable
        // prompt as never having signed in, not a red failure.
        if (res.status === 401) {
          setSignInPrompt(true);
          setAiStatus("idle");
          return null;
        }
        // The route words every failure for a human (quota, cap, kill
        // switch, upstream). Show its message rather than re-deriving one
        // from the status code in a second place.
        setAiError(
          typeof data?.error === "string" ? data.error : "Something went wrong. Try again.",
        );
        setAiStatus("error");
        return null;
      }
      setAiStatus("idle");
      return data as T;
    } catch {
      setAiError("Could not reach Weave. Check your connection and try again.");
      setAiStatus("error");
      return null;
    } finally {
      aiInFlightRef.current = false;
    }
  }

  async function startInterview() {
    const data = await callAi<{ questions: DraftQuestion[] }>(
      "/api/ai/draft-node-questions",
      { title: title.trim(), domain: domain.trim() || undefined },
      "asking",
    );
    if (!data || !Array.isArray(data.questions)) return;
    setQuestions(data.questions);
    setAnswers(data.questions.map(() => ""));
  }

  async function draftFromAnswers() {
    if (!questions) return;
    const payload = {
      title: title.trim(),
      domain: domain.trim() || undefined,
      answers: questions.map((q, i) => ({ question: q.text, answer: answers[i] ?? "" })),
    };
    const data = await callAi<{ text: string }>("/api/ai/draft-node-body", payload, "drafting");
    if (!data || typeof data.text !== "string") return;
    placeDraft(data.text);
  }

  /** Empty Notes takes the draft directly; existing writing is never overwritten. */
  function placeDraft(text: string) {
    if (body.trim().length === 0) {
      setBody(text);
      exitInterview();
    } else {
      setProposed(text);
    }
  }

  /** Zero-AI fallback: keeps the user's typing even when a draft fails. */
  function useAnswersAsNotes() {
    if (!questions) return;
    const written = questions
      .map((q, i) => ({ q: q.text, a: (answers[i] ?? "").trim() }))
      .filter((pair) => pair.a.length > 0)
      .map((pair) => `**${pair.q}**\n\n${pair.a}`)
      .join("\n\n");
    if (!written) return;
    placeDraft(written);
  }

  function exitInterview() {
    setQuestions(null);
    setAnswers([]);
    setAiStatus("idle");
    setAiError(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) {
      setTitleTouched(true);
      return;
    }
    const payload = { title: title.trim(), domain: domain.trim(), body };
    if (nodeId) {
      updateNode(nodeId, payload);
      // Containment is a separate call because updateNode cannot carry it
      // — see GraphContextValue. setParent no-ops when nothing moved.
      setParent(nodeId, parentId || undefined);
    } else {
      // Small random offset, not a fixed {0,0} — several new nodes added
      // back-to-back before any drag would otherwise stack exactly on top
      // of each other (and their connection handles with them).
      // A new child spawns near its parent rather than anywhere on the
      // canvas, so the relationship is visible without hunting for it.
      const parent = parentId ? graph.nodes.find((n) => n.id === parentId) : undefined;
      addNode({
        ...payload,
        ...(parentId ? { parentId } : {}),
        position: parent
          ? { x: parent.position.x + 40 + Math.random() * 40, y: parent.position.y + 140 }
          : { x: Math.random() * 200, y: Math.random() * 200 },
      });
    }
    onClose();
  }

  function handleCancel() {
    // DESIGN.md §7: warn before discarding an unsaved edit — the dirty
    // check the parent uses via the ref above, but Cancel is this
    // component's own button, so it can just check its own local state.
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  function handleDelete() {
    if (!nodeId) return;
    // DESIGN.md §7: destructive, so it confirms — and the confirm NAMES
    // the consequence with a real count rather than asking "are you
    // sure". Children are re-parented rather than deleted, but nobody can
    // be expected to know that from a generic prompt, and with no undo
    // anywhere in the product this prompt is the only place it can say so.
    const childCount = graph.nodes.filter((n) => n.parentId === nodeId).length;
    const grandparent = existing?.parentId
      ? graph.nodes.find((n) => n.id === existing.parentId)
      : undefined;
    const name = title.trim() || "this node";

    let message = `Delete "${name}"? This can't be undone.`;
    if (childCount > 0) {
      const plural = childCount === 1 ? "sub-node moves" : "sub-nodes move";
      const destination = grandparent
        ? `up under "${grandparent.title || "its parent"}"`
        : "up to top level";
      message = `Delete "${name}"? Its ${childCount} ${plural} ${destination}. This can't be undone.`;
    }

    if (!window.confirm(message)) return;
    deleteNode(nodeId);
    onClose();
  }

  const busy = aiStatus === "asking" || aiStatus === "drafting";

  return (
    <form
      onSubmit={handleSubmit}
      // max-w rather than a hard width: 420px overflows a ~375px phone, and
      // this panel is the densest surface in the app now that the interview
      // lives in it (tasks/plan.md Open Question 5).
      className="flex h-full w-full max-w-[420px] flex-col gap-5 overflow-hidden rounded-[8px] p-6"
      style={{
        backgroundColor: "var(--surface-raised, #FFFFFF)",
        boxShadow: "0 1px 3px color-mix(in srgb, var(--ink) 15%, transparent)",
      }}
    >
      <h2 className="text-[15px] font-semibold text-[var(--ink)]">
        {nodeId ? "Edit node" : "New node"}
      </h2>

      <div className="flex flex-col gap-2">
        <label htmlFor={titleId} className="text-sm font-medium text-[var(--ink)]">
          Title
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTitleTouched(true)}
          className="rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] font-semibold text-[var(--ink)]"
        />
        {titleTouched && !canSave && (
          <p className="text-sm text-[var(--danger,#A23B2E)]">Title is required.</p>
        )}

        {/* The assist offer. Inert without a title — there is genuinely
            nothing to ask about yet. Never styled as an error. */}
        {!inInterview && !proposed && (
          <>
            <button
              type="button"
              onClick={startInterview}
              disabled={!hasTitle || busy}
              className="self-start text-left text-[13px] text-[var(--accent)] underline-offset-2 hover:underline disabled:text-[var(--ink-muted)] disabled:no-underline"
            >
              {aiStatus === "asking"
                ? "Thinking of questions…"
                : "Not sure what to write? Answer a few questions"}
            </button>
            {signInPrompt && (
              <p role="status" aria-live="polite" className="text-[12px] text-[var(--ink-muted)]">
                <a href="/login" className="text-[var(--accent)] underline underline-offset-2">
                  Sign in
                </a>{" "}
                to use AI here. You can always write notes yourself.
              </p>
            )}
            {aiStatus === "error" && aiError && (
              <p role="alert" aria-live="polite" className="text-[12px] text-[var(--danger,#A23B2E)]">
                {aiError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={domainId} className="text-sm font-medium text-[var(--ink)]">
          Domain
        </label>
        <input
          id={domainId}
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          list={domainListId}
          className="rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] text-[var(--ink)]"
        />
        <datalist id={domainListId}>
          {knownDomains.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      </div>

      {/* Containment. A native select on purpose: this panel's budget is
          spent on STATES, not rows — it already carries interview mode, a
          proposed-draft block, a sign-in prompt, two AI error paths and an
          in-flight guard. A select adds no async, no loading, no error and
          nothing that interacts with any of those. A combobox or tree
          picker would. */}
      {parentOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <label htmlFor={parentSelectId} className="text-sm font-medium text-[var(--ink)]">
            Part of
          </label>
          <select
            id={parentSelectId}
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] text-[var(--ink)]"
          >
            <option value="">Nothing — top level</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Nesting downward, next to the control for nesting upward. The
          dropdown answers "what is this under"; this answers "what goes
          under this", which is how people actually reach for it after
          reading a node. Only on a saved node: a child cannot point at a
          parent that has no id yet. */}
      {nodeId && onAddChild && (
        <button
          type="button"
          onClick={() => onAddChild(nodeId)}
          className="self-start text-left text-[13px] text-[var(--accent)] underline-offset-2 hover:underline"
        >
          + Add a sub-node under this
        </button>
      )}

      {inInterview ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-[var(--ink)]">
              A few questions
            </span>
            <button
              type="button"
              onClick={exitInterview}
              className="text-[13px] text-[var(--accent)] underline-offset-2 hover:underline"
            >
              Back to writing
            </button>
          </div>
          <p className="text-[12px] text-[var(--ink-muted)]">
            Answer what you like and skip the rest. Short answers are fine.
          </p>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
            {questions.map((q, i) => (
              <QuestionField
                key={i}
                id={`${uid}-q${i}`}
                question={q}
                value={answers[i] ?? ""}
                onChange={(v) =>
                  setAnswers((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  })
                }
              />
            ))}
          </div>

          {aiStatus === "error" && aiError && (
            <p role="alert" aria-live="polite" className="text-[12px] text-[var(--danger,#A23B2E)]">
              {aiError}
            </p>
          )}

          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
            <button
              type="button"
              onClick={draftFromAnswers}
              disabled={busy || !answers.some((a) => a.trim().length > 0)}
              className="w-full rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiStatus === "drafting" ? "Drafting…" : "Draft from my answers"}
            </button>
            {/* Costs nothing and needs no network: whatever the user typed
                is never wasted, even when a draft fails. */}
            <button
              type="button"
              onClick={useAnswersAsNotes}
              disabled={!answers.some((a) => a.trim().length > 0)}
              className="w-full rounded-[6px] border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98] disabled:text-[var(--ink-muted)]"
            >
              Use my answers as notes
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <label htmlFor={bodyId} className="text-sm font-medium text-[var(--ink)]">
            Notes
          </label>
          <textarea
            id={bodyId}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 resize-none rounded-[6px] border border-[var(--line)] bg-transparent px-3 py-2 text-[14px] leading-normal text-[var(--ink)]"
          />

          {/* A draft arriving over existing writing is proposed, never
              applied — the user decides where it goes. */}
          {proposed !== null && (
            <div className="flex flex-col gap-2 rounded-[6px] border border-[var(--line)] p-3">
              <span className="text-sm font-semibold text-[var(--ink)]">Suggested draft</span>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[14px] leading-normal text-[var(--ink)]">
                {proposed}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setBody(proposed);
                    setProposed(null);
                    exitInterview();
                  }}
                  className="rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--surface)]"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBody((b) => `${b.trimEnd()}\n\n${proposed}`);
                    setProposed(null);
                    exitInterview();
                  }}
                  className="rounded-[6px] border border-[var(--line)] px-3 py-1.5 text-sm font-medium text-[var(--ink)]"
                >
                  Append
                </button>
                <button
                  type="button"
                  onClick={() => setProposed(null)}
                  className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
        {nodeId ? (
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm font-medium text-[var(--danger,#A23B2E)] transition-transform active:scale-[0.98]"
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-[6px] border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition-transform active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            type="submit"
            // Disabled mid-interview: "what does Save mean right now?" has
            // no good answer while the Notes field isn't on screen.
            disabled={!canSave || inInterview}
            title={inInterview ? "Finish or leave the questions first" : undefined}
            className="rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
          >
            Save
          </button>
        </div>
      </div>
    </form>
  );
});

export default NodeEditor;
