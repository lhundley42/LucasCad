"use client";

import { useRef, useState, type FocusEventHandler, type InputHTMLAttributes, type KeyboardEventHandler } from "react";

type BufferedNumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue" | "onChange"> & {
  value: number;
  onValidValue: (value: number) => void;
  selectOnFocus?: boolean;
};

const displayNumber = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(8))) : "";
const numericLimit = (value: string | number | undefined) => value === undefined ? undefined : Number(value);
export const keyboardEventOwnedByControl = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.("input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='spinbutton']"));

export function BufferedNumberInput({ value, onValidValue, selectOnFocus = true, min, max, onFocus, onBlur, onKeyDown, ...props }: BufferedNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelOnBlur = useRef(false);
  const minimum = numericLimit(min); const maximum = numericLimit(max);
  const liveValue = draft ?? displayNumber(value);

  const applyCandidate = (raw: string, final: boolean) => {
    const trimmed = raw.trim();
    if (!trimmed) { if (final) setDraft(null); return; }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) { if (final) setDraft(null); return; }
    const inRange = (minimum === undefined || parsed >= minimum) && (maximum === undefined || parsed <= maximum);
    if (inRange) onValidValue(parsed);
    else if (final) onValidValue(Math.max(minimum ?? -Infinity, Math.min(maximum ?? Infinity, parsed)));
    if (final) setDraft(null);
  };

  const handleFocus: FocusEventHandler<HTMLInputElement> = (event) => {
    cancelOnBlur.current = false;
    setDraft(displayNumber(value));
    if (selectOnFocus) event.currentTarget.select();
    onFocus?.(event);
  };
  const handleBlur: FocusEventHandler<HTMLInputElement> = (event) => {
    if (cancelOnBlur.current) { cancelOnBlur.current = false; setDraft(null); }
    else applyCandidate(event.currentTarget.value, true);
    onBlur?.(event);
  };
  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") { event.preventDefault(); cancelOnBlur.current = true; setDraft(null); event.currentTarget.blur(); }
    onKeyDown?.(event);
  };

  return <input {...props} type="number" min={min} max={max} value={liveValue} onFocus={handleFocus} onBlur={handleBlur} onKeyDown={handleKeyDown} onChange={(event) => { const raw = event.target.value; setDraft(raw); applyCandidate(raw, false); }} />;
}
