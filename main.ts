// Washout + trend-filter bot for make.fun btc-race-24h-20261113-2314.
//
// Long-only deep-dip (washout) bot with a downtrend filter. Buys only on
// a washout (close >100 bps below the 60-bar high, 5-bar return >+30 bps)
// AND when the 60-bar return is above -150 bps (the decline is moderating,
// not a free-fall). Sells on momentum fade, take-profit, or stop-loss.
// Deterministic: integer prices only, no clock, no network, no env.
import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const HIGH_BARS = 60;
const WASHOUT_BPS = 100;
const CONFIRM_BARS = 5;
const CONFIRM_BPS = 30;
const TREND_BARS = 60;
const MAX_DOWNTREND_BPS = -150; // skip when the 60-bar return is below -150 bps
const TP_BPS = 150;
const SL_BPS = 50;
const EXIT_BPS = 5;
const MAX_SLIPPAGE_BPS = 100;

const closes: bigint[] = [];

function retBps(now: bigint, then: bigint): number {
  const diff = now - then;
  return Number((diff * 10000n) / then);
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      closes.push(BigInt(bar.c));
    }
    if (state.warmingUp) return [];
    if (closes.length <= HIGH_BARS) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const held = state.positions.get(SYMBOL);

    if (held !== undefined) {
      const mom = retBps(close, closes[closes.length - 1 - CONFIRM_BARS]);
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      const takeProfit = value * 10000n >= cost * BigInt(10000 + TP_BPS);
      const stopLoss = value * 10000n <= cost * BigInt(10000 - SL_BPS);
      if (mom < EXIT_BPS || takeProfit || stopLoss) {
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    let hi = closes[closes.length - 1];
    for (let i = closes.length - HIGH_BARS; i < closes.length; i++) {
      if (closes[i] > hi) hi = closes[i];
    }
    const washout = retBps(close, hi);
    if (washout > -WASHOUT_BPS) return [];
    const mom = retBps(close, closes[closes.length - 1 - CONFIRM_BARS]);
    if (mom <= CONFIRM_BPS) return [];
    // Trend filter: skip when the 60-bar return is a severe downtrend.
    if (closes.length > TREND_BARS) {
      const trend = retBps(close, closes[closes.length - 1 - TREND_BARS]);
      if (trend < MAX_DOWNTREND_BPS) return [];
    }
    let stake = state.cash;
    const byWeight = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / BPS;
    if (byWeight < stake) stake = byWeight;
    if (stake <= 0n || stake < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS };
    return [buy];
  },
});
