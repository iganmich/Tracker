import { useEffect, useState } from "react";

export function usePersistentState<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (validate(parsed)) setValue(parsed);
      }
    } catch {
      /* ignore unreadable storage */
    }
    setHydrated(true);
  }, [key, validate]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / disabled */
    }
  }, [key, value, hydrated]);

  return [value, setValue];
}
