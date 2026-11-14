/** PDE-28 budget controls. Pure decisions: they pause new optional work and never delete anything already stored. */
export type BudgetDecision = {
  allowed: boolean;
  configured: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  message: string | null;
};

/** An unset budget means "no configured cap"; an invalid value fails closed as a zero budget. */
export function parseBudget(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return value;
}

function nonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(label + " must be a non-negative number.");
  return value;
}

/** Storage counts stored originals plus still-active upload reservations. */
export function storageBudgetDecision(input: {budgetBytes: number | null; storedBytes: number; reservedBytes: number; requestedBytes: number}): BudgetDecision {
  const used = nonNegative(input.storedBytes, "storedBytes") + nonNegative(input.reservedBytes, "reservedBytes");
  const requested = nonNegative(input.requestedBytes, "requestedBytes");
  if (input.budgetBytes === null) return {allowed: true, configured: false, limit: null, used, remaining: null, message: null};
  const remaining = Math.max(0, input.budgetBytes - used);
  const allowed = used + requested <= input.budgetBytes && (requested > 0 || remaining > 0);
  return {allowed, configured: true, limit: input.budgetBytes, used, remaining,
    message: allowed ? null : "New uploads are paused: the platform's configured media storage budget is used up. Everything already published stays available; no stored original is deleted."};
}

/** Optional derivative rendering pauses before risking the archive. */
export function renderBudgetDecision(input: {budgetSecondsPerDay: number | null; usedSecondsToday: number; requestedSeconds: number}): BudgetDecision {
  const used = nonNegative(input.usedSecondsToday, "usedSecondsToday");
  const requested = nonNegative(input.requestedSeconds, "requestedSeconds");
  if (input.budgetSecondsPerDay === null) return {allowed: true, configured: false, limit: null, used, remaining: null, message: null};
  const remaining = Math.max(0, input.budgetSecondsPerDay - used);
  const allowed = used + requested <= input.budgetSecondsPerDay && (requested > 0 || remaining > 0);
  return {allowed, configured: true, limit: input.budgetSecondsPerDay, used, remaining,
    message: allowed ? null : "Optional summary rendering is paused for today: the configured processing budget is used up. Published originals and released summaries are unaffected; try again after the daily budget resets."};
}

/** Seconds of output a render manifest would produce. */
export function manifestSeconds(clips: ReadonlyArray<{startSeconds: number; endSeconds: number}>): number {
  let total = 0;
  for (const c of clips) {
    const s = Number(c.startSeconds), e = Number(c.endSeconds);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) throw new Error("Invalid clip range.");
    total += e - s;
  }
  return total;
}
