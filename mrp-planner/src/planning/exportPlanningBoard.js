import { toBlob } from "html-to-image";
import { getISOWeek } from "./planningBoardUtils";

export async function exportPlanningBoard(node, weekStart) {
  if (!node) throw new Error("The planning board is not ready to export.");
  const { week, year } = getISOWeek(weekStart);
  const blob = await toBlob(node, {
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    width: 1720,
    style: { width: "1720px", maxWidth: "none", margin: "0" },
    cacheBust: true,
  });
  if (!blob) throw new Error("The browser could not create the PNG.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `BM-Production-Plan-CW${week}-${year}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
