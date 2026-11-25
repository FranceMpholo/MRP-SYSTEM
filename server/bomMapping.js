const field = (row, ...names) => {
  const key = Object.keys(row).find((candidate) => names.some((name) => candidate.toLowerCase() === name.toLowerCase()));
  return key === undefined ? undefined : row[key];
};
function quantityState(raw) {
  if (raw === null || raw === undefined) return 'missing';
  if (typeof raw === 'string' && !raw.trim()) return 'blank';
  if (!['number', 'string'].includes(typeof raw) || !Number.isFinite(Number(raw))) return 'invalid';
  return Number(raw) === 0 ? 'zero' : Number(raw) < 0 ? 'negative' : 'positive';
}
const text = (row, ...names) => String(field(row, ...names) ?? '').trim();
function mapBomRow(row) {
  const raw = field(row, 'QtyPer');
  const qtyPerState = quantityState(raw);
  const parentUom = text(row, 'ParentUom');
  const componentUom = text(row, 'ComponentUom');
  return {
    parentStockCode: text(row, 'ParentPart', 'ParentStockCode'),
    parentDescription: text(row, 'ParentDescription'), parentUom,
    componentStockCode: text(row, 'Component', 'ComponentStockCode'),
    componentDescription: text(row, 'ComponentDescription'), componentUom,
    qtyPer: ['zero', 'positive', 'negative'].includes(qtyPerState) ? Number(raw) : null,
    qtyPerRaw: raw ?? null, qtyPerState,
    route: text(row, 'Route'), sequence: text(row, 'SequenceNum'),
    version: text(row, 'Version'), release: text(row, 'Release'),
    componentVersion: text(row, 'ComVersion'), componentRelease: text(row, 'ComRelease'),
    structureOnDate: field(row, 'StructureOnDate') ?? null,
    structureOffDate: field(row, 'StructureOffDate') ?? null,
    uomFlag: text(row, 'UomFlag'), qtyPerEntered: field(row, 'QtyPerEnt') ?? null,
    fixedQtyPerFlag: text(row, 'FixedQtyPerFlag'), fixedQtyPer: field(row, 'FixedQtyPer') ?? null,
    // SYSPRO BOMSST documents QtyPer as stocking quantities, unlike QtyPerEnt.
    // Expose that basis explicitly; never apply another inferred conversion.
    qtyPerBasis: 'stocking', factorUnitsVerified: Boolean(parentUom && componentUom),
    parentReferenceExists: Boolean(text(row, 'ParentMasterCode')),
    componentReferenceExists: Boolean(text(row, 'ComponentMasterCode')),
  };
}
module.exports = { mapBomRow, quantityState };
