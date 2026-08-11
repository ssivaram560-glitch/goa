const DEFAULT_CUSTOM_BETS = [10, 30, 90, 270, 810];
const MAX_LEVEL_CAP = 15;

function getMartingaleBetAmount(cfg, level) {
    const lvl = Math.max(1, Number(level) || 1);
    const customBets = (cfg && Array.isArray(cfg.customBets) && cfg.customBets.length > 0)
        ? cfg.customBets
        : DEFAULT_CUSTOM_BETS;

    const idx = lvl - 1;
    if (idx < customBets.length) {
        const amt = Number(customBets[idx]);
        if (Number.isFinite(amt) && amt > 0) return amt;
    }

    if (customBets.length > 0) {
        const lastAmt = Number(customBets[customBets.length - 1]);
        if (Number.isFinite(lastAmt) && lastAmt > 0) return lastAmt;
    }

    const fallbackIdx = Math.min(idx, DEFAULT_CUSTOM_BETS.length - 1);
    return DEFAULT_CUSTOM_BETS[fallbackIdx];
}

function getBetSequence(cfg, maxLvl) {
    const cap = Math.min(Math.max(1, Number(maxLvl) || 1), MAX_LEVEL_CAP);
    const sequence = [];
    for (let i = 1; i <= cap; i++) {
        sequence.push(getMartingaleBetAmount(cfg, i));
    }
    return sequence;
}

module.exports = {
    getMartingaleBetAmount,
    getBetSequence,
    DEFAULT_CUSTOM_BETS,
    MAX_LEVEL_CAP
};
