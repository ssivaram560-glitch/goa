const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');
const { captchaLogin } = require('./captcha-solver-free');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    = process.env.BOT_TOKEN || "8756624614:AAFlSOH_BPeFlC-CK-ZFj51isT4TdfeLfP8";
const OWNER_ID     = 1865939951;
const OWNER_IDS    = [OWNER_ID, 8321379592];
const OWNER_PASS   = "praveensaran";
const ADMIN_HANDLE = "@lucifer1570";
const REG_LINK     = "http://www.goagames.social/#/register?invitationCode=4451836691";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.goa7777.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.goa7777.com/api/webapi/Captcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683, 59049, 177147, 531441, 1594323, 4782969];
const MAX_SENT_PERIODS = 100;

// ============================================================
//  RENDER KEEP-ALIVE
// ============================================================
const http = require('http');
const PORT = process.env.PORT || 5000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SIVA BOT OK');
}).listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

const RENDER_URL = process.env.RENDER_URL || "";
if (RENDER_URL) {
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
        console.log("[PING] Keep-alive ping sent");
    }, 14 * 60 * 1000);
}

// ============================================================
//  STORAGE
// ============================================================
let ownerLoggedIn  = false;
let adminPasswords = {};
let adminLoggedIn  = {};
let usersAccess    = {};
let keyStore       = {};
let stats          = {};
let running        = {};
let sentPeriods    = {};
let ownerState     = null;
let adminState   = {};
let userAction   = {}; 
let userCreds      = {};
let autobetCfg     = {};
let autobetState   = {};
let profitTrack    = {};
let GLOBAL_TOKEN   = "";
let userTokens     = {}; 
let userStates     = {};
let activeBets     = {};
let stopAfterWin   = {};
let allUsersStopped = false;
let CLEANUP_INTERVAL_MIN = Number(process.env.CLEANUP_INTERVAL_MIN) || 30; // minutes

// Track last activity time optionally (used for advanced cleanup)
let lastActivity = {};

function touchUser(uid) {
    try { lastActivity[uid] = Date.now(); } catch(e){}
}

async function cleanupInactiveUsers() {
    try {
        const now = Date.now();
        const removed = [];

        // Remove users whose access expired and are not running
        for (const uid of Object.keys(usersAccess)) {
            if (isOwner(uid)) continue;
            const expiry = Number(usersAccess[uid]) || 0;
            if (expiry && expiry < now && !running[uid]) {
                delete usersAccess[uid];
                delete stats[uid];
                delete sentPeriods[uid];
                delete autobetCfg[uid];
                delete autobetState[uid];
                delete profitTrack[uid];
                delete userTokens[uid];
                delete userCreds[uid];
                delete userStates[uid];
                delete activeBets[uid];
                delete stopAfterWin[uid];
                delete running[uid];
                delete lastActivity[uid];
                removed.push(uid);
            }
        }

        // Also sweep orphaned entries for users that are not owners, not running and have no access
        const maps = [stats, sentPeriods, autobetCfg, autobetState, profitTrack, userTokens, userCreds, userStates, activeBets, stopAfterWin, running, usersAccess];
        const ids = new Set();
        maps.forEach(m => Object.keys(m).forEach(k => ids.add(k)));
        for (const uid of ids) {
            if (isOwner(uid)) continue;
            const hasAccess = usersAccess[uid] && Number(usersAccess[uid]) > now;
            if (!hasAccess && !running[uid]) {
                delete stats[uid];
                delete sentPeriods[uid];
                delete autobetCfg[uid];
                delete autobetState[uid];
                delete profitTrack[uid];
                delete userTokens[uid];
                delete userCreds[uid];
                delete userStates[uid];
                delete activeBets[uid];
                delete stopAfterWin[uid];
                delete running[uid];
                delete usersAccess[uid];
                delete lastActivity[uid];
                removed.push(uid);
            }
        }

        const mu = process.memoryUsage();
        console.log(`[CLEANUP] removed ${removed.length} users — rss:${(mu.rss/1024/1024).toFixed(1)}MB heapUsed:${(mu.heapUsed/1024/1024).toFixed(1)}MB`);
    } catch (err) {
        console.error('[CLEANUP ERR]', err && err.message);
    }
}

// Start periodic cleanup
setInterval(cleanupInactiveUsers, CLEANUP_INTERVAL_MIN * 60 * 1000);
// initial cleanup at startup
setImmediate(cleanupInactiveUsers);

// ============================================================
//  LOGGING HELPER
// ============================================================
async function logBoth(chatId, msg, isError = false) {
    if (isError) console.error(msg);
    else console.log(msg);
    if (chatId) {
        if (bot) {
            try {
                await bot.sendMessage(chatId, msg);
            } catch (e) {
                // Ignore
            }
        }
    }
}

// ============================================================
//  HELPERS
// ============================================================
async function fetchList() {
    try {
        const response = await axios.get(DRAW_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://goaokk.com",
                "Referer": "https://goaokk.com/",
                "Ar-Origin": "https://goaokk.com",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        if (response.data && response.data.data && response.data.data.list) {
            return response.data.data.list;
        }
        return [];
    } catch (error) {
        console.error("[FETCH LIST ERROR]", error.message);
        return null;
    }
}

async function parseBalanceResponse(r) {
    if (r.data && r.data.code === 0 && r.data.data && typeof r.data.data.balance !== 'undefined') {
        return { success: true, balance: r.data.data.balance };
    }
    return {
        success: false,
        message: r.data && r.data.msg ? r.data.msg : "Token expired or invalid"
    };
}

async function getLiveBalance(userId, chatId = null) {
    let token = getToken(userId);
    if (!token && chatId) {
        const ok = await autoLogin(userId, chatId, true);
        if (ok) token = getToken(userId);
    }
    if (!token) return { success: false, message: "No token" };

    const url = "https://api.goa7777.com/api/webapi/GetBalance";
    const headers = {
        "Authorization": "Bearer " + token,
        "Ar-Origin": "https://goaokk.com",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 5000 });
        return await parseBalanceResponse(r);
    } catch (e) {
        if (e.response && e.response.status === 405) {
            try {
                const r2 = await axios.post(url, {}, { headers, timeout: 5000 });
                return await parseBalanceResponse(r2);
            } catch (e2) {
                const errMsg = e2.response?.data?.msg || e2.message || "API Error";
                return { success: false, message: errMsg };
            }
        }
        const errMsg = e.response?.data?.msg || e.message || "API Error";
        return { success: false, message: errMsg };
    }
}

function initUser(id) {
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0 };
    if (!userStates[id])   userStates[id]   = { resultHistory:[], skipCount:0, currentMode:null, lastPrediction:null, isSkipping:false };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:15,
        enabled:false, 
        customBets:[1,3,9,27,81],
        startingBalance: 0,
        targetProfit: 1000,
        restartDelay: 1
    };
    if (!autobetState[id]) autobetState[id] = { 
        level:1, 
        virtualLevel:1,
        consecutiveLoss:0, 
        inMart:false,
        isWaiting: false,
        nextStartTime: null
    };
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, currentBalance: null, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0, levelStats: {}, levelBets: {}, predTotal:0, predWins:0, predLosses:0, predMaxW:0, predMaxL:0, predCurW:0, predCurL:0 };
    if (!Object.prototype.hasOwnProperty.call(profitTrack[id], "currentBalance")) profitTrack[id].currentBalance = null;
    touchUser(id);
}

function hasAccess(id) {
    if (isOwner(id)) return true;
    const expiry = usersAccess[id];
    return !!(expiry && Date.now() < expiry);
}

function daysLeft(id) {
    if (isOwner(id)) return "∞";
    const expiry = usersAccess[id];
    if (!expiry) return "0";
    const left = (expiry - Date.now()) / 86400000;
    return left > 0 ? left.toFixed(1) : "0";
}

function isOwner(id)    { return OWNER_IDS.includes(Number(id)); }
function isAdmin(id)    { return adminPasswords[id] !== undefined; }
function isAdminIn(id)  { return adminLoggedIn[id] === true; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function getToken(id)   { return userTokens[id] || GLOBAL_TOKEN || ""; }

function updateTrackedBalance(userId, change) {
    initUser(userId);
    const cfg = autobetCfg[userId];
    const pt = profitTrack[userId];
    const startingBalance = Number(cfg.startingBalance);
    if (!Number.isFinite(startingBalance) || startingBalance <= 0) return null;
    if (pt.currentBalance === null || !Number.isFinite(Number(pt.currentBalance))) {
        pt.currentBalance = startingBalance;
    }
    pt.currentBalance += Number(change) || 0;
    return pt.currentBalance;
}

function trackedBalanceText(userId) {
    const balance = profitTrack[userId] && profitTrack[userId].currentBalance;
    return balance === null || !Number.isFinite(Number(balance)) ? "Not set" : "₹" + Number(balance).toFixed(2);
}

function generateKey(days, by) {
    const k = "EARN WITH ME-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID };
    return k;
}

function activateKey(userId, code) {
    const k = code.toUpperCase().trim();
    if (!keyStore[k])     return { ok:false, msg:"❌ Invalid key!" };
    if (keyStore[k].used) return { ok:false, msg:"❌ Key already used!" };

    const days = Number(keyStore[k].days) || 1;
    const currentExpiry = usersAccess[userId];
    const base = (currentExpiry && currentExpiry > Date.now()) ? currentExpiry : Date.now();
    const newExpiry = base + days * 86400000;

    keyStore[k].used=true;
    keyStore[k].usedBy=userId;
    usersAccess[userId] = newExpiry;
    return { ok:true, days, expiry:new Date(newExpiry).toLocaleString() };
}

function activeUsersList() {
    const now=Date.now();
    const ids = new Set(Object.keys(usersAccess));
    Object.keys(running).forEach(id => { if (running[id]) ids.add(id); });

    const list = [...ids].filter(id => isOwner(id) || running[id] || Number(usersAccess[id]) > now);
    if (!list.length) return "No active users.";

    return list.map(id => {
        if (isOwner(id)) return "🟢 " + id + " | ♾️ Unlimited";
        if (running[id]) return "🟢 " + id + " | ⚡ Running";
        const expiry = Number(usersAccess[id]) || 0;
        return "🟢 " + id + " | " + ((expiry - now) / 86400000).toFixed(1) + "d";
    }).join("\n");
}

function adminList() {
    const ids=Object.keys(adminPasswords);
    return ids.length ? ids.map(id=>"👤 "+id+" | "+(adminLoggedIn[id]?"🟢 Online":"🔴 Offline")).join("\n") : "No admins.";
}

function allKeysList() {
    const keys=Object.entries(keyStore);
    return keys.length ? keys.map(([k,v])=>k+" → "+(v.used?"✅ Used":"🟢 "+v.days+"d")).join("\n") : "No keys.";
}

// ============================================================
//  DEVICE ID & SIGNATURES
// ============================================================
function getOrCreateDevice(userId) {
    if (!userCreds[userId]) userCreds[userId] = {};
    if (!userCreds[userId].deviceId) {
        userCreds[userId].deviceId = crypto.randomBytes(16).toString('hex');
    }
    return userCreds[userId].deviceId;
}

function makeBetSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp;
    const keys = Object.keys(p).filter(k=>p[k]!==null&&p[k]!=="").sort();
    const sorted = {};
    keys.forEach(k=>{ sorted[k]=p[k]===0?0:p[k]; });
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').toUpperCase().slice(0,32);
}

// ============================================================
//  AUTO LOGIN
// ============================================================
let loginLock = {};

async function autoLogin(userId, chatId, silent = false) {
    if (loginLock[userId]) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} already in login process.`);
        return false;
    }
    loginLock[userId] = true;

    const creds = userCreds[userId] || {};
    const { phone, pass } = creds;

    if (!phone || !pass) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} has no phone or password set.`);
        loginLock[userId] = false;
        return false;
    }

    try {
        const token = await captchaLogin(userId, chatId, phone, pass, bot, logBoth);
        if (token) {
            userTokens[userId] = token;
            if (!silent) {
                await logBoth(chatId, `✅ [SUCCESS] Token captured for user ${userId}!`);
            }
            return true;
        } else {
            if (!silent) {
                await logBoth(chatId, `❌ [FAILED] Login failed for user ${userId}`, true);
            }
            return false;
        }
    } catch (err) {
        await logBoth(chatId, `❌ Login Error for user ${userId}: ${err.message}`, true);
        return false;
    } finally {
        loginLock[userId] = false;
    }
}

async function robustLogin(userId, chatId, silent = false) {
    let success = await autoLogin(userId, chatId, silent);
    if (!success && !silent && chatId) {
        await logBoth(chatId, "❌ Login failed. Will retry automatically.");
    }
    return success;
}

// ============================================================
//  PLACE BET
// ============================================================
// ============================================================
async function placeBet(userId, chatId, period, prediction, predType, level) {
    let token = getToken(userId);
    if (!token || token.length < 20) {
        console.log("[PLACE BET] Token missing or invalid, attempting autoLogin...");
        const ok = await autoLogin(userId, chatId, true);
        if (!ok) { 
            await send(chatId, "❌ Token இல்லை! Auto-login தோல்வியடைந்தது."); 
            return false; 
        }
        token = getToken(userId);
    }

    const cfg       = autobetCfg[userId];
    const betMult   = cfg.customBets[level-1] || (cfg.baseBet * MULT[level-1]);
    if (!Number.isFinite(betMult) || betMult <= 0) {
        await send(chatId, "❌ No valid bet amount configured for L" + level + ". Bet stopped safely.");
        return false;
    }
    let bc = "";

    const maxRetries = 5; 
    const retryDelayMs = 2000; 

    if (predType === "SIZE")  bc = prediction === "BIG" ? "BigSmall_Big" : "BigSmall_Small";
    if (predType === "COLOR") bc = prediction === "RED" ? "Color_Red"    : "Color_Green";

    console.log(`[BET] ${bc} ₹${betMult} L${level} for Period: ${period}`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            // Dynamic generation inside the loop so random/timestamp/issueNumber are fresh on retry if needed
            const params = {
                amount:      1,
                betContent:  bc,
                betMultiple: betMult,
                gameCode:    "WinGo_30S", 
                issueNumber: String(period),
                language:    "en",
                random:      Math.floor(Math.random() * 1e12)
            };
            const signature = makeBetSign(params);
            const timestamp = Math.floor(Date.now() / 1000);
            const payload   = {...params, signature, timestamp};

            const r = await axios.post(BET_URL, payload, {
                headers: {
                    "authorization":    "Bearer " + token,
                    "content-type":     "application/json",
                    "Accept":           "application/json, text/plain, */*",
                    "Origin":           "https://goaokk.com",
                    "Referer":          "https://goaokk.com/",
                    "Ar-Origin":        "https://goaokk.com",
                    "Sec-Ch-Ua":        '"Chromium";v="139"',
                    "Sec-Ch-Ua-Mobile": "?1",
                    "Sec-Fetch-Dest":   "empty",
                    "Sec-Fetch-Mode":   "cors",
                    "Sec-Fetch-Site":   "cross-site",
                    "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                },
                timeout: 10000
            });

            const d = r.data;
            console.log(`[BET RESP] code:${d.code} msg:${d.msg}`);

            // Token check from response headers/body
            const newTokenFromResponseHeader = r.headers['authorization'] || r.headers['x-auth-token'];
            if (newTokenFromResponseHeader) {
                const cleanNewToken = newTokenFromResponseHeader.replace(/^Bearer\s+/i, "");
                if (cleanNewToken !== token) {
                    userTokens[userId] = cleanNewToken;
                    token = cleanNewToken; // update local variable too
                    console.log("[TOKEN UPDATE] New token captured from bet response headers!");
                }
            }

            if (d.data && d.data.token && d.data.token !== token) {
                 userTokens[userId] = d.data.token;
                 token = d.data.token;
                 console.log("[TOKEN UPDATE] New token captured from bet response body!");
            }

            // Success case
            if (d.code === 0 || d.msg === "Succeed" || d.msgCode === 0) {
                return { ok: true, amt: betMult, bc };
            }

            // Token Expiry Handling -> AUTOMATIC RELOGIN (User கேட்காத வண்ணம்)
            if (d.code === 401 || d.code === 40100 || (d.msg && (d.msg.toLowerCase().includes("token") || d.msg.toLowerCase().includes("expired")))) {
                console.log("[AUTO RELOGIN] Token expired during bet. Trying autoLogin...");
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    token = getToken(userId); // Get fresh token
                    console.log("[AUTO RELOGIN] Success! Retrying the bet with new token...");
                    continue; // Retry the loop with new token
                } else {
                    await send(chatId, "❌ Auto-login failed during token expiry.");
                    return false;
                }
            }

            // Retryable errors like Param is Invalid, issue number, etc.
            const retryableErrors = ["param is invalid", "the issue number does not exist", "period current settled"];
            const lowerMsg = (d.msg || "").toLowerCase();
            
            if (retryableErrors.some(errStr => lowerMsg.includes(errStr))) {
                console.log(`[BET RETRY] Retryable error: ${d.msg}. Retrying in ${retryDelayMs / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue; 
            }

            // Other unhandled API errors
            await send(chatId, "❌ Bet fail: " + (d.msg || JSON.stringify(d).substr(0, 60)));
            return false;

        } catch (err) {
            console.error("[BET ERR]", err.message);

            // Handle Axios 401 / Token errors inside catch block
            if (err.response && (err.response.status === 401 || (err.response.data && err.response.data.msg && (err.response.data.msg.toLowerCase().includes("token") || err.response.data.msg.toLowerCase().includes("expired"))))) {
                console.log("[AUTO RELOGIN] Token error caught via exception. Trying autoLogin...");
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    token = getToken(userId);
                    continue; // Retry after relogin
                } else {
                    await send(chatId, "❌ Auto-login failed during token error.");
                    return false;
                }
            }

            // For general network errors, retry if attempts left
            if (i < maxRetries - 1) {
                console.log(`[BET RETRY] Network error. Retrying in ${retryDelayMs / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue;
            }

            await send(chatId, "❌ Network error during bet: " + err.message);
            return false;
        }
    }

    console.log("[BET FAIL] All retries exhausted.");
    return false;
}

// ============================================================
//  PREDICTION LOGIC
// ============================================================
function buildBSFromList(list, count = 5) {
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

function initState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            mode: "NORMAL", 
            pendingPrediction: true,
            forcedModeQueue: [],    
            historyModes: [],
            periodCounter: 0,        
            normalWinsIn20: 0,       
            recoveryWinsIn20: 0,
            lastPredictionWasLoss: false,
            consecutivePatternLoss: 0,
            skipCount: 0,       
            isSkipping: false,
            levelWatchActive: false,
            levelWatchLosses: 0,
            levelWatchTarget: null,
            levelWatchRequired: 0
        };
    } else {
        if (!userStates[userId].historyModes) userStates[userId].historyModes = [];
        if (!userStates[userId].forcedModeQueue) userStates[userId].forcedModeQueue = [];
        if (userStates[userId].periodCounter === undefined) userStates[userId].periodCounter = 0;
        if (userStates[userId].normalWinsIn20 === undefined) userStates[userId].normalWinsIn20 = 0;
        if (userStates[userId].recoveryWinsIn20 === undefined) userStates[userId].recoveryWinsIn20 = 0;
        if (userStates[userId].lastPredictionWasLoss === undefined) userStates[userId].lastPredictionWasLoss = false;
        if (userStates[userId].consecutivePatternLoss === undefined) userStates[userId].consecutivePatternLoss = 0;
        if (userStates[userId].skipCount === undefined) userStates[userId].skipCount = 0;
        if (userStates[userId].isSkipping === undefined) userStates[userId].isSkipping = false;
        if (userStates[userId].levelWatchActive === undefined) userStates[userId].levelWatchActive = false;
        if (userStates[userId].levelWatchLosses === undefined) userStates[userId].levelWatchLosses = 0;
        if (userStates[userId].levelWatchTarget === undefined) userStates[userId].levelWatchTarget = null;
        if (userStates[userId].levelWatchRequired === undefined) userStates[userId].levelWatchRequired = 0;
    }
}

function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 5) {
        return null;
    }

    initState(userId);
    const state = userStates[userId];

    // CONDITION 1: Check last 6 pattern: BIG BIG BIG SMALL SMALL SMALL (or reverse)
    if (list.length >= 6) {
        const last6 = buildBSFromList(list, 6);
        const seq = last6.map(s => s.toUpperCase()); // most recent first
        const condA = seq.join(" ") === "BIG BIG BIG SMALL SMALL SMALL";
        const condB = seq.join(" ") === "SMALL SMALL SMALL BIG BIG BIG";
        if (condA || condB) {
            return { type: "SIZE", val: "SKIP", conf: 100, pat: "COND1", action: { skip: 5 } };
        }
    }

    // CONDITION 2: Check last 4 alternating patterns: B S B S or S B S B
    if (list.length >= 4) {
        const last4 = buildBSFromList(list, 4).map(s => s.toUpperCase());
        const alt1 = last4.join(" ") === "BIG SMALL BIG SMALL";
        const alt2 = last4.join(" ") === "SMALL BIG SMALL BIG";
        if (alt1 || alt2) {
            // prediction = opposite of the most recent result
            const recent = last4[0];
            const prediction = recent === "BIG" ? "SMALL" : "BIG";
            // activate opposite-mode in user state so subsequent calls continue it until a loss
            state.oppositeMode = { active: true, dir: prediction };
            // immediateBet: cancel current skip and place one immediate bet at the next level; afterLossSkip: 6
            return { type: "SIZE", val: prediction, conf: 92, pat: "COND2", action: { opposite: true, immediateBet: true, afterLossSkip: 6 } };
        }
    }

    // If an opposite-mode is active (from Condition 2), continue with it
    if (state && state.oppositeMode && state.oppositeMode.active && state.oppositeMode.dir) {
        return { type: "SIZE", val: state.oppositeMode.dir, conf: 90, pat: "COND2_CONTINUE" };
    }

    // Fallback: majority of last 5
    const last5 = buildBSFromList(list, 5).map(size => size === "BIG" ? "B" : "S");
    const bigCount = last5.filter(value => value === "B").length;
    const smallCount = last5.filter(value => value === "S").length;
    const prediction = bigCount > smallCount ? "BIG" :
        smallCount > bigCount ? "SMALL" : "SKIP";

    return {
        type: "SIZE",
        val: prediction,
        conf: 85,
        pat: "LAST5"
    };
}

function updateAfterResult(userId, wasWin, actual, betPlaced, betAmount = null) {
    initState(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    
    state.lastPredictionWasLoss = !wasWin;
    state.periodCounter++;

    // Manage opposite-mode (Condition 2): continue predicting opposite direction until a loss
    if (state.oppositeMode && state.oppositeMode.active) {
        if (wasWin) {
            // keep opposite-mode active
        } else {
            // on first loss, deactivate opposite-mode and fall back to normal logic
            state.oppositeMode.active = false;
            delete state.oppositeMode.dir;
        }
    }

    const currentActiveMode = (state.historyModes.length > 0) ? state.historyModes[state.historyModes.length - 1] : (state.mode === "NORMAL" ? "N" : "R");
    
    if (wasWin) {
        state.consecutivePatternLoss = 0; 
        if (currentActiveMode === "N") {
            state.normalWinsIn20++;
        } else {
            state.recoveryWinsIn20++;
        }
    } else {
        state.consecutivePatternLoss++;

        if (state.mode === "NORMAL") {
            state.mode = "RECOVERY";
            state.historyModes.push("R");
        } else {
            state.mode = "NORMAL";
            state.historyModes.push("N");
        }
        if (state.historyModes.length > 20) {
            state.historyModes.shift();
        }
    }

    if (state.forcedModeQueue && state.forcedModeQueue.length > 0) {
        if (wasWin) {
            state.forcedModeQueue = [];
        } else {
            state.forcedModeQueue.shift(); 
        }
    } 

    if (st) {
        if (!st.virtualLevel) st.virtualLevel = 1;
        const currentVLevel = st.virtualLevel;

        if (!pt.levelStats) pt.levelStats = {};
        if (!pt.levelStats[currentVLevel]) pt.levelStats[currentVLevel] = { wins: 0, total: 0 };
        pt.levelStats[currentVLevel].total++;
        if (wasWin) pt.levelStats[currentVLevel].wins++;

        const predLevel = betPlaced ? st.level : (st.virtualLevel || 1);
        if (!pt.predLevel) pt.predLevel = {};
        if (!pt.predLevel[predLevel]) pt.predLevel[predLevel] = { wins: 0, total: 0 };
        pt.predLevel[predLevel].total++;
        if (wasWin) pt.predLevel[predLevel].wins++;

        pt.predTotal++;
        if (wasWin) {
            pt.predWins++; pt.predCurW++; pt.predCurL = 0;
            if (pt.predCurW > pt.predMaxW) pt.predMaxW = pt.predCurW;
        } else {
            pt.predLosses++; pt.predCurL++; pt.predCurW = 0;
            if (pt.predCurL > pt.predMaxL) pt.predMaxL = pt.predCurL;
        }

        if (betPlaced) {
            const realLevel = st.level;
            if (!pt.levelBets) pt.levelBets = {};
            if (!pt.levelBets[realLevel]) pt.levelBets[realLevel] = { bets:0, wins:0, losses:0, invested:0, profit:0 };
            const lb = pt.levelBets[realLevel];
            const amt = Number(betAmount) || (cfg.customBets && cfg.customBets[realLevel-1]) || (cfg.baseBet * MULT[realLevel-1]);
            lb.bets++;
            lb.invested += amt;
            if (wasWin) {
                lb.wins++;
                lb.profit += (amt * 0.98);
            } else {
                lb.losses++;
                lb.profit -= amt;
            }
        }

        if (wasWin) {
            st.virtualLevel = 1;
        } else {
            st.virtualLevel++;
            if (st.virtualLevel > 20) st.virtualLevel = 1;
        }

        if (betPlaced) {
            // Special handling for Condition-2 immediate bet
            if (state.condition2Immediate) {
                const afterLossSkip = Number(state.condition2Immediate.afterLossSkip) || 6;
                if (wasWin) {
                    st.level = 1;
                    st.consecutiveLoss = 0;
                } else {
                    // do not increment level; record a loss and schedule a skip of N predictions
                    st.consecutiveLoss++;
                    state.isSkipping = true;
                    state.skipCount = 1;
                    state.skipTotal = afterLossSkip;
                    state.skipWatch = true;
                    // after skip, move to next level relative to the immediate bet level (if provided)
                    const immLevel = Number(state.condition2Immediate && state.condition2Immediate.immediateLevel) || Number(st.level) || 1;
                    const nextLvl = immLevel + 1;
                    const maxLvl = (cfg && Number(cfg.maxLvl)) ? Number(cfg.maxLvl) : nextLvl;
                    state.postSkipSetLevel = Math.min(nextLvl, maxLvl);
                }
                delete state.condition2Immediate;
            } else {
                if (wasWin) {
                    st.level = 1;
                    st.consecutiveLoss = 0;
                } else {
                    const lostLevel = st.level;
                    st.consecutiveLoss++;
                    st.level++;

                    const skipPredictions = lostLevel === 8 ? 3 :
                        lostLevel === 5 ? 5 : 0;
                    const watchRequired = {
                        3: 2,
                        4: 3,
                        5:2,
                        6: 2,
                        7: 4,
                        9: 4,
                        10: 4,
                        11: 2,
                        12: 2,
                        13: 2
                    }[lostLevel] || 0;
                    if (skipPredictions > 0) {
                        state.isSkipping = true;
                        state.skipCount = 1;
                        state.skipTotal = skipPredictions;
                    } else if (watchRequired > 0) {
                        state.levelWatchActive = true;
                        state.levelWatchLosses = 0;
                        state.levelWatchTarget = st.level;
                        state.levelWatchRequired = watchRequired;
                    }
                }
            }
        } else {
            // Watch mode (bet kattatha podhu)
            if (state.levelWatchActive && !state.skipWatch) {
                if (wasWin) {
                    state.levelWatchLosses = 0;
                } else {
                    state.levelWatchLosses++;
                }
            } else if (cfg && cfg.watch && !state.skipWatch) {
                if (wasWin) {
                    st.consecutiveLoss = 0; 
                } else {
                    st.consecutiveLoss++; 
                }
            }
            state.skipWatch = false;
        }
    }

        // New rule: if user is suffering 3 consecutive losses (virtual), trigger a 3-prediction skip then set next bet level to L4
        try {
            if (st && st.consecutiveLoss >= 3 && !state.isSkipping && !state.postSkipSetLevel) {
                state.isSkipping = true;
                state.skipCount = 1;
                state.skipTotal = 3;
                state.skipWatch = true;
                state.postSkipSetLevel = 4; // after skip, set level to L4
            }
        } catch (e) {
            console.error('[POST-SKIP SET ERR]', e && e.message);
        }
}

// ============================================================
//  UI HANDLERS & REPORTS
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel, betAmount = null) {
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = Number(betAmount) || cfg.customBets[betLevel-1] || (cfg.baseBet * MULT[betLevel-1]);
    const profit = amt * 0.98;
    updateTrackedBalance(userId, profit);
    
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;

    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN! 🎉              ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Profit : +₹"+profit.toFixed(2)+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Balance: "+trackedBalanceText(userId)+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Streak : "+pt.winStreak+" wins\n"+
"║ Total  : "+pt.wins+"W/"+pt.losses+"L\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
    );
    await sendSticker(chatId, WIN_STICKER);
}

async function handleLoss(userId, chatId, actual, num, betLevel, betAmount = null) {
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = Number(betAmount) || cfg.customBets[betLevel-1] || (cfg.baseBet * MULT[betLevel-1]);
    updateTrackedBalance(userId, -amt);
    const scheduledSkip = betLevel === 8 ? 3 : betLevel === 5 ? 5 : 0;
    const watchRequired = {
        3: 2,
        4: 3,
        6: 2,
        7: 4,
        9: 4,
        10: 4,
        11: 2,
        12: 2,
        13: 2
    }[betLevel] || 0;
    
    pt.totalBets++; pt.losses++; pt.pnl -= amt; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;

    if (scheduledSkip > 0) {
        const nextLevel = betLevel + 1;
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Balance: "+trackedBalanceText(userId)+"\n"+
"║ Skip   : "+scheduledSkip+" predictions\n"+
"║ Next   : L"+nextLevel+" after skip\n"+
"╚══════════════════════════╝"
        );
    } else if (watchRequired > 0) {
        const nextLevel = betLevel + 1;
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Watch  : "+watchRequired+" losses\n"+
"║ Next   : L"+nextLevel+" after watch\n"+
"╚══════════════════════════╝"
        );
    } else if(betLevel < cfg.maxLvl){
        const next = cfg.customBets[st.level-1] || (cfg.baseBet * MULT[st.level-1]);
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╠══════════════════════════╣\n"+
"║ Next L"+st.level+" : ₹"+next+"\n"+
"╚══════════════════════════╝"
        );
    } else {
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  💀 MAX LEVEL LOSS       ║\n"+
"╠══════════════════════════╣\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
        );
    }
    await sendSticker(chatId, LOSS_STICKER);
}

// ============================================================
//  PREDICT LOOP
// ============================================================
async function runPredict(userId, chatId) {
    if(!running[userId]) return;
    if (!hasAccess(userId)) {
        running[userId] = false;
        stopAfterWin[userId] = false;
        await send(chatId, "⏰ Your access has expired. The bot has been stopped.");
        return;
    }
    initUser(userId);
    touchUser(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];

        if (st.isWaiting) {
            if (Date.now() >= st.nextStartTime) {
                st.isWaiting = false;
                profitTrack[userId].pnl = 0; 
                profitTrack[userId].levelBets = {}; 
                profitTrack[userId].predTotal = 0;
                profitTrack[userId].predWins = 0;
                profitTrack[userId].predLosses = 0;
                profitTrack[userId].predMaxW = 0;
                profitTrack[userId].predMaxL = 0;
                profitTrack[userId].predCurW = 0;
                profitTrack[userId].predCurL = 0;
                profitTrack[userId].predLevel = {}; 
                await send(chatId, "🔄 Timed Restart! Starting new section...");
            } else {
                return setTimeout(()=>runPredict(userId,chatId), 30000);
            }
    }

    const list = await fetchList();
    if(!list) return setTimeout(()=>runPredict(userId,chatId), 15000);

    const next = (BigInt(list[0].issueNumber)+1n).toString();
    if(sentPeriods[userId].has(next)) return setTimeout(()=>runPredict(userId,chatId), 2000);
    sentPeriods[userId].add(next);
    while (sentPeriods[userId].size > MAX_SENT_PERIODS) {
        sentPeriods[userId].delete(sentPeriods[userId].values().next().value);
    }

    const signal = decidePrediction(list, st.level, userId);
    // If Condition 2 requested an immediate bet, cancel current skip and mark immediate flag
    try {
        if (signal && signal.action && signal.action.immediateBet) {
            // cancel any active skipping
            state.isSkipping = false;
            state.skipCount = 0;
            state.skipTotal = 0;
            state.skipWatch = false;
            // mark condition2 immediate context so updateAfterResult can handle special loss behavior
            // choose immediate level: explicit action.immediateLevel or next level (st.level + 1)
            const explicitLvl = (signal.action && typeof signal.action.immediateLevel !== 'undefined') ? Number(signal.action.immediateLevel) : null;
            const nextLvl = (st && Number(st.level)) ? Number(st.level) + 1 : 1;
            state.condition2Immediate = { afterLossSkip: Number(signal.action.afterLossSkip) || 6, immediateLevel: explicitLvl || nextLvl };
            await send(chatId, `⚡ Condition 2 triggered — cancelling skip and placing 1 immediate bet (opposite).`);
        }
    } catch (e) {
        console.error('[COND2 IMMEDIATE ERR]', e && e.message);
    }
    // Handle action requests from prediction (e.g., skip N predictions)
    try {
        if (signal && signal.action && signal.action.skip && !state.isSkipping) {
            const skipNum = Number(signal.action.skip) || 5;
            state.isSkipping = true;
            state.skipCount = 1;
            state.skipTotal = skipNum;
            state.skipWatch = true;
            await send(chatId, `⏳ Condition 1 matched — skipping ${state.skipTotal} predictions.`);
            return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
        }
    } catch (e) {
        console.error('[COND1 HANDLER ERR]', e && e.message);
    }
    // If any number appears 3 or more times in the last 5 results, skip next 3 predictions
    try {
        const last5nums = (list.slice(0,5) || []).map(i => {
            const v = i.result || i.number || i.winNumber || i.winResult || i.win || i.win_num || 0;
            return String(v).trim();
        });
        const counts = {};
        for (const n of last5nums) counts[n] = (counts[n] || 0) + 1;
        const repeated = Object.entries(counts).find(([n,c]) => c >= 3 && n !== "0");
        if (repeated && !state.isSkipping) {
            const [num, cnt] = repeated;
            state.isSkipping = true;
            state.skipCount = 1;
            state.skipTotal = 3;
            state.skipWatch = true;
            await send(chatId, `⏳ Detected result ${num} repeated ${cnt} times in last 5 results — skipping ${state.skipTotal} predictions.`);
            return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
        }
    } catch (e) {
        console.error('[SKIP DETECT ERR]', e && e.message);
    }
    if(!signal) return setTimeout(()=>runPredict(userId,chatId), 5000);

    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;

    // 🔥 FIXED: Skip logic & level maintenance. When skipping after 5 losses, level is maintained (NOT reset to L1).
    if (state.isSkipping) {
        const skipTotal = state.skipTotal || 2;
        abLine = `⏳ SKIPPING: ${state.skipCount}/${skipTotal} (L${st.level})`;
        canBet = false;
        state.skipWatch = true;
        state.skipCount++;
        if (state.skipCount > skipTotal) {
            state.isSkipping = false;
            state.skipCount = 0;
            state.skipTotal = 0;
            // Apply post-skip level if requested (e.g., set to L4 after skipping)
            if (state.postSkipSetLevel && st) {
                const newLvl = Number(state.postSkipSetLevel) || 1;
                st.level = newLvl;
                delete state.postSkipSetLevel;
                await send(chatId, `🔁 Skip complete — setting next bet level to L${st.level}.`);
            }
        }
    } else if (signal.val === "SKIP") {
        abLine = "⏭️ SKIP: Big/Small tied";
        canBet = false;
    } else if (!cfg || !cfg.enabled) {
        abLine = "🤖 AutoBet: OFF";
        canBet = false;
    } else if (state.levelWatchActive && state.levelWatchLosses < state.levelWatchRequired) {
        abLine = `👀 WATCH L${state.levelWatchTarget}: ${state.levelWatchLosses}/${state.levelWatchRequired} losses`;
        canBet = false;
    } else if (cfg.watch && st.level === 1 && st.consecutiveLoss < cfg.watchLoss) {
        // Watch mode is ONLY checked before Level 1
        abLine = `👀 WATCHING: ${st.consecutiveLoss}/${cfg.watchLoss}`;
        canBet = false;
    } else {
        if (state.levelWatchActive) {
            state.levelWatchActive = false;
            state.levelWatchTarget = null;
            state.levelWatchLosses = 0;
            state.levelWatchRequired = 0;
        }
        canBet = true;
        const curBet = cfg.customBets[st.level-1] || (cfg.baseBet*MULT[st.level-1]);
        abLine = (st.level > 1 ? "📈 MART " : "💰 BET ") + "L" + st.level + ": ₹" + curBet;
    }

    const patternName = signal && signal.pat ? signal.pat : (state && state.mode ? state.mode : "NORMAL");
    const waitLine = (cfg && cfg.watch && st.level === 1 && st.consecutiveLoss < cfg.watchLoss) ? "\nWatch Loss: " + st.consecutiveLoss + "/" + cfg.watchLoss : "";

    await send(chatId,
"╔══════════════════════════╗\n"+
"║     👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Signal  : "+(signal.val==="SKIP"?"⏭️ SKIP":signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")+"\n"+
"║ Pattern : "+patternName+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
waitLine+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

    if (signal.val === "SKIP") {
        return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
    }

    let betPlaced = false;
    let betAmount = null;
    let levelToUse = st.level;
    if (canBet) {
        levelToUse = (state.condition2Immediate && state.condition2Immediate.immediateLevel) || (signal.action && signal.action.immediateLevel) || st.level;
        const result = await placeBet(userId, chatId, next, signal.val, signal.type, levelToUse);
        if (result && result.ok) {
            betPlaced = true;
            betAmount = result.amt;
            activeBets[userId] = true;
            await send(chatId, "✅ Bet Success! ₹" + result.amt + " L" + levelToUse + "\n⏳ Checking result...");
        } else if (result && !result.ok) {
            await send(chatId, "❌ Bet Failed: " + (result.msg || "Unknown error"));
        } else {
            await send(chatId, "❌ Bet was not placed. No level or watch update applied.");
        }
    }

    if (canBet && !betPlaced) {
        const retryLvl = (state.condition2Immediate && state.condition2Immediate.immediateLevel) || (signal.action && signal.action.immediateLevel) || st.level;
        await send(chatId, "🔁 Bet not placed. Retrying the same L" + retryLvl + " on the next period...");
        return setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
    }

    checkResult(userId, chatId, next, signal.val, signal.type, betPlaced, betAmount, levelToUse);
}

// ============================================================
//  RESULT CHECKER
// ============================================================
async function checkResult(userId, chatId, target, predicted, predType, betPlaced, betAmount = null, betLevel = null) {
    let tries = 0;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    
    const iv = setInterval(async () => {
        if (!running[userId] && !activeBets[userId]) return clearInterval(iv);
        if (++tries > 25) {
            tries = 0;
            await logBoth(chatId, "⏱ Target period not available yet. Retrying the same prediction...");
            return;
        }
        const list = await fetchList(); if (!list) return;
        if (BigInt(list[0].issueNumber) < BigInt(target)) return;

        const res = list.find(i => String(i.issueNumber) === String(target));
        if (!res) {
            console.error(`[RESULT] Period ${target} was not returned; refusing to settle against another period.`);
            return;
        }
        clearInterval(iv);
        delete activeBets[userId];
        const num = parseInt(res.number || res.winNumber || 0);
        let actual;
        if (predType === "SIZE") actual = num >= 5 ? "BIG" : "SMALL";
        else actual = num === 0 ? "RED" : num === 5 ? "GREEN" : num % 2 === 0 ? "RED" : "GREEN";
        
        const win = predicted === actual;
        const settledBetLevel = betLevel || st.level;

        updateAfterResult(userId, win, actual, betPlaced, betAmount);

        const s = stats[userId];
        s.total++;
        if (win) {
            s.win++; s.winStreak++; s.lossStreak = 0;
            if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak;
        } else {
            s.loss++; s.lossStreak++; s.winStreak = 0;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        }

        if (betPlaced) {
            if (win) await handleWin(userId, chatId, actual, num, settledBetLevel, betAmount);
            else await handleLoss(userId, chatId, actual, num, settledBetLevel, betAmount);

            if (!hasAccess(userId)) {
                running[userId] = false;
                stopAfterWin[userId] = false;
                await send(chatId, "⏰ Your access has expired. The bot has been stopped after settling the current bet.");
                return;
            }

            

            if (win && stopAfterWin[userId]) {
                const ownerChatId = stopAfterWin[userId];
                running[userId] = false;
                stopAfterWin[userId] = false;
                if (ownerChatId === userId) {
                    await send(chatId, "✅ Bet WIN received. Your bot is now stopped.");
                } else {
                    await send(chatId, "🛑 Owner stopped the bot after your bet WIN. Bot is now stopped.");
                    await send(ownerChatId, "✅ User " + userId + " won the current bet and was stopped by Stop All Users.");
                }
                return;
            }

            const targetProfit = Number(cfg.targetProfit) || 1000;
            if (pt.pnl >= targetProfit) {
                st.isWaiting = true;
                st.nextStartTime = Date.now() + (Number(cfg.restartDelay) || 1) * 60 * 1000;
                await send(chatId, "🎯 TARGET REACHED! Bot Paused.");
            }
        } else {
            if (win) {
                await send(chatId, 
                    "╔══════════════════════════╗\n"+
                    "║  👀 WATCH RESULT: WIN! ✅ ║\n"+
                    "╠══════════════════════════╣\n"+
                    "║ Number : "+num+"\n"+
                    "║ Result : "+actual+"\n"+
                    "║ Status : Correct Prediction\n"+
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, WIN_STICKER);
            } else {
                await send(chatId, 
                    "╔══════════════════════════╗\n"+
                    "║  👀 WATCH RESULT: LOSS ❌ ║\n"+
                    "╠══════════════════════════╣\n"+
                    "║ Number : "+num+"\n"+
                    "║ Result : "+actual+"\n"+
                    "║ Status : Incorrect Prediction\n"+
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, LOSS_STICKER);
            }
        }

        setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000);
    }, 10000);
}

// ============================================================
//  STATS & REPORT HELPERS
// ============================================================
function buildLevelAnalysis(pt, maxShow){
    const lb = pt.levelBets || {};
    const maxReached = Object.keys(lb).length ? Math.max(...Object.keys(lb).map(Number)) : 0;
    const upTo = Math.min(maxReached, maxShow || 20);
    let totalInv = 0, totalProfit = 0, totalBets = 0, totalWins = 0, totalLosses = 0;
    let lines = [];
    for (let i = 1; i <= upTo; i++) {
        const d = lb[i];
        if (!d || (d.bets === 0)) continue;
        const rate = ((d.wins / d.bets) * 100).toFixed(0);
        lines.push("L"+i+": "+d.wins+"W/"+d.losses+"L ("+rate+"%)  ₹"+(d.profit>=0?"+":"")+d.profit.toFixed(2));
        totalInv += d.invested; totalProfit += d.profit;
        totalBets += d.bets; totalWins += d.wins; totalLosses += d.losses;
    }
    const overallRate = totalBets ? ((totalWins/totalBets)*100).toFixed(1) : "0.0";
    return {
        lines,
        summary: "SUMMARY: "+totalBets+"B | "+totalWins+"W/"+totalLosses+"L ("+overallRate+"%)",
        totalInv, totalProfit
    };
}

function showStats(chatId,userId){
    const d=stats[userId],rate=d.total?((d.win/d.total)*100).toFixed(1):"0.0";
    const pt2 = profitTrack[userId] || {};
    const predRate = pt2.predTotal ? ((pt2.predWins/pt2.predTotal)*100).toFixed(1) : "0.0";
    const predBar = "🟦".repeat(pt2.predTotal?Math.round(pt2.predWins/pt2.predTotal*10):0)+"⬜".repeat(pt2.predTotal?10-Math.round(pt2.predWins/pt2.predTotal*10):10);
    const bar="🟦".repeat(d.total?Math.round(d.win/d.total*10):0)+"⬜".repeat(d.total?10-Math.round(d.win/d.total*10):10);
    
    let levelReport = "📊 LEVEL CHART:\n";
    const pt = profitTrack[userId];
    if (pt && pt.levelStats) {
        const maxReached = Math.max(...Object.keys(pt.levelStats).map(Number), 1);
        let levelLines = [];
        for (let i = 1; i <= Math.min(maxReached, 20); i++) {
            const ls = pt.levelStats[i] || { wins: 0, total: 0 };
            if (ls.wins > 0 || ls.total > 0) {
                levelLines.push(`L${i}:${ls.wins}`);
            }
        }
        levelReport += levelLines.join(" ") + "\n";
    }

    const la = buildLevelAnalysis(pt, 20);
    let laReport = "";
    if (la.lines.length > 0) {
        laReport = "📊 LVL (Bet Success): " + la.lines.join(" | ") + "\n";
        laReport += "💰 Lvl P&L: " + (la.totalProfit >= 0 ? "+" : "") + la.totalProfit.toFixed(2) + "\n";
    }

    let allLvlStr = "";
    if (pt2.predLevel) {
        const maxP = Object.keys(pt2.predLevel).length ? Math.max(...Object.keys(pt2.predLevel).map(Number)) : 0;
        let pLines = [];
        for (let i = 1; i <= Math.min(maxP, 20); i++) {
            const p = pt2.predLevel[i];
            if (p && p.total > 0) pLines.push("L" + i + ": " + p.wins + "W");
        }
        allLvlStr = pLines.length ? pLines.join(" ") + "\n" : "";
    }

    send(chatId,"📊 STATS\n\nTotal: "+d.total+"\nWins: "+d.win+"\nLosses: "+d.loss+"\nAcc: "+rate+"%\n"+bar+"\n\n" + levelReport + "\n" + laReport + "\nBest Win: "+d.maxWinStreak+" streak\nWorst Loss: "+d.maxLossStreak+" streak"+
    "\n\n📈 ALL PREDICTIONS (Bet+Watch+Skip):\nTotal: "+pt2.predTotal+"\nWins: "+pt2.predWins+"\nLoss: "+pt2.predLosses+"\nAcc: "+predRate+"%\n"+predBar+"\n"+allLvlStr+"Best W: "+pt2.predMaxW+" | Worst L: "+pt2.predMaxL);
}

async function profitReport(chatId,userId){
    initUser(userId);
    const pt=profitTrack[userId],cfg=autobetCfg[userId];
    const amounts=cfg.customBets.slice(0,cfg.maxLvl);
    const la = buildLevelAnalysis(pt, 20);

    let balance = "❌ No token";
    const balResult = await getLiveBalance(userId);
    if(balResult.success){
        balance = "₹"+balResult.balance;
    } else if (balResult.message){
        balance = "⚠️ "+balResult.message;
    }

    let report =
"💰 PROFIT REPORT\n\n"+
"Live Balance: "+balance+"\n"+
"Tracked Balance: "+trackedBalanceText(userId)+"\n\n";

    if (la.lines.length > 0) {
        report += "📊 L1-L"+la.lines.length+" ANALYSIS (Bet Success Only):\n";
        report += la.lines.join("\n") + "\n\n";
        report += "📈 " + la.summary + "\n";
        report += "💵 Invested: ₹"+la.totalInv.toFixed(2)+"\n";
        report += "💰 Lvl Profit: "+(la.totalProfit>=0?"+":"")+la.totalProfit.toFixed(2)+"\n\n";
    } else {
        report += "📊 Lvl Analysis: No placed bets yet\n\n";
    }

    report +=
"Bets   : "+pt.totalBets+"\nWins   : "+pt.wins+"\nLoss   : "+pt.losses+"\n"+
"P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"Balance: "+trackedBalanceText(userId)+"\n"+
"Best W : "+pt.maxW+" | Worst L: "+pt.maxL+"\n\n"+
"Mart: ₹"+amounts.join("→₹");

    send(chatId, report);
}

function allUsersProfitStatsReport() {
    const ids = new Set([
        ...Object.keys(usersAccess),
        ...Object.keys(stats),
        ...Object.keys(profitTrack),
        ...Object.keys(autobetCfg),
        ...Object.keys(running)
    ]);
    const userIds = [...ids].filter(uid => !isOwner(uid));
    if (!userIds.length) return "No users found.";

    let totalBets = 0, totalWins = 0, totalLosses = 0, totalInvested = 0, totalPnl = 0;
    let report = "📊 ALL USERS PROFIT & STATS\n\n";

    userIds.forEach(uid => {
        initUser(uid);
        const d = stats[uid];
        const pt = profitTrack[uid];
        const st = autobetState[uid];
        const accuracy = pt.totalBets ? ((pt.wins / pt.totalBets) * 100).toFixed(1) : "0.0";
        const pnl = Number(pt.pnl) || 0;
        const invested = Number(pt.totalBetAmount) || 0;
        const predAccuracy = pt.predTotal ? ((pt.predWins / pt.predTotal) * 100).toFixed(1) : "0.0";

        totalBets += pt.totalBets || 0;
        totalWins += pt.wins || 0;
        totalLosses += pt.losses || 0;
        totalInvested += invested;
        totalPnl += pnl;

        report += `👤 ${uid}\n`;
        report += `💵 Invested: ₹${invested.toFixed(2)} | P&L: ₹${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}\n`;
        report += `🎯 Bets: ${pt.totalBets} | ${pt.wins}W/${pt.losses}L (${accuracy}%)\n`;
        report += `📈 Predictions: ${pt.predTotal || 0} | ${pt.predWins || 0}W/${pt.predLosses || 0}L (${predAccuracy}%)\n`;
        report += `🔥 Streak: ${pt.winStreak || 0}W / ${pt.lossStreak || 0}L | Level: L${autobetState[uid].level}\n`;
        report += `⚙️ AutoBet: ${autobetCfg[uid].enabled ? "ON" : "OFF"}\n`;
        report += "------------------------\n";
    });

    const overallAccuracy = totalBets ? ((totalWins / totalBets) * 100).toFixed(1) : "0.0";
    report += "\n📌 TOTAL\n";
    report += `💵 Invested: ₹${totalInvested.toFixed(2)}\n`;
    report += `💰 P&L: ₹${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}\n`;
    report += `🎯 Bets: ${totalBets} | ${totalWins}W/${totalLosses}L (${overallAccuracy}%)`;
    return report;
}

async function autobetStatus(chatId, userId) {
    initUser(userId);
    const cfg = autobetCfg[userId], st = autobetState[userId], pt = profitTrack[userId];
    const amounts = cfg.customBets.slice(0, cfg.maxLvl);
    const creds = userCreds[userId] || {};

    let liveBal = "❌ No token";
    let token = getToken(userId);
    const hasToken = token && token.length > 20;
    if (hasToken) {
        const result = await getLiveBalance(userId);
        if (result.success) {
            liveBal = "₹" + result.balance;
        } else {
            liveBal = "⚠️ " + result.message;
        }
    } else if (creds.phone) {
        liveBal = "❌ Login Required";
    }

    let waitLine = "";
    if (st.isWaiting) {
        const diff = Math.round((st.nextStartTime - Date.now()) / 60000);
        waitLine = "\n⏳ Waiting: " + diff + " mins to restart";
    }

    let levelWinStr = "";
    if (pt && pt.levelStats) {
        const maxReached = Math.max(...Object.keys(pt.levelStats).map(Number), 1);
        for (let i = 1; i <= Math.min(maxReached, 20); i++) {
            const ls = pt.levelStats[i] || { wins: 0, total: 0 };
            levelWinStr += `L${i}:${ls.wins} `;
        }
    }

    const la = buildLevelAnalysis(pt, 20);
    let laReport = "";
    if (la.lines.length > 0) {
        laReport = "📊 Lvl (Bet Success): " + la.lines.join(" | ") + "\n";
        laReport += "💰 Lvl P&L: " + (la.totalProfit >= 0 ? "+" : "") + la.totalProfit.toFixed(2) + "\n";
    }

    send(chatId,
"🤖 AUTOBET STATUS\n\n"+
"💰 Live Balance: "+liveBal+"\n"+
"Enabled  : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(token.length>20?"✅":"❌")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+st.consecutiveLoss+"/"+cfg.watchLoss+"\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target Profit: ₹"+cfg.targetProfit+"\n"+
"Section Delay: "+cfg.restartDelay+" mins"+ 
waitLine+"\n"+
"In Mart  : "+(st.inMart?"YES":"NO")+"\n"+
"P&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"Tracked Balance: "+trackedBalanceText(userId)+"\n"+
"Level Wins: "+levelWinStr.trim()+"\n"+laReport+"\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}

async function stopAllUsers(ownerChatId) {
    allUsersStopped = true;
    const ids = new Set([
        ...Object.keys(usersAccess),
        ...Object.keys(stats),
        ...Object.keys(profitTrack),
        ...Object.keys(running)
    ]);
    const stoppedNow = [];
    const waitingForWin = [];

    for (const uid of ids) {
        if (isOwner(uid) || !running[uid]) continue;
        if (activeBets[uid]) {
            stopAfterWin[uid] = ownerChatId;
            waitingForWin.push(uid);
            await send(uid, "🛑 Owner stopped the bot for all users. Your current bet will finish, then your bot will stop after a WIN.");
        } else {
            running[uid] = false;
            stopAfterWin[uid] = false;
            stoppedNow.push(uid);
            await send(uid, "🛑 Owner stopped the bot for all users. Your bot is now stopped.");
        }
    }

    let report = "🛑 STOP ALL USERS COMPLETE\n\n";
    report += `Stopped now: ${stoppedNow.length}\n`;
    report += `Waiting for current WIN: ${waitingForWin.length}\n`;
    if (stoppedNow.length) report += "\nStopped: " + stoppedNow.join(", ");
    if (waitingForWin.length) report += "\nWaiting: " + waitingForWin.join(", ");
    await send(ownerChatId, report);
}

async function startAllUsers(ownerChatId) {
    allUsersStopped = false;
    const ids = new Set([
        ...Object.keys(usersAccess),
        ...Object.keys(stats),
        ...Object.keys(profitTrack),
        ...Object.keys(running)
    ]);
    const started = [];

    for (const uid of ids) {
        if (isOwner(uid) || !hasAccess(uid) || running[uid]) continue;
        initUser(uid);
        running[uid] = true;
        sentPeriods[uid] = new Set();
        stopAfterWin[uid] = false;
        delete activeBets[uid];
        autobetState[uid] = {level:1,virtualLevel:1,consecutiveLoss:0,inMart:false};
        userStates[uid].isSkipping = false;
        userStates[uid].skipCount = 0;
        userStates[uid].skipTotal = 0;
        userStates[uid].skipWatch = false;
        userStates[uid].levelWatchActive = false;
        userStates[uid].levelWatchLosses = 0;
        userStates[uid].levelWatchTarget = null;
        userStates[uid].levelWatchRequired = 0;
        started.push(uid);
        await send(uid, "▶️ Owner started the bot for all users. Your bot is now running.");
        runPredict(uid, uid);
    }

    let report = "▶️ START ALL USERS COMPLETE\n\n";
    report += `Started: ${started.length}`;
    if (started.length) report += "\nUsers: " + started.join(", ");
    await send(ownerChatId, report);
}

// ============================================================
//  KEYBOARDS
// ============================================================
function userMenu(id){
    const rows=[["▶️ Start Prediction","🛑 Stop"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
    if(isAdmin(id))rows.push(["👑 Admin Panel"]);
    return{keyboard:rows,resize_keyboard:true};
}
const ownerMenu={keyboard:[["👥 All Users","👮 All Admins"],["📊 All Profit & Stats","📊 All Status"],["🛑 Stop All Users","▶️ Start All Users"],["👤 Add Admin","🗑 Remove Admin"],["🔑 Generate Key","📋 All Keys"],["🟢 Add User","🔴 Remove User"],["🔐 Set Token","🚪 Owner Logout"]],resize_keyboard:true};
const adminMenu={keyboard:[["👥 Active Users","🔑 Generate Key"],["🟢 Add User","🔴 Remove User"],["📋 All Keys","🚪 Admin Logout"]],resize_keyboard:true};
const autobetMenu={keyboard:[
    ["✅ Enable AutoBet","❌ Disable AutoBet"],
    ["👀 Watch Mode ON","👀 Watch Mode OFF"],
    ["💰 Set Base Bet","💳 Set Balance"],["📈 Set Max Level"],
    ["🎯 Set Profit Target", "⏳ Set Section Delay"],
    ["🔢 Set Watch Losses","📊 AutoBet Status"],
    ["📝 Set Custom Bets","🔙 Back"]
],resize_keyboard:true};

// ============================================================
//  BOT INIT & HANDLERS
// ============================================================
let bot;
let pollingRecovery = false;
function recoverPolling(err) {
    if (pollingRecovery || !bot) return;
    pollingRecovery = true;
    console.warn("[POLL] Recovering from polling error:", err?.message || err);
    bot.stopPolling().catch(() => {});
    setTimeout(() => {
        try {
            bot.startPolling();
            console.log("[POLL] Polling restarted successfully.");
        } catch (e) {
            console.error("[POLL] Polling restart failed:", e?.message || e);
        } finally {
            pollingRecovery = false;
        }
    }, 5000);
}

function startBot(){
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("ECONNRESET") || msg.includes("EFATAL") || msg.includes("socket hang up")) {
            recoverPolling(err);
            return;
        }
        console.error("Poll:", msg);
    });
    bot.on("error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("ECONNRESET") || msg.includes("EFATAL") || msg.includes("socket hang up")) {
            console.warn("Bot error recovered:", msg);
            return;
        }
        console.error("Bot:", msg);
    });
    addHandlers();
    console.log("✅ SIVA BOT running...");
}

async function send(chatId,text,opts={}){
    try{return await bot.sendMessage(chatId,text,opts);}
    catch(e){if(e.message&&e.message.includes("parse entities")){try{const o={...opts};delete o.parse_mode;return await bot.sendMessage(chatId,text,o);}catch(e2){}}console.error("send:",e.message?.substr(0,60));}
}
async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

function addHandlers(){
    bot.onText(/\/start/,(msg)=>{
        const id=msg.from.id;
        const username = msg.from.username ? `@${msg.from.username}` : "No username";
        const firstName = msg.from.first_name || "Unknown";
        const isNewUser = !stats[id] && !autobetCfg[id];
        initUser(id);
        const cfg = autobetCfg[id];
        const configSummary =
            `⚙️ Configuration\n`+
            `AutoBet: ${cfg.enabled ? "ON" : "OFF"}\n`+
            `Base bet: ₹${cfg.baseBet}\n`+
            `Starting balance: ${Number(cfg.startingBalance) > 0 ? "₹" + cfg.startingBalance : "Not set"}\n`+
            `Max level: L${cfg.maxLvl}\n`+
            `Watch mode: ${cfg.watch ? "ON" : "OFF"}\n`+
            `Watch losses: ${cfg.watchLoss}\n`+
            `Profit target: ₹${cfg.targetProfit}\n`+
            `Restart delay: ${cfg.restartDelay} min\n`+
            `Custom bets: ₹${(cfg.customBets || []).join(" → ₹")}\n\n`+
            `⚠️ DISCLAIMER\n`+
            `Lucifer AI Trade signals are for informational purposes only.\n`+
            `Trading involves risk, and profits are not guaranteed.\n`+
            `Trade responsibly and manage your risk.\n\n`+
            `🔐 Login Setup\n`+
            `/setcreds FULLPHONE PASSWORD\n`+
            `Then use /login to test login.\n`+
            `Or use /setmytoken TOKEN for a manual token.`;

        // 🔥 FIXED: Notify owner when anyone starts the bot with their Name, Username, and ID!
        try {
            OWNER_IDS.forEach(ownerId => bot.sendMessage(ownerId,
                `🔔 *NEW USER STARTED BOT!*\n\n` +
                `👤 Name: ${firstName}\n` +
                `🏷 Username: ${username}\n` +
                `🆔 ID: \`${id}\`\n\n` +
                (isNewUser ? configSummary : "⚙️ Existing user started the bot."),
                { parse_mode: "Markdown" }
            ).catch(() => {}));
        } catch (err) {}

        const status=hasAccess(id)?"✅ ACTIVE — "+daysLeft(id)+"d left":"❌ NO ACCESS";
        send(msg.chat.id,
"╔══════════════════════════╗\n║  👑EARN WITH ME BOT    ║\n╠══════════════════════════╣\n"+
"║ Status : "+status+"\n║ ID     : "+id+"\n║ Admin  : "+ADMIN_HANDLE+"\n╠══════════════════════════╣\n"+
"║ /key CODE to activate    ║\n╚══════════════════════════╝",
        {reply_markup:userMenu(id)});
    if (isNewUser) send(id, configSummary);
    });

    bot.onText(/\/key (.+)/,(msg,match)=>{
        const id=msg.from.id;initUser(id);
        const res=activateKey(id,match[1].trim());
        if(res.ok){send(msg.chat.id,"🎊 KEY ACTIVATED!\n⏳ "+res.days+" days\n📅 "+res.expiry,{reply_markup:userMenu(id)});OWNER_IDS.forEach(ownerId=>send(ownerId,"🔔 Key used!\nUser: "+id+"\nDays: "+res.days));}
        else send(msg.chat.id,res.msg);
    });

    bot.onText(/\/setcreds (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const parts=match[1].trim().split(/\s+/);
        if(parts.length<2)return send(id,"❌ Format:\n/setcreds FULLPHONE PASSWORD\n\nExample:\n/setcreds 916381605525 mypassword");
        const phone=parts[0],pass=parts.slice(1).join(" ");
        if(!userCreds[id])userCreds[id]={};
        userCreds[id].phone=phone;userCreds[id].pass=pass;
        send(id,"✅ Saved!\n📱 "+phone+"\n🔄 Testing login...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/setmytoken (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const tok=match[1].trim().replace(/^Bearer\s+/i,"");
        if(tok.length<20)return send(id,"❌ Token too short!");
        userTokens[id]=tok;
        send(id,"✅ Token saved!\n..."+tok.slice(-12)+"\n\n🤖 AutoBet Setup → ✅ Enable");
    });

    bot.onText(/\/login/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        send(id,"🔄 Logging in...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/owner/,(msg)=>{
        const id = msg.from.id;
        if(!isOwner(id))return;
        ownerLoggedIn = true;
        ownerState = null;
        return send(id,"👑 Owner access granted!",{reply_markup:ownerMenu});
    });

    bot.onText(/\/stopall/,(msg)=>{
        const id = msg.from.id;
        if (!isOwner(id)) return;
        return stopAllUsers(id);
    });

    bot.onText(/\/startall/,(msg)=>{
        const id = msg.from.id;
        if (!isOwner(id)) return;
        return startAllUsers(id);
    });

    bot.onText(/\/adminlogin (.+)/,(msg,match)=>{
        const id=msg.from.id,pass=match[1].trim();
        if(!isAdmin(id))return send(id,"Not admin.");
        if(pass===adminPasswords[id]){adminLoggedIn[id]=true;send(id,"✅ Admin Login!",{reply_markup:adminMenu});}
        else send(id,"❌ Wrong!");
    });

    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
        initUser(id);

        const OB=["👥 All Users","👮 All Admins","📊 All Profit & Stats","📊 All Status","🛑 Stop All Users","▶️ Start All Users","👤 Add Admin","🗑 Remove Admin","🔑 Generate Key","📋 All Keys","🟢 Add User","🔴 Remove User","🔐 Set Token","🚪 Owner Logout"];
        const AB=["👥 Active Users","🔑 Generate Key","🟢 Add User","🔴 Remove User","📋 All Keys","🚪 Admin Logout"];

        if(isOwner(id)&&ownerState){
            const s=ownerState;
            if(s.action==="login"){if(text===OWNER_PASS){ownerLoggedIn=true;ownerState=null;return send(id,"👑 Welcome!",{reply_markup:ownerMenu});}else return send(id,"❌ Wrong!");}
            if(OB.includes(text)){ownerState=null;}
            else if(s.action==="addadmin"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");ownerState={action:"addadmin",step2:true,tid:t};return send(id,"ID:"+t+"\nPassword:");}else{if(text.length<6)return send(id,"❌ Min 6");adminPasswords[s.tid]=text;adminLoggedIn[s.tid]=false;ownerState=null;send(id,"✅ Admin: "+s.tid,{reply_markup:ownerMenu});send(s.tid,"🎉 Admin!\n/adminlogin "+text);return;}}
            else if(s.action==="removeadmin"){const t=parseInt(text);if(isNaN(t))return;delete adminPasswords[t];delete adminLoggedIn[t];ownerState=null;send(id,"🚫 Removed",{reply_markup:ownerMenu});return;}
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌ Days?");const k=generateKey(d,id);ownerState=null;return send(id,"🔑 Key:\n\n"+k+"\n\n"+d+"d\n/key "+k,{reply_markup:ownerMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");ownerState={action:"adduser",step2:true,tid:t};return send(id,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌");usersAccess[s.tid]=Date.now()+d*86400000;ownerState=null;send(id,"✅ "+s.tid+" "+d+"d",{reply_markup:ownerMenu});send(s.tid,"🎊 VIP! "+d+" days\n▶️ Start Prediction!");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(isOwner(t))return send(id,"❌ Owner access cannot be removed.",{reply_markup:ownerMenu});const was=hasAccess(t);delete usersAccess[t];running[t]=false;ownerState=null;send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:ownerMenu});if(was)send(t,"🔴 Access removed.");return;}
            else if(s.action==="settoken"){GLOBAL_TOKEN=text.trim().replace(/^Bearer\s+/i,"");ownerState=null;return send(id,"✅ Global Token set!",{reply_markup:ownerMenu});}
        }

        if(isOwner(id)&&ownerLoggedIn){
            if(text==="👥 All Users")    return send(id,"👥\n\n"+activeUsersList());
            if(text==="👮 All Admins")   return send(id,"👮\n\n"+adminList());
            if(text==="📊 All Profit & Stats") return send(id, allUsersProfitStatsReport());
            if(text==="🛑 Stop All Users") return stopAllUsers(id);
            if(text==="▶️ Start All Users") return startAllUsers(id);
            if(text==="👤 Add Admin")    {ownerState={action:"addadmin"};return send(id,"User ID:");}
            if(text==="🗑 Remove Admin") {ownerState={action:"removeadmin"};return send(id,"Admin ID:");}
            if(text==="🔑 Generate Key") {ownerState={action:"genkey"};return send(id,"Days?");}
            if(text==="📋 All Keys")     return send(id,"📋\n\n"+allKeysList());
            if(text==="🟢 Add User")     {ownerState={action:"adduser"};return send(id,"User ID:");}
            if(text==="🔴 Remove User")  {ownerState={action:"removeuser"};return send(id,"User ID?");}
            if(text==="🔐 Set Token")    {ownerState={action:"settoken"};return send(id,"Token paste:");}
            if(text==="📊 All Status")    {
                const ids = Object.keys(usersAccess);
                if(ids.length === 0) return send(id, "No users found.");
                let report = "📊 TEAM MEMBERS ALL STATUS 📊\n\n";
                ids.forEach(uid => {
                    initUser(uid);
                    const pt = profitTrack[uid];
                    const pnlStr = (pt.pnl >= 0 ? "+" : "") + pt.pnl.toFixed(2);
                    report += `👤 ID: ${uid}\n`;
                    report += `💰 Total Bet: ₹${(pt.totalBetAmount || 0).toFixed(2)}\n`;
                    report += `💳 Balance: ${trackedBalanceText(uid)}\n`;
                    report += `📈 Profit: ₹${pnlStr}\n`;
                    report += `📊 Win/Loss: ${pt.wins}W / ${pt.losses}L\n`;
                    report += `------------------------\n`;
                });
                return send(id, report);
            }
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(id,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(isAdmin(id) && isAdminIn(id) && adminState[id]){
            const s = adminState[id];
            if(AB.includes(text)){ delete adminState[id]; }
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌ Days?");const k=generateKey(d,id);delete adminState[id];return send(id,"🔑 Key:\n\n"+k+"\n\n"+d+"d",{reply_markup:adminMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");adminState[id]={action:"adduser",step2:true,tid:t};return send(id,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌");usersAccess[s.tid]=Date.now()+d*86400000;delete adminState[id];send(id,"✅ "+s.tid+" "+d+"d",{reply_markup:adminMenu});send(s.tid,"🎊 ACCESS! "+d+"d");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(isOwner(t))return send(id,"❌ Owner access cannot be removed.",{reply_markup:adminMenu});const was=hasAccess(t);delete usersAccess[t];running[t]=false;delete adminState[id];send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:adminMenu});if(was)send(t,"🔴 Removed.");return;}
        }

        if(hasAccess(id) && userAction[id]){
            const s = userAction[id];
            if(text === "🔙 Back") { delete userAction[id]; }
            else if(s.action === "setbase"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1) return send(id, "❌ Invalid Amount! Min ₹1.");
                autobetCfg[id].baseBet = v;
                delete userAction[id];
                const a = MULT.slice(0, autobetCfg[id].maxLvl).map(m => v * m);
                return send(id, "✅ Base Bet Updated: ₹" + v + "\nMartingale: ₹" + a.join("→₹"), {reply_markup: autobetMenu});
            }
            else if(s.action === "setbalance"){
                const v = Number(text);
                if(!Number.isFinite(v) || v <= 0) return send(id, "❌ Invalid balance! Enter an amount greater than ₹0.");
                autobetCfg[id].startingBalance = v;
                profitTrack[id].currentBalance = v;
                delete userAction[id];
                return send(id, "✅ Starting balance set: ₹" + v.toFixed(2) + "\nCurrent balance: ₹" + v.toFixed(2), {reply_markup: autobetMenu});
            }
            else if(s.action === "setlvl"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1 || v > 15) return send(id, "❌ Invalid Level! Enter 1-15.");
                autobetCfg[id].maxLvl = v;
                delete userAction[id];
                const a = MULT.slice(0, v).map(m => autobetCfg[id].baseBet * m);
                return send(id, "✅ Max Level Updated: L" + v + "\nMartingale: ₹" + a.join("→₹"), {reply_markup: autobetMenu});
            }
            else if(s.action === "setwloss"){
                const v = parseInt(text);
                if(isNaN(v) || v < 0) return send(id, "❌ Invalid Number!");
                autobetCfg[id].watchLoss = v;
                delete userAction[id];
                return send(id, "✅ Watch Loss Updated: " + v + "\n(Bot will wait for " + v + " losses before betting)", {reply_markup: autobetMenu});
            }
            else if(s.action === "settarget"){
                const v = Number(text);
                if(!Number.isFinite(v) || v < 10) return send(id, "❌ Min ₹10 kudunga!");
                autobetCfg[id].targetProfit = v;
                delete userAction[id];
                return send(id, "✅ Profit target set to ₹"+v, {reply_markup: autobetMenu});
            }
            else if(s.action === "setdelay"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1) return send(id, "❌ Invalid minutes!");
                autobetCfg[id].restartDelay = v;
                delete userAction[id];
                return send(id, "✅ Section delay set to "+v+" minutes", {reply_markup: autobetMenu});
            }
            else if(s.action === "setcustom"){
                const vals = text.split(/[, ]+/).map(v => parseInt(v.trim())).filter(v => !isNaN(v) && v > 0);
                if(vals.length === 0) return send(id, "❌ Format error! Use: 1,4,7,9");
                if(vals.length > MULT.length) return send(id, "❌ Maximum 15 custom levels allowed.");
                autobetCfg[id].customBets = vals;
                autobetCfg[id].maxLvl = vals.length;
                delete userAction[id];
                return send(id, "✅ Custom Bets Updated!\nLevels: " + vals.length + "\nSequence: ₹" + vals.join(" → ₹"), {reply_markup: autobetMenu});
            }
        }

        if(isAdmin(id)&&isAdminIn(id)){
            if(text==="👥 Active Users") return send(id,"👥\n\n"+activeUsersList());
            if(text==="🔑 Generate Key") {adminState[id]={action:"genkey"};return send(id,"Days?");}
            if(text==="🟢 Add User")     {adminState[id]={action:"adduser"};return send(id,"User ID?");}
            if(text==="🔴 Remove User")  {adminState[id]={action:"removeuser"};return send(id,"User ID?");}
            if(text==="📋 All Keys")     return send(id,"📋\n\n"+allKeysList());
            if(text==="🚪 Admin Logout") {adminLoggedIn[id]=false;return send(id,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(text==="👑 Admin Panel"&&isAdmin(id)){
            if(!isAdminIn(id))return send(id,"Login:\n/adminlogin YOUR_PASS");
            return send(id,"👑 Admin",{reply_markup:adminMenu});
        }

        if(text==="🤖 AutoBet Setup"){
            if(!hasAccess(id))return send(id,"❌ No access.");
            const cfg=autobetCfg[id],creds=userCreds[id]||{};
            const amounts=MULT.slice(0,cfg.maxLvl).map(m=>cfg.baseBet*m);
            const targetProfit = Number(cfg.targetProfit) || 1000;
            return send(id,
"🤖 AUTOBET SETTINGS\n\n"+
"Status   : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(id).length>20?"✅ SET":"❌ MISSING")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌ /setcreds")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+cfg.watchLoss+" consecutive\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target   : ₹"+targetProfit+"\n\n"+
"Mart: ₹"+amounts.join("→₹")+"\n\n"+
"/setcreds 916381605525 PASSWORD\n"+
"/setmytoken TOKEN",
            {reply_markup:autobetMenu});
        }

        if(text==="✅ Enable AutoBet"){
            const creds=userCreds[id]||{};
            if(!getToken(id)&&!creds.phone)return send(id,"❌ /setcreds FULLPHONE PASSWORD\nor /setmytoken TOKEN");
            autobetCfg[id].enabled=true;
            if(!getToken(id)&&creds.phone){
                send(id,"🔄 Auto login...");
                const ok=await autoLogin(id,msg.chat.id,true);
                if(ok)send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
                else send(id,"⚠️ Login fail. /setcreds பண்ணு.",{reply_markup:autobetMenu});
            } else {
                send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
            }
            return;
        }
        if(text==="❌ Disable AutoBet"){autobetCfg[id].enabled=false;return send(id,"❌ AutoBet OFF",{reply_markup:userMenu(id)});}
        if(text==="👀 Watch Mode ON") {autobetCfg[id].watch=true;return send(id,"👀 Watch ON — "+autobetCfg[id].watchLoss+" losses → bet");}
        if(text==="👀 Watch Mode OFF"){autobetCfg[id].watch=false;return send(id,"👀 Watch OFF — Direct bet!");}

        if(text==="💰 Set Base Bet"){userAction[id]={action:"setbase"};return send(id,"Enter base bet amount (e.g. 1):");}
        if(text==="💳 Set Balance"){userAction[id]={action:"setbalance"};return send(id,"Enter starting balance amount (e.g. 1000):");}
        if(text==="📈 Set Max Level"){userAction[id]={action:"setlvl"};return send(id,"Enter max level (1-15):");}
        if(text==="🎯 Set Profit Target"){userAction[id]={action:"settarget"};return send(id,"Enter target profit (Min ₹10):");}
        if(text==="⏳ Set Section Delay"){userAction[id]={action:"setdelay"};return send(id,"Enter restart delay in MINUTES (e.g. 30):");}
        if(text==="📝 Set Custom Bets"){userAction[id]={action:"setcustom"};return send(id,"📝 Enter Custom Bet Sequence (e.g. 1,4,7,9):");}
        if(text==="🔢 Set Watch Losses"){
            userAction[id]={action:"setwloss"};
            return send(id,"Enter watch loss count (e.g. 3):");
        }

        if(text==="📊 AutoBet Status") return await autobetStatus(msg.chat.id,id);
        if(text==="🔙 Back")return await send(id,"Main Menu",{reply_markup:userMenu(id)});

        if(text==="🔑 My Token"){
            const tok=getToken(id),creds=userCreds[id]||{};
            return send(id,"Token: "+(tok.length>20?"✅ ..."+tok.slice(-12):"❌")+"\nLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n\n/setcreds FULLPHONE PASSWORD\n/setmytoken TOKEN\n/login — Test");
        }

        if(text==="▶️ Start Prediction"){
            if(allUsersStopped && !isOwner(id)) return send(msg.chat.id, "🛑 Owner has stopped all users. Please wait until the owner starts all bots.");
            if(!hasAccess(id))return send(msg.chat.id,"❌ No access!\n📩 "+ADMIN_HANDLE+"\nID: "+id);
            if(running[id])return send(msg.chat.id,"⚠️ Already running!");

            running[id]=true;sentPeriods[id]=new Set();
            stopAfterWin[id] = false;
            delete activeBets[id];
            autobetState[id]={level:1,virtualLevel:1,consecutiveLoss:0,inMart:false};
            userStates[id].isSkipping = false;
            userStates[id].skipCount = 0;
            userStates[id].skipTotal = 0;
            userStates[id].skipWatch = false;
            userStates[id].levelWatchActive = false;
            userStates[id].levelWatchLosses = 0;
            userStates[id].levelWatchTarget = null;
            userStates[id].levelWatchRequired = 0;

            const prevList = await fetchList();
            initState(id);

            if (prevList && prevList.length >= 4) {
                userStates[id].resultHistory = buildBSFromList(prevList, 5);
                await send(msg.chat.id, "📋 Loaded history: " + (userStates[id].resultHistory || []).join(''));
            }

            const cfg=autobetCfg[id];
            await send(msg.chat.id,
"🚀 ENGINE ON!\n\nAutoBet: "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nWatch  : "+(cfg.watch?"ON ("+cfg.watchLoss+"L)":"OFF")+"\nBase   : ₹"+cfg.baseBet+" | MaxLvl: "+cfg.maxLvl
            );
            runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop") {
            if (activeBets[id]) {
                stopAfterWin[id] = id;
                return send(msg.chat.id, "⏳ Stop requested. The current bet will finish, and the bot will stop after a WIN.");
            }
            running[id] = false;
            stopAfterWin[id] = false;
            send(msg.chat.id,"🛑 Stopped.");
        }
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}

startBot();
