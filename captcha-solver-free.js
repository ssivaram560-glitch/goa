/**
 * ============================================================
 *  FREE CAPTCHA SOLVER FOR goaokk.com LOGIN
 *  ============================================================
 *  
 *  No paid API needed. Uses pixel-level image comparison to find
 *  the puzzle piece gap position, then simulates human-like mouse
 *  drag using Puppeteer.
 *  
 *  Works on Windows with visible Chrome window (headless: false).
 *  Token is captured from the GetBalance API request that happens
 *  after login + navigation to Win Go page.
 * ============================================================
 */

const puppeteer = require('puppeteer');
const { PNG } = require('pngjs');
const axios = require('axios');

// ============================================================
//  HELPER FUNCTIONS
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
//  CAPTCHA IMAGE EXTRACTION
// ============================================================

async function extractCaptchaImages(page) {
    const imageData = await page.evaluate(() => {
        const bgImg = document.querySelector('.captcha_background');
        const sliderImg = document.querySelector('.captcha_slider');
        
        if (!bgImg || !sliderImg) return null;
        
        const bgContainer = bgImg.parentElement;
        const bgRect = bgContainer ? bgContainer.getBoundingClientRect() : bgImg.getBoundingClientRect();
        const sliderRect = sliderImg.getBoundingClientRect();
        
        return {
            bgSrc: bgImg.src,
            sliderSrc: sliderImg.src,
            displayWidth: bgRect.width,
            displayHeight: bgRect.height,
            sliderDisplayLeft: sliderRect.left,
            sliderDisplayTop: sliderRect.top,
        };
    });
    
    if (!imageData || !imageData.bgSrc || !imageData.sliderSrc) {
        return null;
    }
    
    let bgData, pieceData;
    
    try {
        // Download images using axios (Node.js side - reliable)
        const bgResponse = await axios.get(imageData.bgSrc, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://goaokk.com/',
                'Origin': 'https://goaokk.com'
            }
        });
        const bgPng = PNG.sync.read(Buffer.from(bgResponse.data));
        bgData = { width: bgPng.width, height: bgPng.height, data: bgPng.data };
        
        const pieceResponse = await axios.get(imageData.sliderSrc, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://goaokk.com/',
                'Origin': 'https://goaokk.com'
            }
        });
        const piecePng = PNG.sync.read(Buffer.from(pieceResponse.data));
        pieceData = { width: piecePng.width, height: piecePng.height, data: piecePng.data };
    } catch (err) {
        console.error('[CAPTCHA] Failed to download images via axios:', err.message);
        
        // Fallback: use canvas toDataURL (browser side - returns base64 string)
        try {
            const bgBase64 = await page.evaluate((src) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png').split(',')[1]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }, imageData.bgSrc);
            
            const pieceBase64 = await page.evaluate((src) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png').split(',')[1]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }, imageData.sliderSrc);
            
            if (bgBase64 && pieceBase64) {
                const bgPng = PNG.sync.read(Buffer.from(bgBase64, 'base64'));
                bgData = { width: bgPng.width, height: bgPng.height, data: bgPng.data };
                const piecePng = PNG.sync.read(Buffer.from(pieceBase64, 'base64'));
                pieceData = { width: piecePng.width, height: piecePng.height, data: piecePng.data };
            }
        } catch (err2) {
            console.error('[CAPTCHA] Fallback also failed:', err2.message);
            return null;
        }
    }
    
    return {
        bgData,
        pieceData,
        displayWidth: imageData.displayWidth,
        displayHeight: imageData.displayHeight,
    };
}

// ============================================================
//  GAP DETECTION (FREE - Template Matching)
// ============================================================

function solveGapPosition(bgData, pieceData, displayWidth, displayHeight) {
    const { width: bgW, height: bgH, data: bgPixels } = bgData;
    const { width: pieceW, height: pieceH, data: piecePixels } = pieceData;
    
    const scaleX = displayWidth / bgW;
    const scaleY = displayHeight / bgH;
    
    // Extract non-transparent piece pixels
    const pieceOpaquePixels = [];
    let contentMinX = pieceW, contentMaxX = 0;
    let contentMinY = pieceH, contentMaxY = 0;
    
    for (let y = 0; y < pieceH; y++) {
        for (let x = 0; x < pieceW; x++) {
            const idx = (y * pieceW + x) * 4;
            const alpha = piecePixels[idx + 3];
            if (alpha > 80) {
                pieceOpaquePixels.push({
                    x, y,
                    r: piecePixels[idx] / 255,
                    g: piecePixels[idx + 1] / 255,
                    b: piecePixels[idx + 2] / 255,
                });
                contentMinX = Math.min(contentMinX, x);
                contentMaxX = Math.max(contentMaxX, x);
                contentMinY = Math.min(contentMinY, y);
                contentMaxY = Math.max(contentMaxY, y);
            }
        }
    }
    
    if (pieceOpaquePixels.length < 50) {
        console.log('[CAPTCHA] Too few opaque pixels in piece, cannot solve');
        return -1;
    }
    
    console.log(`[CAPTCHA] Piece content: ${pieceOpaquePixels.length} pixels, bounds x:${contentMinX}-${contentMaxX} y:${contentMinY}-${contentMaxY}`);
    
    // Pre-compute background pixel values
    const bgR = new Float32Array(bgW * bgH);
    const bgG = new Float32Array(bgW * bgH);
    const bgB = new Float32Array(bgW * bgH);
    
    for (let i = 0; i < bgW * bgH; i++) {
        bgR[i] = bgPixels[i * 4] / 255;
        bgG[i] = bgPixels[i * 4 + 1] / 255;
        bgB[i] = bgPixels[i * 4 + 2] / 255;
    }
    
    // Slide piece across background to find best match
    let bestX = 0;
    let bestScore = Infinity;
    
    for (let x = 0; x <= bgW - pieceW; x += 2) {
        let totalDiff = 0;
        let count = 0;
        
        for (const pp of pieceOpaquePixels) {
            const bgX = x + pp.x;
            const bgY = pp.y;
            
            if (bgX >= 0 && bgX < bgW && bgY >= 0 && bgY < bgH) {
                const bgIdx = bgY * bgW + bgX;
                const dr = bgR[bgIdx] - pp.r;
                const dg = bgG[bgIdx] - pp.g;
                const db = bgB[bgIdx] - pp.b;
                totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
                count++;
            }
        }
        
        if (count > 0) {
            const avgDiff = totalDiff / count;
            if (avgDiff < bestScore) {
                bestScore = avgDiff;
                bestX = x;
            }
        }
    }
    
    // Refine with step=1
    const refineMin = Math.max(0, bestX - 15);
    const refineMax = Math.min(bgW - pieceW, bestX + 15);
    
    for (let x = refineMin; x <= refineMax; x++) {
        let totalDiff = 0;
        let count = 0;
        
        for (const pp of pieceOpaquePixels) {
            const bgX = x + pp.x;
            const bgY = pp.y;
            
            if (bgX >= 0 && bgX < bgW && bgY >= 0 && bgY < bgH) {
                const bgIdx = bgY * bgW + bgX;
                const dr = bgR[bgIdx] - pp.r;
                const dg = bgG[bgIdx] - pp.g;
                const db = bgB[bgIdx] - pp.b;
                totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
                count++;
            }
        }
        
        if (count > 0) {
            const avgDiff = totalDiff / count;
            if (avgDiff < bestScore) {
                bestScore = avgDiff;
                bestX = x;
            }
        }
    }
    
    console.log(`[CAPTCHA] Best match: X=${bestX} (image px), score=${bestScore.toFixed(4)}`);
    
    const dragDistance = Math.round(bestX * scaleX);
    console.log(`[CAPTCHA] Drag distance: ${bestX}px (image) → ${dragDistance}px (display)`);
    
    return dragDistance;
}

// ============================================================
//  HUMAN-LIKE DRAG SIMULATION
// ============================================================

async function performHumanDrag(page, dragDistance) {
    // Get handler position and dimensions
    const handlerPos = await page.evaluate(() => {
        const handler = document.querySelector('.captcha_handler');
        if (!handler) return null;
        const rect = handler.getBoundingClientRect();
        return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top
        };
    });
    
    if (!handlerPos) {
        console.error('[CAPTCHA] Handler element not found');
        return false;
    }
    
    const startX = handlerPos.x;
    const startY = handlerPos.y;
    const targetX = startX + dragDistance;
    
    console.log(`[CAPTCHA] Drag: (${startX.toFixed(1)}, ${startY.toFixed(1)}) → (${targetX.toFixed(1)}, ${startY.toFixed(1)}) | Distance: ${dragDistance}px`);
    
    // Generate human-like movement path BEFORE dispatching events
    const totalSteps = randomInt(50, 80);
    const movements = [];
    let elapsed = 0;
    const startTime = Date.now();
    
    // Move mouse to handler first
    await page.mouse.move(startX, startY);
    await sleep(randomInt(200, 500));
    
    // Start the drag using browser-side PointerEvent dispatch
    // This ensures the Vue component's mousedown/mousemove/mouseup handlers
    // receive proper native events with correct coordinates
    const dragResult = await page.evaluate(({ startX, startY, targetX, dragDistance, totalSteps }) => {
        return new Promise((resolve) => {
            const handler = document.querySelector('.captcha_handler');
            if (!handler) {
                resolve({ success: false, error: 'handler not found' });
                return;
            }
            
            // Get the drag bar container
            const dragBar = handler.closest('.captcha_drag_verify') || handler.parentElement;
            
            const rect = handler.getBoundingClientRect();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const endX = cx + dragDistance;
            
            // Generate movement points
            const steps = totalSteps;
            const points = [];
            const jitter = (min, max) => min + Math.random() * (max - min);
            
            for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                let eased;
                
                // Human-like ease curve
                if (progress < 0.05) {
                    eased = Math.pow(progress / 0.05, 2) * 0.05;
                } else if (progress < 0.2) {
                    const p = (progress - 0.05) / 0.15;
                    eased = 0.05 + p * p * 0.2;
                } else if (progress < 0.65) {
                    eased = 0.25 + ((progress - 0.2) / 0.45) * 0.4;
                } else if (progress < 0.85) {
                    const p = (progress - 0.65) / 0.20;
                    eased = 0.65 + (1 - Math.pow(1 - p, 2)) * 0.2;
                } else {
                    const p = (progress - 0.85) / 0.15;
                    eased = 0.85 + Math.pow(p, 2) * 0.15;
                }
                
                const px = cx + dragDistance * eased;
                const py = cy + jitter(-3, 3);
                points.push({ x: px, y: py, progress });
            }
            
            // Now dispatch events with human-like timing
            let pointIndex = 0;
            const dispatchNext = () => {
                if (pointIndex >= points.length) {
                    // Final position + mouseup
                    setTimeout(() => {
                        const lastPoint = points[points.length - 1];
                        const upEvent = new PointerEvent('pointerup', {
                            bubbles: true,
                            cancelable: true,
                            clientX: endX,
                            clientY: cy,
                            screenX: endX,
                            screenY: cy,
                            pointerId: 1,
                            pointerType: 'mouse'
                        });
                        handler.dispatchEvent(upEvent);
                        
                        const mouseUpEvent = new MouseEvent('mouseup', {
                            bubbles: true,
                            cancelable: true,
                            clientX: endX,
                            clientY: cy
                        });
                        document.dispatchEvent(mouseUpEvent);
                        
                        // Wait a bit for the component to process
                        setTimeout(() => {
                            resolve({ success: true });
                        }, 500);
                    }, 200);
                    return;
                }
                
                const point = points[pointIndex];
                
                // Variable delay: slower at start/end, faster in middle
                let delay;
                if (point.progress < 0.1) delay = 25 + Math.random() * 20;
                else if (point.progress < 0.2) delay = 15 + Math.random() * 15;
                else if (point.progress > 0.85) delay = 25 + Math.random() * 25;
                else if (point.progress > 0.7) delay = 15 + Math.random() * 15;
                else delay = 5 + Math.random() * 10;
                
                setTimeout(() => {
                    // Dispatch mousemove
                    const moveEvent = new MouseEvent('mousemove', {
                        bubbles: true,
                        cancelable: true,
                        clientX: point.x,
                        clientY: point.y
                    });
                    document.dispatchEvent(moveEvent);
                    
                    pointIndex++;
                    dispatchNext();
                }, delay);
            };
            
            // Dispatch mousedown
            const downEvent = new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                clientX: cx,
                clientY: cy,
                screenX: cx,
                screenY: cy,
                pointerId: 1,
                pointerType: 'mouse'
            });
            handler.dispatchEvent(downEvent);
            
            const mouseDownEvent = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                clientX: cx,
                clientY: cy
            });
            handler.dispatchEvent(mouseDownEvent);
            
            // Start dispatching movement after a small delay
            setTimeout(() => {
                dispatchNext();
            }, 100);
        });
    }, { startX, startY, targetX, dragDistance, totalSteps });
    
    if (dragResult.success) {
        console.log('[CAPTCHA] Drag completed via browser events');
    } else {
        console.error('[CAPTCHA] Drag failed:', dragResult.error);
    }
    
    return dragResult.success;
}

// ============================================================
//  CAPTCHA CHECK HELPERS
// ============================================================

async function isCaptchaVisible(page) {
    return await page.evaluate(() => {
        const bg = document.querySelector('.captcha_background');
        const slider = document.querySelector('.captcha_slider');
        if (!bg || !slider) return false;
        
        const overlay = document.querySelector('.van-overlay');
        if (overlay) {
            const style = window.getComputedStyle(overlay);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        
        return true;
    });
}

async function refreshCaptcha(page) {
    await page.evaluate(() => {
        const refreshBtn = document.querySelector('.captcha_refresh, [class*="refresh"], button[class*="refresh"]');
        if (refreshBtn) refreshBtn.click();
    });
    await sleep(2000);
}

async function solveCaptcha(page) {
    console.log('[CAPTCHA] Starting free captcha solver...');
    
    const images = await extractCaptchaImages(page);
    if (!images) {
        console.error('[CAPTCHA] Could not extract captcha images');
        return -1;
    }
    
    console.log(`[CAPTCHA] Images: BG=${images.bgData.width}x${images.bgData.height}, Piece=${images.pieceData.width}x${images.pieceData.height}`);
    console.log(`[CAPTCHA] Display: ${images.displayWidth}x${images.displayHeight}`);
    
    const dragDistance = solveGapPosition(
        images.bgData,
        images.pieceData,
        images.displayWidth,
        images.displayHeight
    );
    
    return dragDistance;
}

// ============================================================
//  COMPLETE LOGIN WITH CAPTCHA SOLVING
// ============================================================

async function captchaLogin(userId, chatId, phone, password, bot, logBoth) {
    console.log(`[LOGIN] Starting captcha login for user ${userId}...`);
    
    // ============================================================
    // CHANGE 1: headless: false → Chrome window visible-a irukkum
    // CHANGE 2: executablePath → un laptop-la Chrome path
    // CHANGE 3: Token capture same as un original code
    // ============================================================
    
    let browser;
     try {
         browser = await puppeteer.launch({
             headless: true, 
             args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--disable-gpu']
         });
         const page = await browser.newPage();
         await page.setDefaultNavigationTimeout(90000); 
         await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
 
         let capturedToken = null;
         await page.setRequestInterception(true);
         page.on('request', (req) => {
             if (req.url().includes('GetBalance') && req.headers()['authorization']) {
                 capturedToken = req.headers()['authorization'].replace(/^Bearer\s+/i, "");
             }
             req.continue();
         });
        // Navigate to login page
        await page.goto('https://goaokk.com/#/login', { 
            waitUntil: 'domcontentloaded', 
            timeout: 90000 
        });
        
        await page.waitForSelector('input', { timeout: 30000 });
        await sleep(1000);
        
        const inputs = await page.$$('input');
        if (inputs.length < 2) throw new Error("Login inputs not found");
        
        await inputs[0].type(phone, { delay: 50 });
        await inputs[1].type(password, { delay: 50 });
        
        // Click Login button
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const loginBtn = btns.find(b => b.innerText.includes('Log in') || b.innerText.includes('Login'));
            if (loginBtn) loginBtn.click();
            else document.querySelector('form')?.submit();
        });
        
        // Wait for captcha to appear
        await sleep(2000);
        
        let captchaDetected = false;
        for (let i = 0; i < 20; i++) {
            captchaDetected = await isCaptchaVisible(page);
            if (captchaDetected) break;
            await sleep(500);
        }
        
        if (captchaDetected) {
            console.log('[LOGIN] Captcha detected! Solving...');
            
            try {
                // Step 1: Calculate drag distance
                const dragDistance = await solveCaptcha(page);
                
                if (dragDistance < 10 || dragDistance > 330) {
                    console.error(`[LOGIN] Invalid drag distance: ${dragDistance}`);
                    if (chatId) await logBoth(chatId, '❌ Captcha solve failed - invalid distance');
                    return false;
                }
                
                // Step 2: Perform human-like drag
                const dragged = await performHumanDrag(page, dragDistance);
                
                if (!dragged) {
                    console.error('[LOGIN] Drag failed');
                    if (chatId) await logBoth(chatId, '❌ Captcha solve failed - drag error');
                    return false;
                }
                
                // Step 3: Wait for verification
                await sleep(3000);
                
                // Step 4: Check result
                const captchaStillVisible = await isCaptchaVisible(page);
                
                if (captchaStillVisible) {
                    console.log('[LOGIN] ❌ Captcha still visible - solve failed');
                    if (chatId) await logBoth(chatId, '❌ Captcha solve failed - server rejected');
                    return false;
                }
                
                console.log('[LOGIN] ✅ Captcha solved successfully!');
                
            } catch (err) {
                console.error(`[LOGIN] Captcha solve failed: ${err.message}`);
                if (chatId) await logBoth(chatId, `❌ Captcha solve failed: ${err.message}`);
                return false;
            }
        } else {
            console.log('[LOGIN] No captcha appeared (might be skipped)');
        }
        
        // === POST-LOGIN NAVIGATION (same as your original code) ===
        // This triggers the GetBalance API call which has the token
        
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
            // Ignore timeout
        }
        await new Promise(r => setTimeout(r, 5000));
        
       await page.evaluate(() => {
            const closeBtn = document.querySelector('.van-icon-cross') || document.querySelector('.close-icon');
            if (closeBtn) closeBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate(() => {
            const navItems = Array.from(document.querySelectorAll('div, span'));
            const lotteryBtn = navItems.find(el => el.innerText.trim() === 'Lottery');
            if (lotteryBtn) lotteryBtn.click();
        });
        await new Promise(r => setTimeout(r, 2000));

  await page.evaluate(() => {
            const navItems = Array.from(document.querySelectorAll('div, span'));
            const winGoBtn = navItems.find(el => el.innerText.trim() === 'Win Go');
            if (winGoBtn) winGoBtn.click();
        });

        
        // === TOKEN CAPTURE (same as your original code) ===
        for (let i = 0; i < 50; i++) {
            if (capturedToken) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        
        if (capturedToken) {
            console.log('[LOGIN] ✅ Token captured successfully!');
            if (chatId) await logBoth(chatId, `✅ [SUCCESS] Token captured for user ${userId}!`);
            return capturedToken;
        } else {
            console.error('[LOGIN] ❌ Token not found');
            if (chatId) await logBoth(chatId, `❌ Login failed - token not captured for user ${userId}`, true);
            return false;
        }
        
    } catch (err) {
        console.error(`[LOGIN] Error: ${err.message}`);
        if (chatId) await logBoth(chatId, `❌ Login Error for user ${userId}: ${err.message}`, true);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// ============================================================
//  EXPORTS
// ============================================================

module.exports = {
    captchaLogin,
    solveCaptcha,
    solveGapPosition,
    performHumanDrag,
    isCaptchaVisible,
    extractCaptchaImages,
};
