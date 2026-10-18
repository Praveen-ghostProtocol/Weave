"use client";

// Empty-state content only — the dot-grid canvas it sits on lives on the
// page itself (DESIGN.md §5: reuse the real canvas, no bespoke "no data"
// graphic, no illustration).
interface EmptyStateProps {
  onAddFirstNode: () => void;
}

export default function EmptyState({ onAddFirstNode }: EmptyStateProps) {
  return (
    <div className="flex max-w-xs flex-col items-center gap-4 text-center">
      <div className="flex flex-col gap-2">
        <p className="text-[22px] font-semibold leading-snug text-[var(--ink)]">
          Start mapping who you are.
        </p>
        <p className="text-sm leading-normal text-[var(--ink-muted)]">
          One node per part of your life — work, people, projects. Link them
          as you go.
        </p>
      </div>
      <button
        type="button"
        onClick={onAddFirstNode}
        className="rounded-[6px] bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--surface)] transition-transform active:scale-[0.98]"
      >
        Add your first node
      </button>
    </div>
  );
}
