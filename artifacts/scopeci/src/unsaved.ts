import { useEffect } from 'react';

/**
 * Edits that leaving the page would throw away. A form registers here while
 * it has unsaved changes: closing or reloading the tab then gets the
 * browser's own question, and a move inside the app (a link, or the app
 * moving on after an action) asks first through App's aroundNav.
 */
const unsaved = new Set<symbol>();

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const key = Symbol('unsaved');
    unsaved.add(key);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      unsaved.delete(key);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
}

/** Whether it's fine to leave: nothing unsaved, or the person says so. */
export function confirmLeave(): boolean {
  return unsaved.size === 0 || window.confirm('Leave this page? Your unsaved changes will be lost.');
}
