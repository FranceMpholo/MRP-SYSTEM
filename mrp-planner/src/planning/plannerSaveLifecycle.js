/** Serializes saves within one mounted planner; it does not coordinate tabs. */
export function createPlannerSaveLifecycle({ getSnapshot, write, onSaveState }) {
  let inFlight = null;
  let preparingImport = false;
  let savedData = null;

  function saveLatest() {
    if (inFlight) return preparingImport ? inFlight.then(() => saveLatest()) : inFlight;

    // Start in a microtask so concurrent callers share the same promise even
    // when loading is blocked or the current snapshot is already saved.
    const operation = Promise.resolve().then(async () => {
      while (true) {
        const { loaded, data } = getSnapshot();
        if (!loaded || data === savedData) return;

        onSaveState("saving");
        try {
          await write(data);
        } catch (error) {
          onSaveState("error");
          throw error;
        }
        savedData = data;

        // An older autosave may have been in progress when logout was clicked.
        // Finish it before saving any newer committed in-memory snapshot.
        if (getSnapshot().data === data) {
          onSaveState("saved");
          return;
        }
      }
    }).finally(() => { if (inFlight === operation) { inFlight = null; preparingImport = false; } });
    inFlight = operation;
    return inFlight;
  }

  // Persist an import before exposing its entries in the planner. It shares the
  // autosave queue, so an older write cannot overwrite the imported snapshot.
  function savePrepared({ prepare, commit }) {
    const previous = inFlight;
    const operation = Promise.resolve(previous).catch(() => {}).then(async () => {
      const snapshot = getSnapshot();
      if (!snapshot.loaded) throw new Error('Planner data must finish loading before import.');
      const prepared = prepare(snapshot.data);
      onSaveState('saving');
      try {
        await write(prepared.data);
      } catch (error) {
        onSaveState('error');
        throw error;
      }
      commit(prepared);
      // React can commit another queued edit alongside the import. Only mark
      // that combined snapshot saved if it matches what actually reached storage.
      const committed = getSnapshot().data;
      const matchesSaved = committed === prepared.data || JSON.stringify(committed) === JSON.stringify(prepared.data);
      savedData = matchesSaved ? committed : prepared.data;
      onSaveState(matchesSaved ? 'saved' : 'saving');
      return prepared.result;
    }).finally(() => { if (inFlight === operation) { inFlight = null; preparingImport = false; } });
    preparingImport = true;
    inFlight = operation;
    return operation;
  }

  return { saveLatest, savePrepared };
}
