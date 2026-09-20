const snapshotLossEvent = (event = {}) => ({
  categoryId: event.categoryId ?? null,
  categoryName: event.categoryName ?? event.semanticKey ?? 'Historical category',
  semanticKey: event.semanticKey ?? null,
  lossType: event.lossType ?? '',
  durationMinutes: event.durationMinutes ?? null,
  comment: event.comment ?? '',
});

const snapshotConfiguration = (result = {}) => ({
  nictSeconds: result.nictSeconds ?? null,
  nictSource: result.nictSource ?? null,
  nictFormingSeconds: result.configurationSnapshot?.nictFormingSeconds ?? null,
  nictRobotSeconds: result.configurationSnapshot?.nictRobotSeconds ?? null,
  cycleTimeMinutes: result.cycleTimeMinutes ?? null,
  jpd: result.configurationSnapshot?.jpd ?? null,
  idealOee: result.idealOee ?? null,
  shiftStart: result.configurationSnapshot?.shiftStart ?? null,
  shiftEnd: result.configurationSnapshot?.shiftEnd ?? null,
  plannedTimeMinutes: result.plannedTimeMinutes ?? null,
  plannedBreakSource: result.configurationSnapshot?.plannedBreakSource ?? null,
  strategy: result.strategy ?? null,
  calculationVersion: result.configurationSnapshot?.calculationVersion ?? 'excel-style-v1',
});

export function createOeeHistorySnapshot(result, { originalPlan = null, effectivePlan = null, completedByUserId = null, completedAt = new Date().toISOString(), createdAt = completedAt, updatedAt = completedAt, updatedByUserId = completedByUserId, revision = 1, id = null } = {}) {
  if (!result || result.status !== 'COMPLETE') return null;
  const completedId = id ?? `oee_history_${result.planningEntryId}_${revision}`;
  return {
    id: completedId,
    planningEntryId: result.planningEntryId ?? null,
    revision,
    date: result.date ?? null,
    productionLine: result.productionLine ?? null,
    machine: result.machine ?? null,
    shift: result.shift ?? null,
    process: result.process ?? null,
    product: result.stockCode ?? result.product ?? null,
    variant: result.variant ?? null,
    suffix: result.suffix ?? null,
    originalPlan,
    effectivePlan,
    revisedPlanQty: result.revisedPlanQty ?? null,
    targetQty: result.targetQty ?? null,
    totalProduced: result.totalProduced ?? null,
    goodParts: result.goodParts ?? null,
    scrapParts: result.scrapParts ?? null,
    plannedTimeMinutes: result.plannedTimeMinutes ?? null,
    plannedBreakMinutes: result.plannedBreakMinutes ?? null,
    totalDowntimeMinutes: result.totalDowntimeMinutes ?? null,
    runTimeMinutes: result.runTimeMinutes ?? null,
    noTubsNoStillagesMinutes: result.noTubsNoStillagesMinutes ?? null,
    availability: result.availability ?? null,
    performance: result.performance ?? null,
    productivity: result.productivity ?? null,
    quality: result.quality ?? null,
    internalOee: result.internalOee ?? null,
    externalOee: result.externalOee ?? null,
    idealOee: result.idealOee ?? null,
    status: 'COMPLETE',
    lossEventsSnapshot: (result.lossEvents ?? []).map(snapshotLossEvent),
    configurationSnapshot: snapshotConfiguration(result),
    calculationVersion: result.configurationSnapshot?.calculationVersion ?? 'excel-style-v1',
    completedAt,
    completedByUserId,
    createdAt,
    updatedAt,
    updatedByUserId,
  };
}

const captureSignature = (snapshot) => JSON.stringify({
  planningEntryId: snapshot.planningEntryId,
  originalPlan: snapshot.originalPlan,
  effectivePlan: snapshot.effectivePlan,
  revisedPlanQty: snapshot.revisedPlanQty,
  targetQty: snapshot.targetQty,
  totalProduced: snapshot.totalProduced,
  goodParts: snapshot.goodParts,
  scrapParts: snapshot.scrapParts,
  plannedTimeMinutes: snapshot.plannedTimeMinutes,
  plannedBreakMinutes: snapshot.plannedBreakMinutes,
  totalDowntimeMinutes: snapshot.totalDowntimeMinutes,
  runTimeMinutes: snapshot.runTimeMinutes,
  noTubsNoStillagesMinutes: snapshot.noTubsNoStillagesMinutes,
  lossEventsSnapshot: snapshot.lossEventsSnapshot,
  configurationSnapshot: snapshot.configurationSnapshot,
});

export function finalizeOeeHistory(history = [], result, context = {}) {
  const latest = history.filter((snapshot) => snapshot.planningEntryId === result?.planningEntryId).sort((a, b) => b.revision - a.revision)[0];
  const candidate = createOeeHistorySnapshot(result, { ...context, revision: (latest?.revision ?? 0) + 1 });
  if (!candidate) return { history, snapshot: null, created: false };
  if (latest && captureSignature(latest) === captureSignature(candidate)) return { history, snapshot: latest, created: false };
  return { history: [...history, candidate], snapshot: candidate, created: true };
}

export function latestOeeHistory(history = []) {
  const latest = new Map();
  history.forEach((snapshot) => {
    const current = latest.get(snapshot.planningEntryId);
    if (!current || snapshot.revision > current.revision) latest.set(snapshot.planningEntryId, snapshot);
  });
  return [...latest.values()];
}

export function filterOeeHistory(history = [], filters = {}) {
  const product = String(filters.product ?? '').trim().toLowerCase();
  return history.filter((snapshot) => (!filters.startDate || snapshot.date >= filters.startDate)
    && (!filters.endDate || snapshot.date <= filters.endDate)
    && (!filters.productionLine || snapshot.productionLine === filters.productionLine)
    && (!filters.machine || snapshot.machine === filters.machine)
    && (!filters.shift || snapshot.shift === filters.shift)
    && (!filters.process || snapshot.process === filters.process)
    && (!filters.suffix || snapshot.suffix === filters.suffix)
    && (!filters.status || snapshot.status === filters.status)
    && (!product || [snapshot.product, snapshot.stockCode].some((value) => String(value ?? '').toLowerCase().includes(product))));
}
