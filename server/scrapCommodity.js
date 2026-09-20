const RULES = [
  ['1645', 'Side Step'], ['12606', 'Thermoforming'],
  ['13036', 'Thermoforming'], ['29140', 'Box Rail'], ['17775', 'RSB'],
];
function classifyParents(parents = []) {
  const annotated = parents.map(parent => ({ ...parent, commodities: [...new Set(RULES.filter(([pattern]) => parent.parentPart.includes(pattern)).map(([, label]) => label))] }));
  const candidates = [...new Set(annotated.flatMap(parent => parent.commodities))].sort();
  const unclassifiedParentCount = new Set(annotated.filter(parent => !parent.commodities.length).map(parent => parent.parentPart)).size;
  const mappingStatus = candidates.length > 1 ? 'Ambiguous' : !candidates.length ? 'Unmapped' : unclassifiedParentCount ? 'Incomplete Coverage' : 'Mapped';
  return { commodity: candidates.length > 1 ? 'Ambiguous' : candidates[0] || 'Unmapped', mappingStatus,
    candidateCommodities: candidates, unclassifiedParentCount, parents: annotated };
}
function mapCommodities(rows, links) {
  const grouped = new Map();
  for (const link of links) {
    const code = link.stockCode.trim();
    if (!grouped.has(code)) grouped.set(code, []);
    grouped.get(code).push({ parentPart: link.parentPart.trim(), description: link.description?.trim() || '', route: link.route?.trim() || '', qtyPer: link.qtyPer });
  }
  const mappings = Object.fromEntries([...new Set(rows.map(row => row.stockCode))].map(code => [code, classifyParents(grouped.get(code))]));
  return { mappings, data: rows.map(row => ({ ...row, commodity: mappings[row.stockCode].commodity, mappingStatus: mappings[row.stockCode].mappingStatus })) };
}
module.exports = { classifyParents, mapCommodities };
