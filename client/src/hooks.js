import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Load a GET endpoint with loading/error state and a reload() function.
// Pass path=null to skip fetching.
export function useFetch(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    if (!path) return;
    setLoading(true);
    setError(null);
    api
      .get(path)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
