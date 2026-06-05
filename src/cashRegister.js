import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const CASH_PATH = path.join(DATA_DIR, "cash-register.json");

async function readCash() {
  try {
    return JSON.parse(await readFile(CASH_PATH, "utf8"));
  } catch {
    return {
      paidCompletions: 0,
      estimatedGrossRevenueUsd: "0.00",
      listingRoastCompletions: 0,
      listingRoastEstimatedRevenueUsd: "$0.00",
      lastPaidAt: null
    };
  }
}

async function writeCash(cash) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CASH_PATH, `${JSON.stringify(cash, null, 2)}\n`);
}

export async function recordPaidCompletion() {
  const cash = await readCash();
  const listingRoastCompletions = Number(cash.listingRoastCompletions || 0) + 1;
  const paidCompletions = Number(cash.paidCompletions || 0) + 1;
  const next = {
    paidCompletions,
    estimatedGrossRevenueUsd: paidCompletions.toFixed(2),
    listingRoastCompletions,
    listingRoastEstimatedRevenueUsd: `$${listingRoastCompletions.toFixed(2)}`,
    lastPaidAt: new Date().toISOString()
  };
  await writeCash(next);
  return next;
}

export async function getCashRegister() {
  return readCash();
}
