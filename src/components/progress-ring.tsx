const R = 8;
const C = 2 * Math.PI * R;

/** A circular Progress for a table cell, 0 to 100. */
export function ProgressRing({ value, label }: { value: number; label: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-5 -rotate-90"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <circle cx="10" cy="10" r={R} fill="none" strokeWidth="2.5" className="stroke-primary/20" />
      <circle
        cx="10"
        cy="10"
        r={R}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - value / 100)}
        className="stroke-primary transition-[stroke-dashoffset]"
      />
    </svg>
  );
}
