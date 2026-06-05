import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SIGNAL_KEYS = new Set([
  "homepageViews",
  "schemaViews",
  "examplesViews",
  "mcpViews",
  "commandCopyClicks",
  "unpaidChallenges"
]);

function getCashPath() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "cash-register.json");
}

function initialCash() {
  return {
    paidCompletions: 0,
    estimatedGrossRevenueUsd: "0.00",
    listingRoastCompletions: 0,
    listingRoastEstimatedRevenueUsd: "$0.00",
    lastPaidAt: null,
    firstSignalAt: null,
    lastSignalAt: null,
    signals: {
      homepageViews: 0,
      schemaViews: 0,
      examplesViews: 0,
      mcpViews: 0,
      commandCopyClicks: 0,
      unpaidChallenges: 0
    }
  };
}

function normalizeCash(cash = {}) {
  const base = initialCash();
  return {
    ...base,
    ...cash,
    signals: {
      ...base.signals,
      ...(cash.signals || {})
    }
  };
}

async function readCash() {
  try {
    return normalizeCash(JSON.parse(await readFile(getCashPath(), "utf8")));
  } catch {
    return initialCash();
  }
}

async function writeCash(cash) {
  const cashPath = getCashPath();
  await mkdir(path.dirname(cashPath), { recursive: true });
  await writeFile(cashPath, `${JSON.stringify(cash, null, 2)}\n`);
}

export async function recordSignal(signalKey) {
  if (!SIGNAL_KEYS.has(signalKey)) {
    return readCash();
  }

  const cash = await readCash();
  const now = new Date().toISOString();
  const next = {
    ...cash,
    firstSignalAt: cash.firstSignalAt || now,
    lastSignalAt: now,
    signals: {
      ...cash.signals,
      [signalKey]: Number(cash.signals[signalKey] || 0) + 1
    }
  };
  await writeCash(next);
  return next;
}

export async function recordPaidCompletion() {
  const cash = await readCash();
  const listingRoastCompletions = Number(cash.listingRoastCompletions || 0) + 1;
  const paidCompletions = Number(cash.paidCompletions || 0) + 1;
  const now = new Date().toISOString();
  const next = {
    ...cash,
    paidCompletions,
    estimatedGrossRevenueUsd: paidCompletions.toFixed(2),
    listingRoastCompletions,
    listingRoastEstimatedRevenueUsd: `$${listingRoastCompletions.toFixed(2)}`,
    firstSignalAt: cash.firstSignalAt || now,
    lastSignalAt: now,
    lastPaidAt: now
  };
  await writeCash(next);
  return next;
}

export async function getCashRegister() {
  return readCash();
}
