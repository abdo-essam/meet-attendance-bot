var puppeteer = require('puppeteer-extra');
var StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
var fs = require('fs');
var path = require('path');
var cryptoHelper = require('./crypto-helper');

var meetLink = process.env.MEET_LINK || 'https://meet.google.com/';
var durationMinutes = parseInt(process.env.DURATION_MINUTES || '120');

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('═'.repeat(50));
    console.log('🤖 Meet Attendance Bot');
    console.log('═'.repeat(50));

    // ─── Load Cookies ───
    console.log('\n🍪 Loading Google session...');

    var cookies = [];
    var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';

    var encPath = path.join(__dirname, '..', 'cookies', 'session.enc');
    if (cookies.length === 0 && fs.existsSync(encPath)) {
        try {
            var enc = fs.readFileSync(encPath, 'utf8');
            cookies = JSON.parse(cryptoHelper.decrypt(enc, COOKIE_PASSWORD));
            console.log('✅ Loaded from encrypted file (' + cookies.length + ' cookies)');
        } catch (e) {
            console.log('⚠️ Encrypted file failed: ' + e.message);
        }
    }

    var rawPath = path.join(__dirname, 'cookies.json');
    if (cookies.length === 0 && fs.existsSync(rawPath)) {
        try {
            cookies = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
            console.log('✅ Loaded from cookies.json (' + cookies.length + ' cookies)');
        } catch (e) {
            console.log('⚠️ cookies.json failed: ' + e.message);
        }
    }

    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try {
            var decoded = Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8');
            cookies = JSON.parse(decoded);
            console.log('✅ Loaded from GitHub Secret (' + cookies.length + ' cookies)');
        } catch (e) {
            console.log('⚠️ Secret failed: ' + e.message);
        }
    }

    if (cookies.length === 0) {
        console.log('❌ NO COOKIES! Run save-cookies.js on your PC first.');
        process.exit(1);
    }

    // ─── Launch Browser (minimal args that work) ───
    console.log('\n🚀 Launching browser...');

    var browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--auto-accept-camera-and-microphone-capture',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720'
        ],
        defaultViewport: { width: 1280, height: 720 },
        protocolTimeout: 120000
    });

    console.log('✅ Browser launched!');

    var page = await browser.newPage();

    try {
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://meet.google.com', [
            'camera', 'microphone', 'notifications'
        ]);
    } catch (e) { }

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
    });

    // ─── Load Cookies ───
    try {
        const client = await page.target().createCDPSession();
        const validCookies = cookies.map(c => {
            let copy = { ...c };
            delete copy.size;
            delete copy.session;
            return copy;
        });
        await client.send('Network.setCookies', { cookies: validCookies });
        console.log('✅ Cookies loaded into browser via CDP');
    } catch (e) {
        console.log('⚠️ CDP cookie error: ' + e.message);
        try { await page.setCookie(...cookies); } catch (err) { }
    }

    // ─── Verify Google Session ───
    console.log('\n🌐 Verifying Google Session...');

    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await sleep(5000);
    } catch (e) {
        console.log('⚠️ Navigation error: ' + e.message);
    }

    const currUrl = page.url();
    console.log('📍 Current URL: ' + currUrl);

    const isSignedIn =
        currUrl.includes('myaccount.google.com') ||
        currUrl.includes('accounts.google.com/SignOutOptions') ||
        currUrl.includes('google.com/account/about');

    const isOnSignIn =
        currUrl.includes('ServiceLogin') ||
        currUrl.includes('signin/v2') ||
        currUrl.includes('accounts.google.com/v3/signin') ||
        currUrl.includes('signin/identifier');

    if (!isSignedIn || isOnSignIn) {
        console.log('❌ Google session invalid! URL: ' + currUrl);
        var reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        try { await page.screenshot({ path: path.join(reportsDir, 'debug_session_failed.png'), fullPage: true }); } catch (e) { }
        await browser.close();
        process.exit(1);
    }
    console.log('✅ Google session verified!');

    // ─── Navigate to Meet ───
    console.log('\n⏳ Navigating to ' + meetLink + '...');

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    try {
        await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 90000 });
    } catch (e) {
        console.log('⚠️ Navigation timeout, continuing anyway...');
    }

    // ─── Wait for join page to fully load ───
    console.log('⏳ Waiting for join page...');

    let joinPageReady = false;
    for (let waitAttempt = 0; waitAttempt < 30; waitAttempt++) {
        await sleep(2000);

        const currentUrl = page.url();
        const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');

        console.log('[Wait ' + (waitAttempt + 1) + '/30] URL: ' + currentUrl);

        // Check if we see the join button or "ready to join" text
        if (
            pageText.includes('انضم الآن') ||
            pageText.includes('Join now') ||
            pageText.includes('Ask to join') ||
            pageText.includes('طلب الانضمام') ||
            pageText.includes('مستعد للانضمام')
        ) {
            console.log('✅ Join page detected!');
            joinPageReady = true;
            break;
        }

        // Check if meeting ended or not available
        if (
            pageText.includes("can't join") ||
            pageText.includes('لا يمكنك الانضمام') ||
            pageText.includes('Meeting has ended') ||
            pageText.includes('انتهى الاجتماع') ||
            pageText.includes('Not allowed') ||
            pageText.includes('Check your meeting code')
        ) {
            console.log('❌ Meeting is not available: ' + pageText.substring(0, 200));
            try { await page.screenshot({ path: path.join(reportsDir, 'meeting_unavailable.png') }); } catch (e) { }
            break;
        }

        // Check if we're on Meet homepage (not logged in to Meet)
        if (pageText.includes('تسجيل الدخول') && pageText.includes('Google Meet') && !currentUrl.includes('meet.google.com/')) {
            console.log('⚠️ Landed on Meet homepage instead of meeting room');
            console.log('   Trying direct navigation again...');
            try {
                await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 30000 });
            } catch (e) { }
        }
    }

    try {
        await page.screenshot({ path: path.join(reportsDir, 'step1_before_join.png') });
        console.log('📸 Step 1: Before join screenshot');
    } catch (e) { }

    if (!joinPageReady) {
        console.log('⚠️ Join page not detected, attempting to join anyway...');
    }

    // ─── Dismiss popups FAST ───
    console.log('\n🔕 Dismissing popups...');
    await page.keyboard.press('Escape');
    await sleep(500);

    // Try clicking X button on popup
    try {
        const dismissed = await page.evaluate(() => {
            // Find and click any close/dismiss buttons
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const aria = btn.getAttribute('aria-label') || '';
                const text = btn.textContent.trim();
                if (aria === 'Close' || aria === 'إغلاق' || aria === 'Dismiss' ||
                    text === 'close' || text === '✕' || text === 'Got it' || text === 'حسنًا') {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        if (dismissed) console.log('✅ Dismissed popup');
    } catch (e) { }

    await sleep(500);

    // ─── Mute mic and camera FAST ───
    console.log('🔇 Muting...');
    await page.keyboard.down('Control');
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    await page.keyboard.up('Control');
    await sleep(1000);

    // ─── JOIN THE MEETING — All methods in rapid succession ───
    console.log('\n🚪 JOINING MEETING...');

    let inMeeting = false;

    // ═══ METHOD 1: page.evaluate — Find and click join button directly in DOM ═══
    try {
        const result = await page.evaluate(() => {
            const joinTexts = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'الانضمام الآن'];
            const skipTexts = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present', 'عرض'];

            const buttons = document.querySelectorAll('button, [role="button"]');
            const found = [];

            for (const btn of buttons) {
                const text = btn.textContent.trim();
                const rect = btn.getBoundingClientRect();
                const style = window.getComputedStyle(btn);

                // Skip invisible
                if (rect.width === 0 || rect.height === 0) continue;
                if (style.display === 'none' || style.visibility === 'hidden') continue;

                found.push({
                    text: text.substring(0, 80),
                    width: rect.width,
                    height: rect.height,
                    tag: btn.tagName
                });

                // Skip excluded buttons
                let skip = false;
                for (const s of skipTexts) {
                    if (text.includes(s)) { skip = true; break; }
                }
                if (skip) continue;

                // Check for join text
                for (const jt of joinTexts) {
                    if (text.includes(jt)) {
                        btn.click();
                        return { clicked: text, allButtons: found };
                    }
                }
            }

            // Fallback: find the largest blue button
            let bestBtn = null;
            let bestArea = 0;
            for (const btn of buttons) {
                const rect = btn.getBoundingClientRect();
                const style = window.getComputedStyle(btn);
                const text = btn.textContent.trim();
                const bg = style.backgroundColor;

                let skip = false;
                for (const s of skipTexts) {
                    if (text.includes(s)) { skip = true; break; }
                }
                if (skip) continue;

                const area = rect.width * rect.height;
                const isBlue = bg.includes('26, 115, 232') || bg.includes('24, 90, 188') || bg.includes('66, 133, 244');

                if (isBlue && area > bestArea && area > 3000) {
                    bestBtn = btn;
                    bestArea = area;
                }
            }

            if (bestBtn) {
                bestBtn.click();
                return { clicked: 'BLUE_BUTTON: ' + bestBtn.textContent.trim(), allButtons: found };
            }

            return { clicked: null, allButtons: found };
        });

        console.log('📋 All visible buttons: ' + JSON.stringify(result.allButtons, null, 2));

        if (result.clicked) {
            console.log('✅ METHOD 1: Clicked "' + result.clicked + '"');
            inMeeting = true;
        } else {
            console.log('⚠️ METHOD 1: No join button found');
        }
    } catch (e) {
        console.log('⚠️ METHOD 1 error: ' + e.message);
    }

    // Wait for click to take effect
    if (inMeeting) {
        console.log('⏳ Waiting 8 seconds for join to process...');
        await sleep(8000);
    }

    // ═══ METHOD 2: If first click landed on "ready to join" with popup, try again ═══
    if (!inMeeting) {
        console.log('🔍 METHOD 2: Retrying after Escape...');
        await page.keyboard.press('Escape');
        await sleep(1000);

        try {
            const clicked2 = await page.evaluate(() => {
                const joinTexts = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام'];
                const skipTexts = ['طرق أخرى', 'Other ways', 'expand_more'];
                const buttons = document.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    const rect = btn.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;

                    let skip = false;
                    for (const s of skipTexts) { if (text.includes(s)) { skip = true; break; } }
                    if (skip) continue;

                    for (const jt of joinTexts) {
                        if (text.includes(jt)) {
                            btn.click();
                            return text;
                        }
                    }
                }
                return null;
            });

            if (clicked2) {
                console.log('✅ METHOD 2: Clicked "' + clicked2 + '"');
                inMeeting = true;
                await sleep(8000);
            }
        } catch (e) { }
    }

    // ═══ METHOD 3: Tab + Enter as last resort ═══
    if (!inMeeting) {
        console.log('🔍 METHOD 3: Tab + Enter...');
        for (let i = 0; i < 10; i++) {
            await page.keyboard.press('Tab');
            await sleep(200);
        }
        await page.keyboard.press('Enter');
        await sleep(5000);
    }

    // ─── Take screenshot after join ───
    try {
        await page.screenshot({ path: path.join(reportsDir, 'step2_after_join.png') });
        console.log('📸 Step 2: After join screenshot');
    } catch (e) { }

    // ─── Check if we're in the meeting or got rejected ───
    console.log('\n🔍 Checking join result...');
    await sleep(3000);

    const postJoinText = await page.evaluate(() => document.body.innerText).catch(() => '');

    if (postJoinText.includes("can't join") || postJoinText.includes('لا يمكنك الانضمام')) {
        console.log('❌ REJECTED: "You can\'t join this video call"');
        console.log('   Possible reasons:');
        console.log('   1. Meeting has ended');
        console.log('   2. Host hasn\'t started the meeting yet');
        console.log('   3. Your account is not allowed to join');
        console.log('   4. Meeting requires host approval and host is not present');
    } else if (
        postJoinText.includes('Leave call') ||
        postJoinText.includes('مغادرة') ||
        postJoinText.includes('You') ||
        postJoinText.includes('أنت')
    ) {
        console.log('✅ CONFIRMED: Successfully joined the meeting!');
    } else if (
        postJoinText.includes('انضم الآن') ||
        postJoinText.includes('Join now')
    ) {
        console.log('⚠️ Still on join page — trying one more click...');

        try {
            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    if (text.includes('انضم الآن') || text.includes('Join now')) {
                        btn.click();
                        return;
                    }
                }
            });
            await sleep(8000);
            console.log('   Extra click attempted');
        } catch (e) { }
    } else {
        console.log('⚠️ Unknown state. Page text preview:');
        console.log(postJoinText.substring(0, 300));
    }

    // ─── Stay in Meeting ───
    console.log('\n🎥 Staying for ' + durationMinutes + ' minutes...');

    let screenshotIndex = 1;
    var endTime = Date.now() + (durationMinutes * 60 * 1000);

    while (Date.now() < endTime) {
        var minutesLeft = Math.round((endTime - Date.now()) / 60000);
        console.log('[' + new Date().toISOString() + '] ' + minutesLeft + ' min remaining');

        try {
            await page.screenshot({ path: path.join(reportsDir, 'screenshot_' + screenshotIndex + '.png') });
        } catch (err) { }
        screenshotIndex++;

        try {
            await page.mouse.move(
                Math.floor(Math.random() * 800) + 100,
                Math.floor(Math.random() * 500) + 100
            );
        } catch (e) { }

        const timeLeft = endTime - Date.now();
        const waitMs = Math.min(timeLeft, 10 * 60 * 1000);
        if (waitMs <= 0) break;
        await sleep(waitMs);
    }

    console.log('\n✅ Meeting time over.');

    // ─── Report ───
    var reportContent = [
        '═══════════════════════════════════════',
        '📊 Attendance Report',
        '═══════════════════════════════════════',
        '',
        'Meeting Link: ' + meetLink,
        'Meeting Name: ' + (process.env.MEETING_NAME || 'Unknown'),
        'Duration:     ' + durationMinutes + ' minutes',
        'Started:      ' + new Date(endTime - durationMinutes * 60000).toISOString(),
        'Ended:        ' + new Date().toISOString(),
        'Screenshots:  ' + (screenshotIndex - 1),
        '',
        '═══════════════════════════════════════'
    ].join('\n');

    fs.writeFileSync(path.join(reportsDir, 'report.txt'), reportContent);
    console.log('📄 Report saved');

    // ─── Save Cookies ───
    console.log('\n🍪 Saving refreshed cookies...');

    try {
        const client = await page.target().createCDPSession();
        const { cookies: freshCookies } = await client.send('Network.getAllCookies');

        if (freshCookies.length >= 10) {
            fs.writeFileSync(path.join(__dirname, 'cookies.json'), JSON.stringify(freshCookies), 'utf8');

            var encrypted = cryptoHelper.encrypt(JSON.stringify(freshCookies), COOKIE_PASSWORD);
            var cookiesDir = path.join(__dirname, '..', 'cookies');
            if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
            fs.writeFileSync(path.join(cookiesDir, 'session.enc'), encrypted, 'utf8');

            console.log('✅ Saved ' + freshCookies.length + ' cookies');
        } else {
            console.log('⚠️ Too few cookies (' + freshCookies.length + '), skipping save');
        }
    } catch (e) {
        console.log('⚠️ Cookie save error: ' + e.message);
    }

    await browser.close();
    console.log('\n✅ Done!');
}

main().catch(function (e) {
    console.error('❌ Bot error:', e);
    process.exit(1);
});