"use strict";

require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const syspro = require("../server/db");
const postgres = require("../server/postgres");
const { synchronizeItemMaster } = require("../server/services/itemMasterSync");

const QUERY_PATH = path.join(__dirname, "../server/queries/sysproItemMaster.sql");

function parseArguments(argv) {
  const unknown = argv.filter((argument) => argument !== "--apply");
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  return { apply: argv.includes("--apply") };
}

async function main({ argv = process.argv.slice(2), source = syspro, target = postgres, output = console } = {}) {
  const { apply } = parseArguments(argv);
  const sql = fs.readFileSync(QUERY_PATH, "utf8");
  const result = await synchronizeItemMaster({
    sourceQuery: () => source.query(sql),
    postgres: target,
    apply,
  });
  output.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result.report }, null, 2));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${error.code || "ITEM_SYNC_FAILED"}: ${error.message}`);
    if (error.details?.report) console.error(JSON.stringify(error.details.report, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { QUERY_PATH, parseArguments, main };
