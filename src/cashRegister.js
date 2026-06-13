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
  "pingValidUnpaidChallenges",
  "roastValidUnpaidChallenges",
  "scoreValidUnpaidChallenges",
  "emptyDiscoveryProbes",
  "invalidRequests"
]);

function getCashPath() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "cash-register.json");
}

function baselineNumber(name) {
  const value = Number(process.env[name] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function baselineUsd(name) {
  const value = String(process.env[name] || "0").replace(/^\$/, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function baselineMoney(name) {
  const value = baselineUsd(name);
  if (!value) {
    return "$0.00";
  }

  return `$${String(process.env[name]).replace(/^\$/, "")}`;
}

function initialCash() {
  const baselinePaidCompletions = baselineNumber("BASELINE_PAID_COMPLETIONS");
  const baselineGrossRevenue = baselineUsd("BASELINE_ESTIMATED_GROSS_REVENUE_USD");
  const baselineListingRoastCompletions = baselineNumber("BASELINE_LISTING_ROAST_COMPLETIONS");
  const baselineListingScoreCompletions = baselineNumber("BASELINE_LISTING_SCORE_COMPLETIONS");
  const baselinePingCompletions = baselineNumber("BASELINE_X402_PING_COMPLETIONS");
  const baselineLastPaidAt = process.env.BASELINE_LAST_PAID_AT || null;

  return {
    paidCompletions: baselinePaidCompletions,
    estimatedGrossRevenueUsd: baselineGrossRevenue ? String(process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD).replace(/^\$/, "") : "0.00",
    listingRoastCompletions: baselineListingRoastCompletions,
    listingRoastEstimatedRevenueUsd: baselineMoney("BASELINE_LISTING_ROAST_REVENUE_USD"),
    listingScoreCompletions: baselineListingScoreCompletions,
    listingScoreEstimatedRevenueUsd: baselineMoney("BASELINE_LISTING_SCORE_REVENUE_USD"),
    x402PingCompletions: baselinePingCompletions,
    x402PingEstimatedRevenueUsd: baselineMoney("BASELINE_X402_PING_REVENUE_USD"),
    lastPaidAt: baselineLastPaidAt,
    importedBaseline: baselinePaidCompletions > 0 ? {
      paidCompletions: baselinePaidCompletions,
      estimatedGrossRevenueUsd: baselineGrossRevenue ? String(process.env.BASELINE_ESTIMATED_GROSS_REVENUE_USD).replace(/^\$/, "") : "0.00",
      source: "env",
      lastPaidAt: baselineLastPaidAt
    } : null,
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
      pingValidUnpaidChallenges: 0,
      roastValidUnpaidChallenges: 0,
      scoreValidUnpaidChallenges: 0,
      emptyDiscoveryProbes: 0,
      invalidRequests: 0
    }
  };
}

function normalizeCash(cash = {}) {
  const base = initialCash();
  const merged = {
    ...base,
    ...cash,
    signals: {
      ...base.signals,
      ...(cash.signals || {})
    }
  };

  const estimatedGrossRevenueUsd = Math.max(Number(base.estimatedGrossRevenueUsd || 0), Number(cash.estimatedGrossRevenueUsd || 0));
  const listingRoastRevenue = Math.max(Number(String(base.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const listingScoreRevenue = Math.max(Number(String(base.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")));
  const pingRevenue = Math.max(Number(String(base.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")), Number(String(cash.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")));

  return {
    ...merged,
    paidCompletions: Math.max(Number(base.paidCompletions || 0), Number(cash.paidCompletions || 0)),
    estimatedGrossRevenueUsd: estimatedGrossRevenueUsd ? formatEstimatedUsd(estimatedGrossRevenueUsd) : "0.00",
    listingRoastCompletions: Math.max(Number(base.listingRoastCompletions || 0), Number(cash.listingRoastCompletions || 0)),
    listingRoastEstimatedRevenueUsd: `$${formatEstimatedUsd(listingRoastRevenue)}`,
    listingScoreCompletions: Math.max(Number(base.listingScoreCompletions || 0), Number(cash.listingScoreCompletions || 0)),
    listingScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(listingScoreRevenue)}`,
    x402PingCompletions: Math.max(Number(base.x402PingCompletions || 0), Number(cash.x402PingCompletions || 0)),
    x402PingEstimatedRevenueUsd: `$${formatEstimatedUsd(pingRevenue)}`,
    lastPaidAt: cash.lastPaidAt || base.lastPaidAt
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
    const isPing = kind === "x402Ping";
    const isRoast = !isScore && !isPing;
    const listingRoastCompletions = Number(cash.listingRoastCompletions || 0) + (isRoast ? 1 : 0);
    const listingScoreCompletions = Number(cash.listingScoreCompletions || 0) + (isScore ? 1 : 0);
    const x402PingCompletions = Number(cash.x402PingCompletions || 0) + (isPing ? 1 : 0);
    const paidCompletions = Number(cash.paidCompletions || 0) + 1;
    const estimatedGrossRevenueUsd = Number(cash.estimatedGrossRevenueUsd || 0) + priceUsd;
    const roastRevenue = Number(String(cash.listingRoastEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore || isPing ? 0 : priceUsd);
    const scoreRevenue = Number(String(cash.listingScoreEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isScore ? priceUsd : 0);
    const pingRevenue = Number(String(cash.x402PingEstimatedRevenueUsd || "$0").replace(/^\$/, "")) + (isPing ? priceUsd : 0);
    const now = new Date().toISOString();
    return {
      ...cash,
      paidCompletions,
      estimatedGrossRevenueUsd: formatEstimatedUsd(estimatedGrossRevenueUsd),
      listingRoastCompletions,
      listingRoastEstimatedRevenueUsd: `$${formatEstimatedUsd(roastRevenue)}`,
      listingScoreCompletions,
      listingScoreEstimatedRevenueUsd: `$${formatEstimatedUsd(scoreRevenue)}`,
      x402PingCompletions,
      x402PingEstimatedRevenueUsd: `$${formatEstimatedUsd(pingRevenue)}`,
      firstSignalAt: cash.firstSignalAt || now,
      lastSignalAt: now,
      lastPaidAt: now
    };
  });
}

export async function getCashRegister() {
  return readCash();
}
