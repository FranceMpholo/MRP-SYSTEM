const number = (value) => Number(value) || 0;

const dateLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const weekLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Current week";
  return `Week of ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
};

const itemDetails = (item) => ({
  itemId: item.id,
  stockCode: item.code || "—",
  description: item.description || "No description",
  itemType: item.type || "—",
  uom: item.uom || "",
});

/**
 * Converts existing MRP output into dashboard-ready view data.
 * This selector deliberately does not calculate MRP, write state, or mutate inputs.
 */
export function deriveDashboardData({ items = [], mrp = {}, weeks = [], monday }) {
  const currentWeek = weeks[0] || monday || null;
  const actions = [];
  const watch = [];
  const planWeeks = weeks.map((week, index) => ({
    index,
    date: week,
    label: weekLabel(week),
    gr: 0,
    sr: 0,
    porcpt: 0,
    porel: 0,
  }));

  items.forEach((item) => {
    const result = mrp[item.id];
    if (!result) return;

    const details = itemDetails(item);
    const pastDueRelease = number(result.pastDueRelease);
    const pastDueDemand = number(result.pastDueDemand);
    const currentRelease = number(result.PORel?.[0]);

    if (pastDueRelease > 0) {
      actions.push({
        ...details,
        priority: 0,
        kind: "past-due-release",
        action: "Past-due release",
        quantity: pastDueRelease,
        relevantWeek: "Past due",
      });
    }

    if (pastDueDemand > 0) {
      actions.push({
        ...details,
        priority: 1,
        kind: "past-due-demand",
        action: "Past-due demand",
        quantity: pastDueDemand,
        relevantWeek: "Past due",
      });
    }

    if (currentRelease > 0) {
      actions.push({
        ...details,
        priority: 2,
        kind: "release-this-week",
        action: "Release this week",
        quantity: currentRelease,
        relevantWeek: weekLabel(currentWeek),
      });
    }

    (result.PORel || []).forEach((quantity, index) => {
      const qty = number(quantity);
      if (index > 0 && qty > 0) {
        watch.push({
          ...details,
          kind: "upcoming-release",
          action: "Upcoming release",
          quantity: qty,
          relevantWeek: weekLabel(weeks[index]),
          weekIndex: index,
        });
      }
    });

    const safetyStock = number(item.safetyStock);
    if (safetyStock > 0) {
      const riskWeek = (result.POH || []).findIndex((poh) => number(poh) <= safetyStock);
      if (riskWeek >= 0) {
        watch.push({
          ...details,
          kind: "stock-risk",
          action: "Stock risk",
          quantity: number(result.POH?.[riskWeek]),
          relevantWeek: weekLabel(weeks[riskWeek]),
          weekIndex: riskWeek,
          safetyStock,
        });
      }
    }

    planWeeks.forEach((week, index) => {
      week.gr += number(result.GR?.[index]);
      week.sr += number(result.SR?.[index]);
      week.porcpt += number(result.PORcpt?.[index]);
      week.porel += number(result.PORel?.[index]);
    });
  });

  actions.sort((a, b) => a.priority - b.priority || b.quantity - a.quantity || a.stockCode.localeCompare(b.stockCode));
  watch.sort((a, b) => a.weekIndex - b.weekIndex || a.stockCode.localeCompare(b.stockCode));

  const countByKind = (kind) => actions.filter((action) => action.kind === kind).length;

  return {
    header: {
      currentPlanningWeek: weekLabel(currentWeek),
      horizonStart: dateLabel(weeks[0] || monday),
      horizonEnd: dateLabel(weeks[weeks.length - 1] || monday),
      numberOfWeeks: weeks.length,
      planStatus: actions.length ? "Action required" : "Plan ready",
    },
    kpis: {
      totalItems: items.length,
      pastDueReleases: countByKind("past-due-release"),
      pastDueDemand: countByKind("past-due-demand"),
      releasesThisWeek: countByKind("release-this-week"),
    },
    actions,
    watch,
    planWeeks,
  };
}

export default deriveDashboardData;
