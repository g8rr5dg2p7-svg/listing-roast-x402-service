import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SIGNAL_KEYS = new Set([
  "homepageViews",
  "builderViews",
  "builderCommandBuilds",
  "llmsViews",
  "openApiViews",
  "schemaViews",
  "sampleViews",
  "examplesViews",
  "mcpViews",
  "x402ManifestViews",
  "commandCopyClicks",
  "unpaidChallenges",
  "validUnpaidChallenges",
  "instantScoreValidUnpaidChallenges",
  "roastValidUnpaidChallenges",
  "scoreValidUnpaidChallenges",
  "emptyDiscoveryProbes",
  "invalidRequests"
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
    listingScoreCompletions: 0,
    listingScoreEstimatedRevenueUsd: "$0.00",
    lastPaidAt: null,
    firstSignalAt: null,
    lastSignalAt: null,
    signals: {
      homepageViews: 0,
      builderViews: 0,
      builderCommandBuilds: 0,
      llmsViews: 0,
      openApiViews: 0,
      schemaViews: 0,
      sampleViews: 0,
      examplesViews: 0,
      mcpViews: 0,
      x402ManifestViews: 0,
      commandCopyClicks: 0,
      unpaidChallenges: 0,
      validUnpaidChallenges: 0,
      instantScoreValidUnpaidChallenges: 0,
      roastValidUnpaidChallenges: 0,
      scoreValidUnpaidChallenges: 0,
      emptyDiscoveryProbes: 0,
      invalidRequests: 0
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

let cashUpdateQueue = Promise.resolve();

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

async function updateCash(mutator) {
  const update = cashUpdateQueue.then(async () => {
    const cash = await readCash();
    const next = mutator(cash);
    await writeCash(next);
    return next;
  });

  cashUpdateQueue = update.catch(() => {});
  return update;
}

function formatEstimatedUsd(value) {
  const milliUsd = Math.round(value * 1000);
  if (milliUsd > 0 && milliUsd % 10 !== 0) {
    return (milliUsd / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  }

  return (Math.round(value * 100) / 100).toFixed(2);
}

export async function recordSignal(signalKey) {
  if (!SIGNAL_KEYS.has(signalKey)) {
    return readCash();
  }

  return updateCash((cash) => {
    const now = new Date().toISOString();
    return {
      ...cash,
      firstSignalAt: cash.firstSignalAt || now,
      lastSignalAt: now,
      signals: {
        ...cash.signals,
        [signalKey]: Number(cash.signals[signalKey] || 0) + 1
      }
    };
  });
}

export async function recordPaidCompletion(kind = "listingRoast", priceUsd = 1) {
  return updateCash((cash) => {
    const isScore = kind === "listingScore";
    const listingRoastCompletions = Number(cash.listingRoastCompletions || 0) + (isScore ? 0 : 1);
    const listingScoreCompletions = Number(cash.listingScoreCompletions || 0) + (isScore ? 1 : 0);
    const paidCompletions = Number(cash.paidCompletions || 0) + 1;
    const estimatedGrossRevenueUsd = Number(cash.estimatedGrossRevenueUsd || 0) + priceUsd;
    const roastRevenue = Number(String(cash.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore ? 0 : priceUsd);
    const scoreRevenue = Number(String(cash.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore ? priceUsd : 0);
    const now = new Date().toISOString();
    return {
      ...cash,
      paidCompletions,
      estimatedGrossRevenueUsd: formatEstimatedUsd(estimatedGrossRevenueUsd),
      listingRoastCompletions,
      listingRoastEstimatedRevenueUsd: `$${formatEstimatedUsd(roastRevenue)}`,
      listingScoreCompletions,
      listingScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(scoreRevenue)}`,
      firstSignalAt: cash.firstSignalAt || now,
      lastSignalAt: now,
      lastPaidAt: now
    };
  });
}

export async function getCashRegister() {
  return readCash();
}
