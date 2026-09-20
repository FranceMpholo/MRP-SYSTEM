import { SHIFT_CONFIG, defaultOeeSettings as legacyDefaultOeeSettings } from '../planning/shiftConfig.js';

export const IDEAL_OEE_DEFAULT = 0.75;

export const defaultLossCategories = () => [
  {
    id: 'planned-loss',
    name: 'Planned Loss',
    semanticKey: 'PLANNED_LOSS',
    lossType: 'PLANNED_LOSS',
    description: 'Planned production loss or scheduled allowance.',
    active: true,
    sortOrder: 10,
  },
  {
    id: 'downtime',
    name: 'Downtime',
    semanticKey: 'DOWNTIME',
    lossType: 'DOWNTIME',
    description: 'Unplanned downtime or stoppage.',
    active: true,
    sortOrder: 20,
  },
];

export const defaultSpecialRules = () => ({
  STANDARD_NICT: true,
  CE_AGGREGATED: false,
  THERMO_ASSEMBLY_LINKED: false,
});

export const defaultOeeGeneralSettings = () => ({
  idealOee: IDEAL_OEE_DEFAULT,
});

export const defaultOeeMasterData = () => ({
  general: defaultOeeGeneralSettings(),
  cycleTimes: [],
  lossCategories: defaultLossCategories(),
  specialRules: defaultSpecialRules(),
});

export function normalizeLegacyShiftRules(raw = {}) {
  const defaults = legacyDefaultOeeSettings();
  const merged = {};
  for (const [line, lineSettings] of Object.entries(defaults)) {
    merged[line] = {};
    const legacyLine = raw?.[line] ?? lineSettings;
    for (const shift of Object.keys(SHIFT_CONFIG)) {
      const config = legacyLine?.[shift] ?? SHIFT_CONFIG[shift];
      merged[line][shift] = {
        ...SHIFT_CONFIG[shift],
        ...config,
        plannedTimeMinutes: config?.plannedTimeMinutes ?? (config?.start && config?.end ? Math.max(0, Number(config.plannedTimeMinutes ?? 0)) : undefined),
      };
    }
  }
  return merged;
}

export function buildOeeSettingsFoundation(rawSettings = {}) {
  const legacyDefaults = legacyDefaultOeeSettings();
  const source = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const merged = {
    ...source,
    general: { ...defaultOeeGeneralSettings(), ...(source.general ?? {}) },
    cycleTimes: Array.isArray(source.cycleTimes) ? source.cycleTimes : [],
    lossCategories: Array.isArray(source.lossCategories) && source.lossCategories.length ? source.lossCategories : defaultLossCategories(),
    specialRules: { ...defaultSpecialRules(), ...(source.specialRules ?? {}) },
  };

  for (const line of Object.keys(legacyDefaults)) {
    const legacy = source[line] ?? legacyDefaults[line];
    merged[line] = Object.fromEntries(Object.keys(SHIFT_CONFIG).map((shift) => {
      const config = legacy?.[shift] ?? SHIFT_CONFIG[shift];
      return [shift, { ...SHIFT_CONFIG[shift], ...config, plannedTimeMinutes: config?.plannedTimeMinutes ?? undefined }];
    }));
  }

  return merged;
}

export function getOeeShiftRules(settings, productionLine) {
  const defaults = legacyDefaultOeeSettings();
  return settings?.[productionLine] ?? defaults[productionLine] ?? {};
}

export function createLossCategory(overrides = {}) {
  const base = defaultLossCategories()[0];
  return {
    ...base,
    ...overrides,
    id: overrides.id ?? base.id,
    name: overrides.name ?? base.name,
    semanticKey: overrides.semanticKey ?? base.semanticKey ?? null,
    lossType: overrides.lossType ?? base.lossType,
    active: overrides.active ?? base.active,
    sortOrder: overrides.sortOrder ?? base.sortOrder,
  };
}

export function createLossEvent(overrides = {}) {
  return {
    id: overrides.id ?? `loss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    oeeRunId: overrides.oeeRunId ?? null,
    planningEntryId: overrides.planningEntryId ?? null,
    categoryId: overrides.categoryId ?? null,
    categoryName: overrides.categoryName ?? '',
    semanticKey: overrides.semanticKey ?? null,
    lossType: overrides.lossType ?? '',
    durationMinutes: overrides.durationMinutes ?? 0,
    comment: overrides.comment ?? '',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    createdBy: overrides.createdBy ?? null,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    updatedBy: overrides.updatedBy ?? null,
  };
}

export function createDefaultOeeRecord(overrides = {}) {
  return {
    planningEntryId: overrides.planningEntryId ?? null,
    date: overrides.date ?? '',
    productionLine: overrides.productionLine ?? 'blowMoulding',
    machine: overrides.machine ?? '',
    shift: overrides.shift ?? 'SHIFT 01',
    process: overrides.process ?? '',
    product: overrides.product ?? '',
    variant: overrides.variant ?? '',
    suffix: overrides.suffix ?? '',
    plan: overrides.plan ?? null,
    effectivePlan: overrides.effectivePlan ?? null,
    plannedTime: overrides.plannedTime ?? null,
    plannedBreaks: overrides.plannedBreaks ?? null,
    totalDowntime: overrides.totalDowntime ?? null,
    runTime: overrides.runTime ?? null,
    nict: overrides.nict ?? null,
    revisedPlan: overrides.revisedPlan ?? null,
    target: overrides.target ?? null,
    totalProduced: overrides.totalProduced ?? null,
    goodParts: overrides.goodParts ?? null,
    scrapParts: overrides.scrapParts ?? null,
    availability: overrides.availability ?? null,
    performance: overrides.performance ?? null,
    productivity: overrides.productivity ?? null,
    quality: overrides.quality ?? null,
    externalOee: overrides.externalOee ?? null,
    internalOee: overrides.internalOee ?? null,
    status: overrides.status ?? 'pending',
    lossEvents: Array.isArray(overrides.lossEvents) ? overrides.lossEvents : [],
    configurationSnapshot: overrides.configurationSnapshot ?? {},
    audit: overrides.audit ?? {
      createdAt: new Date().toISOString(),
      createdBy: null,
      updatedAt: new Date().toISOString(),
      updatedBy: null,
    },
  };
}

export function normalizeLegacyActualOee(actual = {}) {
  const base = actual && typeof actual === 'object' ? actual : {};
  const legacyOee = base.oee && typeof base.oee === 'object' ? base.oee : {};
  return {
    ...base,
    oee: {
      runTime: legacyOee.runTime ?? null,
      noTubs: legacyOee.noTubs ?? null,
      goodParts: legacyOee.goodParts ?? null,
      plannedTime: legacyOee.plannedTime ?? null,
      plannedBreaks: legacyOee.plannedBreaks ?? null,
      ...legacyOee,
    },
  };
}
