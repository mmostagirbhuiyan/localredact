import { useState, useCallback } from 'react';

interface UndoAction {
  /** Entity ID -> previous accepted state */
  changes: Map<string, boolean>;
}

const MAX_STACK_SIZE = 50;

export function useUndoRedo() {
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  /** Record entity state before a toggle action. Call before setEntities. */
  const recordAction = useCallback((changes: Map<string, boolean>) => {
    if (changes.size === 0) return;
    setUndoStack((prev) => {
      const next = [...prev, { changes }];
      if (next.length > MAX_STACK_SIZE) next.shift();
      return next;
    });
    // Any new action clears the redo stack
    setRedoStack([]);
  }, []);

  /** Apply undo: returns the entity ID -> accepted state to restore, or null if nothing to undo */
  const undo = useCallback((): Map<string, boolean> | null => {
    let action: UndoAction | undefined;
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      action = next.pop();
      return next;
    });
    if (!action) return null;
    return action.changes;
  }, []);

  /** Push an action onto the redo stack (called by the consumer after applying undo) */
  const pushRedo = useCallback((changes: Map<string, boolean>) => {
    setRedoStack((prev) => {
      const next = [...prev, { changes }];
      if (next.length > MAX_STACK_SIZE) next.shift();
      return next;
    });
  }, []);

  /** Apply redo: returns the entity ID -> accepted state to restore, or null if nothing to redo */
  const redo = useCallback((): Map<string, boolean> | null => {
    let action: UndoAction | undefined;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      action = next.pop();
      return next;
    });
    if (!action) return null;
    return action.changes;
  }, []);

  /** Push an action onto the undo stack without clearing redo (used during redo apply) */
  const pushUndo = useCallback((changes: Map<string, boolean>) => {
    setUndoStack((prev) => {
      const next = [...prev, { changes }];
      if (next.length > MAX_STACK_SIZE) next.shift();
      return next;
    });
  }, []);

  /** Clear both stacks (e.g., on state transition) */
  const clear = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    recordAction,
    undo,
    redo,
    pushRedo,
    pushUndo,
    clear,
  };
}
