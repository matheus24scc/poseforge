"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

// A textarea that grows to fit its content, so a prompt is always fully
// visible as it's written (no inner scrollbar, no fixed height). Used
// everywhere a prompt is entered.
interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  /** starting (and minimum) number of rows */
  minRows?: number;
}

export default function AutoTextarea({ value, minRows = 1, className = "", ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Chromium under-reports scrollHeight for border-box textareas at
    // height:auto; a second pass (once a concrete height is set, so scrollHeight
    // reads the true content) converges so the whole prompt is always visible.
    el.style.height = "auto"; // shrink first so deletions also reflow
    el.style.height = `${el.scrollHeight}px`;
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      className={`resize-none overflow-hidden ${className}`}
      {...rest}
    />
  );
}
