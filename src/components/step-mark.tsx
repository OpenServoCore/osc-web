import { Check, Minus, Pause, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { markOf, stateText, unitText, type FeedStep, type StepMark as Mark } from "@/lib/run-feed";
import { stepTitle } from "@/lib/run-folder";

const R = 8;
const C = 2 * Math.PI * R;

const RING: Readonly<Record<Mark, string>> = {
  accepted: "stroke-success",
  failed: "stroke-danger",
  interrupted: "stroke-warning",
  running: "stroke-accent",
  waiting: "stroke-border-strong",
  "not run": "stroke-border-strong",
};

const ICON: Readonly<Record<Mark, string>> = {
  accepted: "text-success",
  failed: "text-danger",
  interrupted: "text-warning",
  running: "text-accent",
  waiting: "text-text-3",
  "not run": "text-text-3",
};

/** A step's state in words, as its mark's name and tooltip carry it: its tries and moves too. */
export function markLabel(step: FeedStep, over: boolean): string {
  const unit = unitText(step, over);
  return `${stepTitle(step.name)}: ${stateText(step, over)}${unit === undefined ? "" : `, ${unit}`}`;
}

/**
 * A step's ring and icon: its share done as a ring, a check once accepted, a cross once refused
 * or aborted, a pause mark once interrupted or cut off, a turning ring while it runs, a dim
 * circle while it waits, a dash where it did not run. The words are its name and its tooltip.
 */
export function StepMark({ step, over }: { step: FeedStep; over: boolean }) {
  const mark = markOf(step, over);
  const label = markLabel(step, over);
  const percent = Math.round(100 * step.fraction);
  const ring = mark !== "waiting" && mark !== "not run";
  const progress = mark === "running";
  const icon = "absolute inset-0 m-auto size-3";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          data-mark={mark}
          role={progress ? "progressbar" : "img"}
          aria-label={label}
          {...(progress
            ? { "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent }
            : {})}
          className="relative inline-flex size-5 shrink-0 rounded-full outline-offset-2"
        >
          <svg viewBox="0 0 20 20" className="size-5 -rotate-90" aria-hidden>
            <circle
              cx="10"
              cy="10"
              r={R}
              fill="none"
              strokeWidth="2"
              className={ring ? "stroke-border" : `${RING[mark]} opacity-50`}
              strokeDasharray={mark === "not run" ? "0" : undefined}
            />
            {ring && (
              <circle
                cx="10"
                cy="10"
                r={R}
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - step.fraction)}
                className={`${RING[mark]} transition-[stroke-dashoffset]`}
              />
            )}
          </svg>
          {progress && (
            <svg
              viewBox="0 0 20 20"
              className="absolute inset-0 size-5 animate-spin [animation-duration:1.6s]"
              aria-hidden
            >
              <circle
                cx="10"
                cy="10"
                r={4}
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${String(2 * Math.PI * 4 * 0.3)} ${String(2 * Math.PI * 4)}`}
                className="stroke-accent/70"
              />
            </svg>
          )}
          {mark === "accepted" && (
            <Check aria-hidden className={`${icon} ${ICON[mark]}`} strokeWidth={3} />
          )}
          {mark === "failed" && (
            <X aria-hidden className={`${icon} ${ICON[mark]}`} strokeWidth={3} />
          )}
          {mark === "interrupted" && (
            <Pause aria-hidden className={`${icon} ${ICON[mark]}`} strokeWidth={3} />
          )}
          {mark === "not run" && (
            <Minus aria-hidden className={`${icon} ${ICON[mark]}`} strokeWidth={3} />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
