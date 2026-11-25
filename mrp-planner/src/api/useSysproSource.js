import { useEffect, useRef, useState, useCallback } from 'react';
import { createSourceConnection, initialSourceState } from './sysproConnection.js';

export function useSysproSource(read, source, enabled) {
  const [state, setState] = useState(() => initialSourceState(source));
  const connection = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const current = createSourceConnection({ read, source, onChange: setState });
    connection.current = current;
    void current.refresh();
    const recheck = () => { void current.refresh({ trigger: true }); };
    window.addEventListener('online', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      current.stop(); connection.current = null;
      window.removeEventListener('online', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [read, source, enabled]);
  const refresh = useCallback(() => connection.current?.refresh(), []);
  return [state, refresh];
}
