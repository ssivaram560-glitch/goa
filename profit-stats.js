function formatINR(amount) {
    const n = Number(amount) || 0;
    return "₹" + n.toFixed(2);
}

function buildLevelAnalysis(pt, maxShow) {
    const lb = pt && pt.levelBets ? pt.levelBets : {};
    const maxReached = Object.keys(lb).length ? Math.max(...Object.keys(lb).map(Number)) : 0;
    const upTo = Math.min(maxReached, maxShow || 20);
    let totalInv = 0, totalProfit = 0, totalBets = 0, totalWins = 0, totalLosses = 0;
    const lines = [];
    for (let i = 1; i <= upTo; i++) {
        const d = lb[i];
        if (!d || (d.bets === 0)) continue;
        const rate = d.bets ? ((d.wins / d.bets) * 100).toFixed(0) : "0";
        lines.push("L" + i + ": " + d.wins + "W/" + d.losses + "L (" + rate + "%)  " + (d.profit >= 0 ? "+" : "") + formatINR(d.profit));
        totalInv += d.invested; totalProfit += d.profit;
        totalBets += d.bets; totalWins += d.wins; totalLosses += d.losses;
    }
    const overallRate = totalBets ? ((totalWins / totalBets) * 100).toFixed(1) : "0.0";
    return {
        lines,
        summary: totalBets + "B | " + totalWins + "W/" + totalLosses + "L (" + overallRate + "%)",
        totalInv,
        totalProfit,
        totalBets,
        totalWins,
        totalLosses
    };
}

function buildStatsReport(userId, stats, profitTrack) {
    const d = stats || {};
    const pt = profitTrack || {};
    const total = Number(d.total) || 0;
    const win = Number(d.win) || 0;
    const loss = Number(d.loss) || 0;
    const rate = total ? ((win / total) * 100).toFixed(1) : "0.0";
    const pnl = Number(pt.pnl) || 0;

    const predTotal = Number(pt.predTotal) || 0;
    const predWins = Number(pt.predWins) || 0;
    const predLosses = Number(pt.predLosses) || 0;
    const predRate = predTotal ? ((predWins / predTotal) * 100).toFixed(1) : "0.0";

    const bar = "🟦".repeat(total ? Math.round(win / total * 10) : 0) + "⬜".repeat(total ? 10 - Math.round(win / total * 10) : 10);
    const predBar = "🟦".repeat(predTotal ? Math.round(predWins / predTotal * 10) : 0) + "⬜".repeat(predTotal ? 10 - Math.round(predWins / predTotal * 10) : 10);

    let section1 = "📊 ACTUAL BETS SUMMARY\n";
    section1 += "═════════════════════════\n";
    section1 += "Total Bets  : " + total + "\n";
    section1 += "Win / Loss  : " + win + "W / " + loss + "L\n";
    section1 += "Accuracy    : " + rate + "%\n";
    section1 += bar + "\n";
    section1 += "P&L         : " + (pnl >= 0 ? "+" : "") + formatINR(pnl) + "\n";
    section1 += "Best Streak : " + (Number(d.maxWinStreak) || 0) + " wins\n";
    section1 += "Worst Streak: " + (Number(d.maxLossStreak) || 0) + " losses\n";

    const la = buildLevelAnalysis(pt, 15);
    let section2 = "\n📊 LEVEL-WISE BREAKDOWN\n";
    section2 += "═════════════════════════\n";
    if (la.lines.length > 0) {
        section2 += la.lines.join("\n") + "\n";
        section2 += "─────────────────────────\n";
        section2 += "Summary   : " + la.summary + "\n";
        section2 += "Invested  : " + formatINR(la.totalInv) + "\n";
        section2 += "Lvl P&L   : " + (la.totalProfit >= 0 ? "+" : "") + formatINR(la.totalProfit) + "\n";
    } else {
        section2 += "No placed bets yet.\n";
    }

    let section3 = "\n📊 PREDICTION ENGINE STATS\n";
    section3 += "═════════════════════════\n";
    section3 += "Total Preds : " + predTotal + " (Bet+Watch+Skip)\n";
    section3 += "Win / Loss  : " + predWins + "W / " + predLosses + "L\n";
    section3 += "Accuracy    : " + predRate + "%\n";
    section3 += predBar + "\n";
    section3 += "Best Pred W : " + (Number(pt.predMaxW) || 0) + "\n";
    section3 += "Worst Pred L: " + (Number(pt.predMaxL) || 0) + "\n";

    return "📊 STATS REPORT — User " + userId + "\n\n" + section1 + section2 + section3;
}

function buildProfitReport(userId, cfg, profitTrack, getBetSequenceFn, liveBalanceResult, trackedBalanceTextFn) {
    const pt = profitTrack || {};
    const amounts = getBetSequenceFn(cfg, cfg.maxLvl);
    const la = buildLevelAnalysis(pt, 15);

    const totalBets = Number(pt.totalBets) || 0;
    const wins = Number(pt.wins) || 0;
    const losses = Number(pt.losses) || 0;
    const pnl = Number(pt.pnl) || 0;
    const invested = Number(pt.totalBetAmount) || 0;
    const winRate = totalBets ? ((wins / totalBets) * 100).toFixed(1) : "0.0";

    let liveBalance = "❌ No token";
    if (liveBalanceResult && liveBalanceResult.success) {
        liveBalance = formatINR(liveBalanceResult.balance);
    } else if (liveBalanceResult && liveBalanceResult.message) {
        liveBalance = "⚠️ " + liveBalanceResult.message;
    }

    let section1 = "💰 BALANCE OVERVIEW\n";
    section1 += "═════════════════════════\n";
    section1 += "Live Balance   : " + liveBalance + "\n";
    section1 += "Tracked Balance: " + trackedBalanceTextFn(userId) + "\n";
    section1 += "Starting Bal   : " + (Number(cfg.startingBalance) > 0 ? formatINR(cfg.startingBalance) : "Not set") + "\n";

    let section2 = "\n💰 FINANCIAL PERFORMANCE\n";
    section2 += "═════════════════════════\n";
    section2 += "Total Invested : " + formatINR(invested) + "\n";
    section2 += "Net P&L        : " + (pnl >= 0 ? "+" : "") + formatINR(pnl) + "\n";
    section2 += "Total Bets     : " + totalBets + "\n";
    section2 += "Win Rate       : " + wins + "W / " + losses + "L (" + winRate + "%)\n";
    section2 += "Best Win Streak: " + (Number(pt.maxW) || 0) + "\n";
    section2 += "Worst Loss Strk: " + (Number(pt.maxL) || 0) + "\n";

    let section3 = "\n💰 CURRENT MARTINGALE SEQUENCE\n";
    section3 += "═════════════════════════\n";
    section3 += "Max Level : L" + (cfg.maxLvl || amounts.length) + "\n";
    section3 += "Sequence  : ₹" + amounts.join(" → ₹") + "\n";

    return "💰 PROFIT REPORT — User " + userId + "\n\n" + section1 + section2 + section3;
}

module.exports = {
    buildStatsReport,
    buildProfitReport,
    buildLevelAnalysis,
    formatINR
};
