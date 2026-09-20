import { jsPDF } from "jspdf";

const columns = [
  ["Stock Code", 23, "stockCode"], ["Description", 59, "description"], ["UOM", 14, "uom"],
  ["Production\nShortfall", 23, "productionShortfall"], ["Pack Size", 20, "packSize"],
  ["Packs\nRequired", 21, "packsRequired"], ["Store Request\nQty", 25, "storeRequestQty"],
  ["B-RAW01 SOH", 27, "bRaw01Soh"], ["Qty Issued", 27, "qtyIssued"], ["Comments", 42, "comments"],
];
const numeric = new Set(["productionShortfall", "packSize", "packsRequired", "storeRequestQty", "bRaw01Soh", "qtyIssued"]);
const blankByDefault = new Set(["qtyIssued", "comments"]);
const fmt = (value) => (Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100).toLocaleString("en-ZA", { maximumFractionDigits: 2 });
const safeName = (value) => String(value || "store-request").replace(/[^a-z0-9_-]+/gi, "-");

async function imageDataUrl(url) {
  const response = await fetch(url); const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
}

export async function exportStoreRequestPdf({ storeRequests, planningWeek, productionLineName = "Blow Moulding", logoUrl, logoDataUrl }) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const logo = logoDataUrl || await imageDataUrl(logoUrl);
  const margin = 8, pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
  const tableTop = 51, tableBottom = 153;
  let y = tableTop;

  function drawPageHeader() {
    pdf.addImage(logo, "PNG", margin, 12, 48, 24, undefined, "FAST");
    pdf.setTextColor(8, 55, 119); pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
    pdf.text("Shopping List For The Side Step", pageWidth / 2, 20, { align: "center" });
    pdf.setTextColor(20, 25, 32); pdf.setFont("helvetica", "normal"); pdf.setFontSize(15);
    pdf.text(productionLineName, pageWidth / 2, 29, { align: "center" });
    pdf.setTextColor(8, 55, 119); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
    pdf.text("Store Request — B-RAW01", pageWidth - margin, 17, { align: "right" });
    pdf.setTextColor(25, 30, 38); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8.5);
    pdf.text(`Planning week: ${planningWeek || "—"}`, pageWidth - margin, 25, { align: "right" });
    pdf.text(`Generated: ${new Date().toLocaleString("en-ZA")}`, pageWidth - margin, 32, { align: "right" });
    pdf.setDrawColor(0, 112, 190); pdf.setLineWidth(0.8); pdf.line(margin, 40, pageWidth - margin, 40);
    pdf.setDrawColor(158, 180, 198); pdf.setLineWidth(0.2); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7); y = 45;
    let x = margin;
    columns.forEach(([label, width]) => { pdf.setFillColor(213, 235, 250); pdf.setTextColor(15, 35, 55); pdf.rect(x, y, width, 10, "FD"); const lines = label.split("\n"); pdf.text(lines, x + (width / 2), y + (lines.length > 1 ? 3.5 : 6), { align: "center" }); x += width; });
    y = tableTop;
  }

  function drawRow(item) {
    const cells = columns.map(([, width, key]) => { const missing = item[key] === null || item[key] === undefined || item[key] === ""; const value = missing && blankByDefault.has(key) ? "" : numeric.has(key) ? fmt(item[key]) : String(item[key] || "—"); return pdf.splitTextToSize(value, width - 3); });
    const height = Math.max(8.5, Math.max(...cells.map((lines) => lines.length)) * 3.5 + 2.5);
    if (y + height > tableBottom) { pdf.addPage(); drawPageHeader(); }
    let x = margin; pdf.setFont("helvetica", "normal"); pdf.setFontSize(7.5); pdf.setTextColor(20, 28, 35); pdf.setDrawColor(195, 200, 204); pdf.setLineWidth(0.15);
    columns.forEach(([, width, key], index) => { pdf.rect(x, y, width, height); const right = numeric.has(key); pdf.text(cells[index], right ? x + width - 1.5 : x + 1.5, y + 4.5, { align: right ? "right" : "left" }); x += width; }); y += height;
  }

  function drawSignOff() {
    const top = 159, panelWidth = 134, rightX = pageWidth - margin - panelWidth;
    pdf.setDrawColor(0, 112, 190); pdf.setLineWidth(0.7); pdf.line(margin, top - 4, pageWidth - margin, top - 4);
    [[margin, "Stores Personnel"], [rightX, "Production Personnel"]].forEach(([x, title]) => {
      pdf.setFillColor(213, 235, 250); pdf.rect(x, top, panelWidth, 9, "F"); pdf.setTextColor(8, 55, 119); pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.text(title, x + 4, top + 6);
      pdf.setTextColor(20, 28, 35); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
      pdf.text("Name and Surname:", x + 4, top + 18); pdf.setDrawColor(35, 65, 100); pdf.setLineWidth(0.3); pdf.line(x + 40, top + 19, x + panelWidth - 4, top + 19);
      pdf.text("Signature:", x + 4, top + 29); pdf.line(x + 40, top + 30, x + panelWidth - 4, top + 30);
      pdf.text("Date:", x + 4, top + 40); pdf.line(x + 40, top + 41, x + 52, top + 41); pdf.text("/", x + 54, top + 41); pdf.line(x + 58, top + 41, x + 70, top + 41); pdf.text("/", x + 72, top + 41); pdf.line(x + 76, top + 41, x + 100, top + 41);
    });
  }

  drawPageHeader();
  if (storeRequests.length) storeRequests.forEach(drawRow); else { pdf.setFont("helvetica", "italic"); pdf.setFontSize(9); pdf.setTextColor(80); pdf.text("No Store requests are required from B-RAW01 for this Production Plan.", margin + 2, y + 7); }
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) { pdf.setPage(page); if (page === pageCount) drawSignOff(); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(35); pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 4, { align: "right" }); }
  pdf.save(`Store-Request-B-RAW01-${safeName(planningWeek)}.pdf`);
}
