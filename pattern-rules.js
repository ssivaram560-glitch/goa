function buildBSFromList(list, count) {
    if (!list || !Array.isArray(list)) return [];
    const sliced = list.slice(0, count);
    const resultHistory = [];
    for (const item of sliced) {
        const num = parseInt(item.number || item.winNumber || 0);
        const size = num >= 5 ? "BIG" : "SMALL";
        resultHistory.push(size);
    }
    return resultHistory;
}

function detectCondition3(list) {
    if (!list || list.length < 6) return null;
    const last6 = buildBSFromList(list, 6).map(s => s.toUpperCase());
    if (last6.length < 6) return null;

    const firstSide = last6[0];
    let sameCount = 1;
    for (let i = 1; i < last6.length; i++) {
        if (last6[i] === firstSide) sameCount++;
        else break;
    }
    if (sameCount < 6) return null;

    const prediction = firstSide === "BIG" ? "SMALL" : "BIG";

    return {
        type: "SIZE",
        val: prediction,
        conf: 93,
        pat: "COND3",
        action: {
            opposite: true,
            immediateBet: true,
            afterLossSkip: 3,
            condition3Streak: {
                consecutive: 6,
                side: firstSide,
                last6: last6.join(" ")
            }
        }
    };
}

module.exports = {
    detectCondition3
};
