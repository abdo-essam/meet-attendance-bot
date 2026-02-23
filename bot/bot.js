// ============================================
//  Google Meet Attendance Bot
// ============================================

const fs = require('fs');
const path = require('path');
const { MEET_LINK, DURATION_MINUTES, MEETING_NAME, REPORTS_DIR } = require('./config');
const { loadCookies, injectCookies, extractCookies, saveCookies } = require('./cookie-manager');
const { sleep, launchBrowser, createStealthPage, verifySession } = require('./browser-helper');

// ─── Join-button text patterns ──────────────────
const JOIN_TEXTS = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام'];
const SKIP_TEXTS = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present'];

async function main() {
    console.log('═'.repeat(50));
    console.log('🤖 Meet Attendance Bot');
    console.log('═'.repeat(50));

    // ─── Load cookies ───────────────────────────
    const cookies = loadCookies();
    if (cookies.length === 0) {
        console.log('❌ No cookies found! Run save-cookies first.');
        process.exit(1);
    }

    // ─── Launch browser ─────────────────────────
    const browser = await launchBrowser();
    const page = await createStealthPage(browser);

    // ─── Inject cookies ─────────────────────────
    await injectCookies(page, cookies);

    // ─── Verify session ─────────────────────────
    const sessionOk = await verifySession(page);

    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    if (!sessionOk) {
        await takeScreenshot(page, 'debug_session.png');
        await browser.close();
        process.exit(1);
    }

    // ─── Navigate to Meet ───────────────────────
    console.log(`\n⏳ Going to ${MEET_LINK}`);
    try {
        await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (_) { /* timeout is non-fatal */ }

    // ─── Wait for join page ─────────────────────
    console.log('⏳ Waiting for join page...');
    const joinReady = await waitForJoinPage(page);

    await takeScreenshot(page, 'step1_before_join.png');

    // ─── Dismiss popups ─────────────────────────
    console.log('\n🔕 Dismissing popups...');
    await dismissPopups(page);

    // ─── Mute mic & camera ──────────────────────
    console.log('🔇 Muting...');
    await page.keyboard.down('Control');
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    await page.keyboard.up('Control');
    await sleep(1000);

    await takeScreenshot(page, 'step2_after_mute.png');

    // ─── Join meeting ───────────────────────────
    console.log('\n🚪 JOINING...');
    await tryJoin(page, { maxAttempts: 3 });

    await takeScreenshot(page, 'step3_after_join.png');

    // ─── Check join result ──────────────────────
    console.log('\n🔍 Checking result...');
    await checkJoinResult(page);

    // ─── Stay in meeting ────────────────────────
    console.log(`\n🎥 Staying ${DURATION_MINUTES} min...`);
    await stayInMeeting(page);

    // ─── Save report ────────────────────────────
    console.log('\n✅ Time over.');
    fs.writeFileSync(
        path.join(REPORTS_DIR, 'report.txt'),
        `Link: ${MEET_LINK}\nName: ${MEETING_NAME}\nDuration: ${DURATION_MINUTES} min\nEnd: ${new Date().toISOString()}`
    );

    // ─── Save refreshed cookies ─────────────────
    console.log('\n🍪 Saving cookies...');
    try {
        const freshCookies = await extractCookies(page);
        if (freshCookies.length >= 10) {
            saveCookies(freshCookies);
        } else {
            console.log(`⚠️ Too few cookies (${freshCookies.length}), skipping save`);
        }
    } catch (err) {
        console.log(`⚠️ Cookie save failed: ${err.message}`);
    }

    await browser.close();
    console.log('\n✅ Done!');
}

// ─── Helper functions ───────────────────────────

async function takeScreenshot(page, filename) {
    try {
        await page.screenshot({ path: path.join(REPORTS_DIR, filename) });
    } catch (_) { /* non-critical */ }
}

async function waitForJoinPage(page) {
    const btnLocators = [
        'span:contains("Join now")', 'span:contains("Ask to join")',
        'span:contains("انضمام")', 'span:contains("طلب انضمام")'
    ];

    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(2000);
        const url = page.url();

        try {
            // First check if a recognizable join button exists
            for (const textMatch of ['Join now', 'Ask to join', 'انضمام', 'طلب انضمام', 'Join']) {
                const elements = await page.$x(`//span[contains(text(), '${textMatch}')]`);
                if (elements.length > 0) {
                    console.log(`✅ Join page ready! [${attempt + 1}] Found text: "${textMatch}"`);
                    return true;
                }
            }

            // If no join button, dump what we DO see on the page
            const text = await page.evaluate(() => document.body ? document.body.innerText.replace(/\n/g, ' ').substring(0, 200) : '');

            if (text.toLowerCase().includes('return to home screen') && text.toLowerCase().includes('unavailable')) {
                console.log(`❌ Meeting unavailable [${attempt + 1}] URL: ${url}`);
                console.log(`🔍 [DEBUG] Page text: ${text}`);
                await takeScreenshot(page, 'debug_unavailable.png');
                return false;
            }

            if (attempt % 5 === 0) {
                console.log(`⏳ Waiting... URL: ${url} | Text: ${text.substring(0, 50)}...`);
            }
        } catch (err) {
            console.log(`⚠️ Wait error: ${err.message}`);
        }

        // Retry navigation if stuck on homepage
        if ((url === 'https://meet.google.com/' || url === 'https://meet.google.com') && (attempt === 3 || attempt === 10)) {
            console.log('⚠️ On homepage, retrying navigation to absolute link...');
            try {
                await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 30000 });
            } catch (_) { }
        }
    }

    await takeScreenshot(page, 'debug_timeout.png');
    return false;
}

async function dismissPopups(page) {
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await sleep(300);
    }
    try {
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const label = btn.getAttribute('aria-label') || '';
                if (label.includes('Close') || label.includes('إغلاق') || label === 'Got it' || label === 'حسنًا') {
                    btn.click();
                    break;
                }
            }
        });
    } catch (_) { /* non-critical */ }
    await sleep(500);
}

/**
 * Try to click the join button using multiple strategies, with retries.
 */
async function tryJoin(page, { maxAttempts = 3 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Strategy 1: Direct DOM click on known join texts
        const clicked = await clickJoinButton(page);
        if (clicked) {
            console.log(`✅ Join button clicked (attempt ${attempt})`);
            await sleep(8000);

            // Check if we actually joined
            const stillOnJoinPage = await isOnJoinPage(page);
            if (!stillOnJoinPage) return true;
            console.log(`⚠️ Still on join page after attempt ${attempt}`);
        }

        // Strategy 2: Press Escape first, then retry click with focus+dispatch
        if (attempt < maxAttempts) {
            console.log(`⚠️ Retrying join (attempt ${attempt + 1})...`);
            await page.keyboard.press('Escape');
            await sleep(500);

            const forcedClick = await forceClickJoinButton(page);
            if (forcedClick) {
                await sleep(8000);
                const stillOnJoinPage = await isOnJoinPage(page);
                if (!stillOnJoinPage) return true;
            }
        }
    }

    // Final fallback: Tab + Enter
    console.log('⚠️ Trying Tab+Enter fallback...');
    return await tabEnterJoin(page);
}

async function clickJoinButton(page) {
    try {
        const result = await page.evaluate((joinTexts, skipTexts) => {
            const buttons = document.querySelectorAll('button, [role="button"]');
            const info = [];

            for (const btn of buttons) {
                const text = btn.textContent.trim();
                const rect = btn.getBoundingClientRect();
                const style = window.getComputedStyle(btn);
                if (rect.width === 0 || rect.height === 0 || style.display === 'none') continue;

                info.push(`${text.substring(0, 60)} [${Math.round(rect.width)}x${Math.round(rect.height)}]`);

                if (skipTexts.some((s) => text.includes(s))) continue;

                if (joinTexts.some((j) => text.includes(j))) {
                    btn.click();
                    return { clicked: text, info };
                }
            }

            // Blue button fallback
            let best = null;
            let bestArea = 0;
            for (const btn of buttons) {
                const rect = btn.getBoundingClientRect();
                const style = window.getComputedStyle(btn);
                const text = btn.textContent.trim();

                if (skipTexts.some((s) => text.includes(s))) continue;

                const area = rect.width * rect.height;
                const isBlue =
                    style.backgroundColor.includes('26, 115, 232') ||
                    style.backgroundColor.includes('66, 133, 244');

                if (isBlue && area > bestArea && area > 3000) {
                    best = btn;
                    bestArea = area;
                }
            }
            if (best) {
                best.click();
                return { clicked: `BLUE:${best.textContent.trim()}`, info };
            }

            return { clicked: null, info };
        }, JOIN_TEXTS, SKIP_TEXTS);

        console.log(`📋 Buttons: ${JSON.stringify(result.info)}`);
        if (result.clicked) {
            console.log(`✅ Clicked: "${result.clicked}"`);
            return true;
        }
        console.log('⚠️ No join button found');
        return false;
    } catch (err) {
        console.log(`⚠️ clickJoinButton: ${err.message}`);
        return false;
    }
}

async function forceClickJoinButton(page) {
    try {
        return await page.evaluate((joinTexts) => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent.trim();
                if (joinTexts.some((j) => text.includes(j))) {
                    btn.focus();
                    btn.click();
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    return true;
                }
            }
            return false;
        }, JOIN_TEXTS);
    } catch (_) {
        return false;
    }
}

async function tabEnterJoin(page) {
    try {
        for (let t = 0; t < 20; t++) {
            await page.keyboard.press('Tab');
            await sleep(200);
            const focused = await page
                .evaluate(() => document.activeElement ? document.activeElement.textContent.trim() : '')
                .catch(() => '');

            if (focused.includes('انضم') || focused.includes('Join')) {
                console.log(`✅ Focused: "${focused}" → Enter`);
                await page.keyboard.press('Enter');
                await sleep(8000);
                return true;
            }
        }
    } catch (_) { /* non-critical */ }
    return false;
}

async function isOnJoinPage(page) {
    try {
        return await page.evaluate(() => {
            const text = document.body.innerText;
            return text.includes('انضم الآن') || text.includes('Join now');
        });
    } catch (_) {
        return false;
    }
}

async function checkJoinResult(page) {
    let text = '';
    try {
        text = await page.evaluate(() => document.body.innerText);
    } catch (_) { /* non-critical */ }

    if (text.includes("can't join") || text.includes('لا يمكنك')) {
        console.log('❌ Rejected');
    } else if (text.includes('Leave') || text.includes('مغادرة')) {
        console.log('✅ JOINED!');
    } else if (text.includes('انضم') || text.includes('Join')) {
        console.log('⚠️ Still on join page, final attempt...');
        await forceClickJoinButton(page);
        await sleep(8000);
    } else {
        console.log(`⚠️ Unknown state: ${text.substring(0, 200)}`);
    }
}

async function stayInMeeting(page) {
    let screenshotIndex = 1;
    const endTime = Date.now() + DURATION_MINUTES * 60000;

    while (Date.now() < endTime) {
        const minutesLeft = Math.round((endTime - Date.now()) / 60000);
        console.log(`[${new Date().toISOString()}] ${minutesLeft} min left`);

        await takeScreenshot(page, `screenshot_${screenshotIndex}.png`);
        screenshotIndex++;

        // Keep the session alive with mouse movement
        try {
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 500 + 100);
        } catch (_) { /* non-critical */ }

        const waitTime = Math.min(endTime - Date.now(), 600000);
        if (waitTime <= 0) break;
        await sleep(waitTime);
    }
}

// ─── Entry point ────────────────────────────────

main().catch((err) => {
    console.error('❌ Bot error:', err);
    process.exit(1);
});