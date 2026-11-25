export const FCSD_COMMODITIES = [
  "Bedliner",
  "Side Step",
  "Chassis Frame",
  "RSB",
  "Tailgate",
  "Bumper Frame",
  "Unclassified",
];

const normalize = (value) => String(value ?? "").trim().toUpperCase();

const EXAMPLE_COMMODITIES = new Map([
  ["N1WZ-17906-HU", "RSB"],
  ["JB3Z-2100038-A", "Bedliner"],
  ["N1WZ-16451-H", "Side Step"],
  ["N1WZ-2640726-K", "Tailgate"],
  ["N1WZ-17D942-G", "Bumper Frame"],
  ["N1WB-16451-KA", "Side Step"],
  ["N1XB-17775-RGSMAS", "RSB"],
  ["N1WB-E12606-SCP", "Bedliner"],
  ["N1WB-E40726-CJ", "Tailgate"],
  ["N1WB-17970-EC", "Bumper Frame"],
].map(([code, commodity]) => [normalize(code), commodity]));
const KNOWN_FCSD_FINISHED_PARTS = new Set([
  "N1WZ-17906-HU",
  "JB3Z-2100038-A",
  "N1WZ-16451-H",
  "N1WZ-2640726-K",
  "N1WZ-17D942-G",
].map(normalize));

export function classifyFcsdFinishedPartCode(value) {
  const code = normalize(value);
  const segments = code.split("-");
  if (!code || segments.length < 2 || segments.some((segment) => !/^[A-Z0-9]+$/.test(segment))) {
    return { status: "INVALID", normalizedCode: code, isFcsd: false };
  }
  if (!segments[0].endsWith("Z")) {
    return { status: "NOT_FCSD", normalizedCode: code, isFcsd: false };
  }
  return {
    status: "FCSD",
    normalizedCode: code,
    isFcsd: true,
    commodity: EXAMPLE_COMMODITIES.get(code) || "Unclassified",
  };
}

export function isKnownFcsdFinishedPartExample(value) {
  return KNOWN_FCSD_FINISHED_PARTS.has(normalize(value));
}

