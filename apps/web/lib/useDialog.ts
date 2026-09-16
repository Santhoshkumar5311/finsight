'use client';
import { useEffect } from 'react';
export function useDialog() {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1);
    if (!dialog) return;
    const selector =
      'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]';
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (e) => e.getClientRects().length,
      );
    focusable()[0]?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = old;
      dialog.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, []);
}
