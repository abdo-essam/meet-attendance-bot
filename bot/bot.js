// ============================================
//  Google Meet Attendance Bot
// ============================================

const fs = require('fs');
const path = require('path');
const { MEET_LINK, DURATION_MINUTES, MEETING_NAME, REPORTS_DIR } = require('./config');
const { loadCookies, injectCookies, extractCookies, saveCookies } = require('./cookie-manager');
const { sleep, launchBrowser, createStealthPage, verifySession } = require('./browser-helper');

// ─── Join-button text patterns ──────────────────
const JOIN_TEXTS = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'انضمام'];
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

    // ─── Check critical cookies exist ───────────
    const hasSID = cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID');
    const hasMeetCookies = cookies.some(c => (c.domain || '').includes('meet.google.com'));
    console.log(`🔍 Cookie check: SID=${hasSID ? '✅' : '❌'} Meet=${hasMeetCookies ? '✅' : '⚠️'}`);

    if (!hasSID) {
        console.log('⚠️ WARNING: No SID cookies found! Session likely won\'t work.');
        console.log('   Re-run save-cookies.js and update GOOGLE_COOKIES secret.');
    }

    // ─── Launch browser ─────────────────────────
    const browser = await launchBrowser();
    const page = await createStealthPage(browser);

    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // ─── Inject cookies ─────────────────────────
    await injectCookies(page, cookies);

    // ─── Verify session ─────────────────────────
    const sessionOk = await verifySession(page);
    if (!sessionOk) {
        await takeScreenshot(page, 'debug_session.png');
        console.log('❌ Session verification failed! Exiting.');
        await browser.close();
        process.exit(1);
    }

    // ─── Verify Meet session specifically ───────
    console.log('\n🔍 Verifying Meet session...');
    const meetSessionOk = await verifyMeetSession(page);
    if (!meetSessionOk) {
        await takeScreenshot(page, 'debug_meet_session.png');
        console.log('❌ Meet session invalid! You need to refresh cookies.');
        console.log('   Run: node save-cookies.js');
        console.log('   Then update GOOGLE_COOKIES secret on GitHub.');
        await browser.close();
        process.exit(1);
    }

    // ─── Navigate to Meet ───────────────────────
    console.log(`\n⏳ Going to ${MEET_LINK}`);
    try {
        await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (_) { /* timeout is non-fatal */ }

    await sleep(3000);
    await takeScreenshot(page, 'step0_after_navigate.png');

    // ─── Handle "Choose an account" page ────────
    await handleAccountChooser(page);

    // ─── Check if redirected to sign-in ─────────
    const currentUrl = page.url();
    if (currentUrl.includes('ServiceLogin') || currentUrl.includes('signin/identifier') || currentUrl.includes('signin/v2')) {
        console.log('❌ Redirected to sign-in page! Session expired for Meet.');
        await takeScreenshot(page, 'debug_signin_redirect.png');
        await browser.close();
        process.exit(1);
    }

    // ─── Check for "can't join" immediately ─────
    const initialText = await getPageText(page);
    if (isMeetingUnavailable(initialText)) {
        console.log('❌ Meeting is not available:');
        console.log(`   "${initialText.substring(0, 150)}"`);
        await takeScreenshot(page, 'debug_meeting_unavailable.png');

        // Still save cookies and exit gracefully
        await saveFreshCookies(page);
        await browser.close();
        console.log('\n⚠️ Exiting — meeting not available. Bot will retry next scheduled run.');
        process.exit(0);
    }

    // ─── Wait for join page ─────────────────────
    console.log('⏳ Waiting for join page...');
    const joinReady = await waitForJoinPage(page);
    await takeScreenshot(page, 'step1_before_join.png');

    if (!joinReady) {
        console.log('⚠️ Could not reach join page. Checking state...');
        const stateText = await getPageText(page);
        console.log(`   Page text: "${stateText.substring(0, 150)}"`);

        if (isMeetingUnavailable(stateText)) {
            console.log('❌ Meeting not available.');
            await saveFreshCookies(page);
            await browser.close();
            process.exit(0);
        }
    }

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
    await saveFreshCookies(page);

    await browser.close();
    console.log('\n✅ Done!');
}

// ─── Helper functions ───────────────────────────

async function getPageText(page) {
    try {
        return await page.evaluate(() => document.body ? document.body.innerText : '');
    } catch (_) {
        return '';
    }
}

function isMeetingUnavailable(text) {
    const lower = text.toLowerCase();
    return (
        lower.includes("can't join this video call") ||
        lower.includes("you can't join") ||
        lower.includes('لا يمكنك الانضمام') ||
        lower.includes('this meeting has ended') ||
        lower.includes('meeting not found') ||
        lower.includes('this video call has ended') ||
        (lower.includes('return to home screen') && (lower.includes('unavailable') || lower.includes("can't join")))
    );
}

async function takeScreenshot(page, filename) {
    try {
        await page.screenshot({ path: path.join(REPORTS_DIR, filename) });
    } catch (_) { /* non-critical */ }
}

/**
 * Verify Meet-specific session by visiting meet.google.com
 * and checking if we see the authenticated interface.
 */
async function verifyMeetSession(page) {
    try {
        await page.goto('https://meet.google.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });
        await sleep(4000);

        const url = page.url();
        const text = await getPageText(page);

        console.log(`📍 Meet URL: ${url}`);
        console.log(`📄 Meet text: "${text.substring(0, 100)}..."`);

        // If we see "Sign in" button or marketing page, we're NOT authenticated
        if (url.includes('ServiceLogin') || url.includes('signin')) {
            console.log('❌ Meet redirected to sign-in');
            return false;
        }

        // Check for the marketing/unauthenticated page
        // The Arabic marketing page shows "تسجيل الدخول" (Sign in) and "تجربة Meet للعمل"
        if (text.includes('تسجيل الدخول') && text.includes('تجربة Meet')) {
            console.log('❌ Meet showing marketing/unauthenticated page (Arabic)');
            return false;
        }
        if (text.includes('Sign in') && text.includes('Try Meet for work')) {
            console.log('❌ Meet showing marketing/unauthenticated page (English)');
            return false;
        }

        // Check for Choose an account
        if (text.includes('Choose an account') || text.includes('اختيار حساب')) {
            console.log('⚠️ "Choose an account" on Meet — trying to select...');
            await handleAccountChooser(page);
            await sleep(5000);

            const newUrl = page.url();
            if (newUrl.includes('ServiceLogin') || newUrl.includes('signin')) {
                console.log('❌ Account selection led to sign-in page');
                return false;
            }

            const newText = await getPageText(page);
            if (newText.includes('تسجيل الدخول') || newText.includes('Sign in')) {
                console.log('❌ Still not authenticated after account selection');
                return false;
            }
        }

        // Positive checks — authenticated Meet shows these
        if (text.includes('New meeting') || text.includes('اجتماع جديد') ||
            text.includes('Enter a code') || text.includes('إدخال الرمز') ||
            text.includes('Join a meeting') || text.includes('الانضمام')) {
            console.log('✅ Meet session verified!');
            return true;
        }

        // If we got here, unclear state — log and assume OK for now
        console.log('⚠️ Meet state unclear, proceeding cautiously...');
        await takeScreenshot(page, 'debug_meet_verify.png');
        return true;
    } catch (err) {
        console.log(`⚠️ Meet verification error: ${err.message}`);
        return true; // Don't block on errors
    }
}

async function handleAccountChooser(page) {
    await sleep(3000);
    try {
        const text = await getPageText(page);
        if (text.includes('Choose an account') || text.includes('اختيار حساب')) {
            console.log('🔄 "Choose an account" page detected, clicking account...');
            const clicked = await page.evaluate(() => {
                const items = document.querySelectorAll('[data-identifier], [data-email]');
                if (items.length > 0) {
                    items[0].click();
                    return 'data-identifier';
                }

                const listItems = document.querySelectorAll('li');
                for (const li of listItems) {
                    const t = li.textContent || '';
                    if (t.includes('@') && !t.includes('Use another') && !t.includes('Remove')) {
                        li.click();
                        return 'li-email';
                    }
                }

                const divs = document.querySelectorAll('div[role="link"], div[tabindex="0"]');
                for (const div of divs) {
                    const t = div.textContent || '';
                    if (t.includes('@gmail.com') && !t.includes('Use another')) {
                        div.click();
                        return 'div-email';
                    }
                }
                return null;
            });

            if (clicked) {
                console.log(`✅ Clicked account via: ${clicked}`);
                await sleep(8000);
                await takeScreenshot(page, 'debug_after_account_choose.png');

                // Check if clicking account led to sign-in
                const newUrl = page.url();
                if (newUrl.includes('ServiceLogin') || newUrl.includes('signin/identifier')) {
                    console.log('❌ Account click led to sign-in — session is dead');
                }
            } else {
                console.log('⚠️ Could not find account to click');
            }
        }
    } catch (err) {
        console.log(`⚠️ Account chooser handler: ${err.message}`);
    }
}

async function findByXPath(page, xpath) {
    try {
        const elements = await page.$$(`xpath/${xpath}`);
        return elements;
    } catch (err) {
        try {
            const handles = await page.evaluateHandle((xp) => {
                const results = [];
                const query = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0; i < query.snapshotLength; i++) {
                    results.push(query.snapshotItem(i));
                }
                return results;
            }, xpath);

            const properties = await handles.getProperties();
            const elements = [];
            for (const prop of properties.values()) {
                const element = prop.asElement();
                if (element) elements.push(element);
            }
            return elements;
        } catch (fallbackErr) {
            return [];
        }
    }
}

async function waitForJoinPage(page) {
    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(2000);
        const url = page.url();

        try {
            const bodyText = await getPageText(page);

            // Check for session expiry
            if (url.includes('ServiceLogin') || url.includes('signin/identifier') || url.includes('signin/v2')) {
                console.log(`❌ Session expired during meeting join! URL: ${url}`);
                await takeScreenshot(page, 'debug_session_expired.png');
                return false;
            }

            // Check for "Choose an account" and handle it
            if (bodyText.includes('Choose an account') || bodyText.includes('اختيار حساب')) {
                console.log('⚠️ Account chooser appeared during wait, handling...');
                await handleAccountChooser(page);
                await sleep(3000);
                continue;
            }

            // Check for meeting unavailable
            if (isMeetingUnavailable(bodyText)) {
                console.log(`❌ Meeting unavailable [${attempt + 1}]`);
                await takeScreenshot(page, 'debug_unavailable.png');
                return false;
            }

            // Check for join button using evaluate (most reliable)
            for (const textMatch of ['Join now', 'Ask to join', 'انضم الآن', 'طلب الانضمام', 'انضمام', 'Join']) {
                const found = await page.evaluate((text) => {
                    const spans = document.querySelectorAll('span, button');
                    for (const el of spans) {
                        if (el.textContent.includes(text)) return true;
                    }
                    return false;
                }, textMatch);

                if (found) {
                    console.log(`✅ Join page ready! [${attempt + 1}] Found text: "${textMatch}"`);
                    return true;
                }
            }

            // Also check for the pre-join screen (name input, camera preview, etc.)
            const hasPreJoin = await page.evaluate(() => {
                // Pre-join screen typically has mic/camera toggle buttons
                const buttons = document.querySelectorAll('[data-is-muted], [aria-label*="microphone"], [aria-label*="camera"], [aria-label*="ميكروفون"], [aria-label*="كاميرا"]');
                return buttons.length > 0;
            });

            if (hasPreJoin) {
                console.log(`✅ Pre-join screen detected! [${attempt + 1}]`);
                return true;
            }

            if (attempt % 5 === 0) {
                const shortText = bodyText.replace(/\n/g, ' ').substring(0, 100);
                console.log(`⏳ Waiting... [${attempt + 1}] URL: ${url} | Text: ${shortText}...`);
            }
        } catch (err) {
            console.log(`⚠️ Wait error: ${err.message}`);
        }

        // Retry navigation if stuck on homepage
        if ((url === 'https://meet.google.com/' || url === 'https://meet.google.com') && (attempt === 3 || attempt === 10)) {
            console.log('⚠️ On homepage, retrying navigation...');
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

async function tryJoin(page, { maxAttempts = 3 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const clicked = await clickJoinButton(page);
        if (clicked) {
            console.log(`✅ Join button clicked (attempt ${attempt})`);
            await sleep(8000);

            const stillOnJoinPage = await isOnJoinPage(page);
            if (!stillOnJoinPage) return true;
            console.log(`⚠️ Still on join page after attempt ${attempt}`);
        }

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

            if (focused.includes('انضم') || focused.includes('Join') || focused.includes('الانضمام')) {
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
            return text.includes('انضم الآن') || text.includes('Join now') || text.includes('Ask to join');
        });
    } catch (_) {
        return false;
    }
}

async function checkJoinResult(page) {
    let text = await getPageText(page);

    if (text.includes("can't join") || text.includes('لا يمكنك')) {
        console.log('❌ Rejected');
    } else if (text.includes('Leave') || text.includes('مغادرة')) {
        console.log('✅ JOINED!');
    } else if (text.includes('Choose an account') || text.includes('اختيار حساب')) {
        console.log('⚠️ Account chooser appeared, trying to select account...');
        await handleAccountChooser(page);
        await sleep(5000);
        try {
            await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch (_) {}
        await sleep(5000);
    } else if (text.includes('انضم') || text.includes('Join') || text.includes('الانضمام')) {
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

        try {
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 500 + 100);
        } catch (_) { /* non-critical */ }

        const waitTime = Math.min(endTime - Date.now(), 600000);
        if (waitTime <= 0) break;
        await sleep(waitTime);
    }
}

async function saveFreshCookies(page) {
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
}

main().catch((err) => {
    console.error('❌ Bot error:', err);
    process.exit(1);
});