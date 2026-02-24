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
        console.log('⚠️ No cookies found! The bot will attempt auto-login from scratch.');
    } else {
        // ─── Check critical cookies exist ───────────
        const hasSID = cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID');
        const hasMeetCookies = cookies.some(c => (c.domain || '').includes('meet.google.com'));
        const hasOSID = cookies.some(c => c.name === 'OSID' || c.name === '__Secure-OSID');
        console.log(`🔍 Cookie check: SID=${hasSID ? '✅' : '❌'} Meet=${hasMeetCookies ? '✅' : '⚠️'} OSID=${hasOSID ? '✅' : '⚠️'}`);

        if (!hasSID) {
            console.log('⚠️ No SID cookies! The bot will try to log in automatically.');
        }
    }

    // ─── Launch browser ─────────────────────────
    const browser = await launchBrowser();
    const page = await createStealthPage(browser);

    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // ─── Inject cookies ─────────────────────────
    await injectCookies(page, cookies);

    // ─── Verify Google session ──────────────────
    const sessionOk = await verifySession(page);
    if (!sessionOk) {
        console.log('⚠️ Google session verification failed! Attempting automatic login...');
        const loginSuccess = await autoLoginFlow(page);
        if (!loginSuccess) {
            console.log('❌ Auto-login failed during session verification.');
            await takeScreenshot(page, 'debug_signin_failed.png');
            await browser.close();
            process.exit(1);
        }
        console.log('✅ Auto-login succeeded.');
    }

    // ─── Go DIRECTLY to the meeting link ────────
    // Skip meet.google.com homepage check — it often redirects to
    // workspace marketing page even with valid cookies in headless mode.
    // The real test is whether the actual meeting link works.
    console.log(`\n⏳ Going directly to meeting: ${MEET_LINK}`);
    try {
        await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (_) { /* timeout is non-fatal */ }

    await sleep(3000);
    await takeScreenshot(page, 'step0_after_navigate.png');

    // ─── Check what page we landed on ───────────
    const landingUrl = page.url();
    const landingText = await getPageText(page);
    console.log(`📍 Landed on: ${landingUrl}`);
    console.log(`📄 Page text: "${landingText.substring(0, 150).replace(/\n/g, ' ')}..."`);

    // Check if redirected to sign-in or requires sign in (guest mode)
    const requiresSignIn = await page.evaluate(() => {
        const url = window.location.href;
        if (url.includes('ServiceLogin') || url.includes('signin/identifier') || url.includes('signin/v2') || url.includes('accounts.google.com')) {
            return true;
        }

        const text = document.body ? document.body.innerText.toLowerCase() : '';
        if (text.includes("what's your name") ||
            text.includes("ما اسمك") ||
            text.includes("sign in with your google account") ||
            text.includes("تسجيل الدخول باستخدام حساب google")) {
            return true;
        }

        const links = document.querySelectorAll('a, button, span');
        for (const link of links) {
            const t = (link.textContent || '').trim().toLowerCase();
            if (t === 'sign in' || t === 'تسجيل الدخول') {
                return true;
            }
        }
        return false;
    });

    if (requiresSignIn) {
        console.log('⚠️ Guest mode or sign-in prompt detected! Attempting automatic login...');
        const loginSuccess = await autoLoginFlow(page);
        if (!loginSuccess) {
            console.log('❌ Auto-login failed.');
            await takeScreenshot(page, 'debug_signin_failed.png');
            await browser.close();
            process.exit(1);
        }

        console.log('✅ Auto-login succeeded. Proceeding to meeting link...');
        // Go to meeting link again
        try {
            await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
            await sleep(3000);
        } catch (_) { }
    }

    // Check for workspace/marketing page redirect
    if (landingUrl.includes('workspace.google.com')) {
        console.log('❌ Redirected to workspace marketing page!');
        console.log('   Meet cookies are not working in headless mode.');
        console.log('   Trying direct URL with authuser parameter...');

        // Try with authuser=0
        try {
            const meetUrlWithAuth = MEET_LINK + (MEET_LINK.includes('?') ? '&' : '?') + 'authuser=0';
            console.log(`   Trying: ${meetUrlWithAuth}`);
            await page.goto(meetUrlWithAuth, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);

            const retryUrl = page.url();
            console.log(`   📍 Result: ${retryUrl}`);

            if (retryUrl.includes('workspace.google.com') || retryUrl.includes('ServiceLogin')) {
                console.log('❌ Still redirected. Session not valid for Meet.');
                await takeScreenshot(page, 'debug_workspace_redirect.png');
                await browser.close();
                process.exit(1);
            }
        } catch (_) { }
    }

    // ─── Handle "Choose an account" page ────────
    await handleAccountChooser(page);

    // Re-check URL after account chooser
    const postChooseUrl = page.url();
    if (postChooseUrl.includes('ServiceLogin') || postChooseUrl.includes('signin')) {
        console.log('❌ Account selection led to sign-in. Session dead.');
        await takeScreenshot(page, 'debug_post_choose_signin.png');
        await browser.close();
        process.exit(1);
    }

    // ─── Check for "can't join" ─────────────────
    const pageText = await getPageText(page);
    if (isMeetingUnavailable(pageText)) {
        console.log('⚠️ Meeting is not available right now:');
        console.log(`   "${pageText.substring(0, 150).replace(/\n/g, ' ')}"`);
        await takeScreenshot(page, 'debug_meeting_unavailable.png');
        await saveFreshCookies(page);
        await browser.close();
        console.log('\n⚠️ Meeting not available. Will retry next scheduled run.');
        process.exit(0);
    }

    // ─── Wait for join page ─────────────────────
    console.log('⏳ Waiting for join page...');
    let joinReady = await waitForJoinPage(page);

    if (joinReady === 'NEEDS_LOGIN') {
        const loginSuccess = await autoLoginFlow(page);
        if (loginSuccess) {
            console.log('✅ Auto-login succeeded. Proceeding to meeting link...');
            try { await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 }); } catch (_) { }
            joinReady = await waitForJoinPage(page);
        } else {
            console.log('❌ Auto-login failed during join wait.');
            await takeScreenshot(page, 'debug_signin_failed.png');
            await browser.close();
            process.exit(1);
        }
    }

    await takeScreenshot(page, 'step1_before_join.png');

    if (!joinReady) {
        console.log('⚠️ Could not reach join page.');
        const stateText = await getPageText(page);
        console.log(`   State: "${stateText.substring(0, 200).replace(/\n/g, ' ')}"`);
    }

    // ─── Fill Guest Name if prompted ────────────
    await fillGuestName(page);

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
    await tryJoin(page, { maxAttempts: 5 });
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
        (lower.includes('return to home screen') && lower.includes("can't"))
    );
}

async function takeScreenshot(page, filename) {
    try {
        await page.screenshot({ path: path.join(REPORTS_DIR, filename) });
    } catch (_) { /* non-critical */ }
}

async function handleAccountChooser(page) {
    await sleep(2000);
    try {
        const text = await getPageText(page);
        if (!text.includes('Choose an account') && !text.includes('اختيار حساب')) {
            return; // Not on account chooser
        }

        console.log('🔄 "Choose an account" detected, clicking account...');

        const clicked = await page.evaluate(() => {
            // Try data-identifier first
            const items = document.querySelectorAll('[data-identifier], [data-email]');
            if (items.length > 0) {
                items[0].click();
                return 'data-identifier';
            }
            // Try list items with email
            const listItems = document.querySelectorAll('li');
            for (const li of listItems) {
                const t = li.textContent || '';
                if (t.includes('@') && !t.includes('Use another') && !t.includes('Remove')) {
                    li.click();
                    return 'li-email';
                }
            }
            // Try divs
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
        } else {
            console.log('⚠️ Could not find account to click');
        }
    } catch (err) {
        console.log(`⚠️ Account chooser handler: ${err.message}`);
    }
}

async function waitForJoinPage(page) {
    for (let attempt = 0; attempt < 30; attempt++) {
        await sleep(2000);
        const url = page.url();

        try {
            const bodyText = await getPageText(page);

            // Session expired check
            if (url.includes('ServiceLogin') || url.includes('signin/identifier')) {
                console.log('❌ Session expired!');
                return false;
            }

            // Account chooser
            if (bodyText.includes('Choose an account') || bodyText.includes('اختيار حساب')) {
                await handleAccountChooser(page);
                continue;
            }

            // Guest mode / Sign in check
            const needsSignIn = await page.evaluate(() => {
                const text = document.body ? document.body.innerText.toLowerCase() : '';
                return text.includes("what's your name") ||
                    text.includes("ما اسمك") ||
                    text.includes("sign in with your google account");
            });

            if (needsSignIn) {
                console.log('⚠️ Guest mode detected while waiting. Returning to auto-login...');
                return 'NEEDS_LOGIN';
            }

            // Meeting unavailable
            if (isMeetingUnavailable(bodyText)) {
                console.log(`❌ Meeting unavailable [${attempt + 1}]`);
                return false;
            }

            // Check for join button text
            for (const textMatch of JOIN_TEXTS) {
                const found = await page.evaluate((text) => {
                    const elements = document.querySelectorAll('span, button');
                    for (const el of elements) {
                        if (el.textContent.includes(text)) return true;
                    }
                    return false;
                }, textMatch);

                if (found) {
                    console.log(`✅ Join page ready! [${attempt + 1}] Found: "${textMatch}"`);
                    return true;
                }
            }

            // Check for pre-join screen indicators
            const hasPreJoin = await page.evaluate(() => {
                const el = document.querySelector('[data-is-muted], [aria-label*="microphone"], [aria-label*="camera"], [aria-label*="ميكروفون"], [aria-label*="كاميرا"]');
                return !!el;
            });

            if (hasPreJoin) {
                console.log(`✅ Pre-join screen detected! [${attempt + 1}]`);
                return true;
            }

            // Check for "connecting" state (already joining)
            if (bodyText.includes('جارٍ الاتصال') || bodyText.includes('Connecting')) {
                console.log(`✅ Already connecting! [${attempt + 1}]`);
                return true;
            }

            if (attempt % 5 === 0) {
                const short = bodyText.replace(/\n/g, ' ').substring(0, 100);
                console.log(`⏳ [${attempt + 1}] URL: ${url.substring(0, 60)} | "${short}..."`);
            }

            // Retry if stuck on meet homepage
            if ((url === 'https://meet.google.com/' || url === 'https://meet.google.com') && (attempt === 3 || attempt === 10)) {
                console.log('⚠️ On homepage, retrying...');
                try { await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 30000 }); } catch (_) { }
            }
        } catch (err) {
            console.log(`⚠️ Wait error: ${err.message}`);
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
    } catch (_) { }
    await sleep(500);
}

async function tryJoin(page, { maxAttempts = 5 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const clicked = await clickJoinButton(page);
        if (clicked) {
            console.log(`✅ Join button clicked (attempt ${attempt})`);
            await sleep(10000);

            const result = await getPageText(page);
            if (result.includes('Leave') || result.includes('مغادرة') ||
                result.includes('جارٍ الاتصال') || result.includes('Connecting')) {
                console.log('✅ Join successful or connecting!');
                return true;
            }

            const stillJoinPage = await isOnJoinPage(page);
            if (!stillJoinPage) return true;
            console.log(`⚠️ Still on join page after attempt ${attempt}`);
        }

        if (attempt < maxAttempts) {
            console.log(`⚠️ Retrying join (attempt ${attempt + 1})...`);
            await page.keyboard.press('Escape');
            await sleep(500);

            const forcedClick = await forceClickJoinButton(page);
            if (forcedClick) {
                await sleep(10000);
                const stillJoinPage = await isOnJoinPage(page);
                if (!stillJoinPage) return true;
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

                if (skipTexts.some(s => text.includes(s))) continue;
                if (joinTexts.some(j => text.includes(j))) {
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
                if (skipTexts.some(s => text.includes(s))) continue;
                const area = rect.width * rect.height;
                const isBlue = style.backgroundColor.includes('26, 115, 232') || style.backgroundColor.includes('66, 133, 244');
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
                if (joinTexts.some(j => text.includes(j))) {
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
            const focused = await page.evaluate(() => document.activeElement ? document.activeElement.textContent.trim() : '').catch(() => '');
            if (focused.includes('انضم') || focused.includes('Join') || focused.includes('الانضمام')) {
                console.log(`✅ Focused: "${focused}" → Enter`);
                await page.keyboard.press('Enter');
                await sleep(10000);
                return true;
            }
        }
    } catch (_) { }
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
    const text = await getPageText(page);
    const url = page.url();

    if (text.includes("can't join") || text.includes('لا يمكنك')) {
        console.log('❌ Rejected from meeting');
    } else if (text.includes('Leave') || text.includes('مغادرة')) {
        console.log('✅ JOINED SUCCESSFULLY!');
    } else if (text.includes('جارٍ الاتصال') || text.includes('Connecting')) {
        console.log('⏳ Connecting... waiting more...');
        await sleep(15000);
        const newText = await getPageText(page);
        if (newText.includes('Leave') || newText.includes('مغادرة')) {
            console.log('✅ JOINED SUCCESSFULLY!');
        } else {
            console.log(`⚠️ Still connecting: "${newText.substring(0, 100)}"`);
        }
    } else if (text.includes('Choose an account') || text.includes('اختيار حساب')) {
        console.log('⚠️ Account chooser — trying to select...');
        await handleAccountChooser(page);
        await sleep(5000);
        try { await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 30000 }); } catch (_) { }
    } else if (text.includes('انضم') || text.includes('Join')) {
        console.log('⚠️ Still on join page, final attempt...');
        await forceClickJoinButton(page);
        await sleep(10000);
    } else {
        console.log(`⚠️ Unknown state: "${text.substring(0, 200).replace(/\n/g, ' ')}"`);
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
        } catch (_) { }

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

async function fillGuestName(page) {
    console.log('📝 Checking for guest name input...');
    try {
        const filled = await page.evaluate((guestName) => {
            const inputs = document.querySelectorAll('input[type="text"]');
            for (const input of inputs) {
                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
                const textContext = (input.parentElement.innerText || '').toLowerCase();
                if (placeholder.includes('name') || ariaLabel.includes('name') ||
                    placeholder.includes('اسم') || ariaLabel.includes('اسم') ||
                    textContext.includes('name') || textContext.includes('اسم')) {

                    input.focus();
                    input.value = guestName;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    // Also trigger typing via UI events if React is stubborn
                    return true;
                }
            }
            return false;
        }, process.env.MEETING_NAME || 'Attendance Bot');

        if (filled) {
            console.log('✅ Found guest name input! Filled out to allow join.');
            // Type a space and backspace to trigger React's onChange state update
            await page.keyboard.press('Space');
            await page.keyboard.press('Backspace');
            await sleep(2000);
        } else {
            console.log('ℹ️ No guest name input found, assuming account is logged in.');
        }
    } catch (err) {
        console.log(`⚠️ fillGuestName: ${err.message}`);
    }
}

async function autoLoginFlow(page) {
    const EMAIL = process.env.GOOGLE_EMAIL;
    const PASSWORD = process.env.GOOGLE_PASSWORD;

    if (!EMAIL || !PASSWORD) {
        console.error('❌ Missing GOOGLE_EMAIL or GOOGLE_PASSWORD in .env file!');
        return false;
    }

    console.log('🤖 Starting automated login flow...');
    try {
        await page.goto('https://accounts.google.com/ServiceLogin', { waitUntil: 'networkidle2' });

        console.log('entering email...');
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await sleep(1000);
        await page.type('input[type="email"]', EMAIL, { delay: 100 });
        await page.keyboard.press('Enter');

        console.log('Waiting for password field or verification...');
        await sleep(4000);

        // Wait for password field
        try {
            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
            await sleep(1000);
            console.log('entering password...');
            await page.type('input[type="password"]', PASSWORD, { delay: 100 });
            await page.keyboard.press('Enter');
        } catch (e) {
            console.log('⚠️ Password field timeout. Checking if additional verification required.');
        }

        console.log('Waiting for login to complete...');
        // Wait for redirection
        for (let i = 0; i < 20; i++) {
            await sleep(3000);
            const url = page.url();
            if (url.includes('myaccount.google.com') || url.includes('mail.google.com') || url.includes('myadcenter.google.com') || url.includes('accounts.google.com/v3/signin/speedbump')) {
                console.log('Google account login appears successful.');
                return true;
            }
        }

    } catch (e) {
        console.log('⚠️ autologin error:', e.message);
    }

    return false;
}

main().catch((err) => {
    console.error('❌ Bot error:', err);
    process.exit(1);
});