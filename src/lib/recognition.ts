// The team's Recognition Table on the phone: categories, grades, labels, brands, marks and learned
// spellings, kept for offline use.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listCategories, listSpellings, listTerms } from './api';
import { cached, learnSpelling, pendingSpellings } from './offline';
import { buildDictionary, spellingKey, type Dictionary } from './recognize';
import type { Category, Term } from './types';

export type RecognitionData = { categories: Category[]; terms: Term[]; spellings: [string, string][] };

const EMPTY: RecognitionData = { categories: [], terms: [], spellings: [] };

async function fetchRecognition(): Promise<RecognitionData> {
  const [categories, terms, spellings] = await Promise.all([listCategories(), listTerms(), listSpellings()]);
  return { categories, terms, spellings: spellings.map((s) => [s.spelling, s.product_id]) };
}

/** Loads the lists (from the server, or the copy on this phone when offline). */
export function useRecognition() {
  const [data, setData] = useState<RecognitionData>(EMPTY);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<[string, string][]>([]);

  const reload = useCallback(async () => {
    try {
      const r = await cached('recognition', fetchRecognition);
      setData(r.value);
      setFromCache(r.fromCache);
      setError(null);
      setLocal((await pendingSpellings()).map((s) => [s.spelling, s.product_id]));
      return r.value;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([cached('recognition', fetchRecognition), pendingSpellings()])
      .then(([r, pending]) => {
        if (!alive) return;
        setData(r.value);
        setFromCache(r.fromCache);
        setLocal(pending.map((s) => [s.spelling, s.product_id]));
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const dict: Dictionary = useMemo(() => buildDictionary(data.categories, data.terms), [data]);
  const learned = useMemo(() => new Map([...data.spellings, ...local]), [data.spellings, local]);

  /** After someone picks an item for a text, remember it (on this phone at once). */
  const learn = useCallback((text: string, productId: string) => {
    const key = spellingKey(text);
    if (key.length < 2 || key.length > 200) return;
    setLocal((l) => [...l.filter(([k]) => k !== key), [key, productId]]);
    learnSpelling(key, productId).catch(() => {});
  }, []);

  return { data, dict, learned, learn, reload, fromCache, error };
}
