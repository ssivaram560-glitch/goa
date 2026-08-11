const DEFAULT_MAX_LVL = 15;

function getLevelLossRule(lostLevel) {
    const lvl = Number(lostLevel) || 1;
    if (lvl >= 5) {
        return { type: 'skip', skipPeriods: 5 };
    }
    if (lvl >= 3) {
        return { type: 'watch', lossesRequired: 2 };
    }
    return { type: 'none' };
}

function getNextLevelAfterLoss(lostLevel, maxLvl) {
    const current = Number(lostLevel) || 1;
    const cap = Math.min(Number(maxLvl) || DEFAULT_MAX_LVL, DEFAULT_MAX_LVL);
    const next = current + 1;
    return next > cap ? cap : next;
}

module.exports = {
    getLevelLossRule,
    getNextLevelAfterLoss
};
