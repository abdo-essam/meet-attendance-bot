// Use regular puppeteer for launching (it works!)
var vanillaPuppeteer = require('puppeteer');

// Use puppeteer-extra stealth for page-level evasion
var { PuppeteerExtraPlugin } = require('puppeteer-extra-plugin');
var StealthPlugin = require('puppeteer-extra-plugin-stealth');

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
        console.log('❌ NO COOKIES!');
        process.exit(1);
    }

    // ─── Launch Browser using vanilla puppeteer ───
    console.log('\n🚀 Launching browser...');
    console.log('Puppeteer Chrome: ' + vanillaPuppeteer.executablePath());
    console.log('Exists: ' + fs.existsSync(vanillaPuppeteer.executablePath()));

    var browser = await vanillaPuppeteer.launch({
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

    // ─── Apply stealth manually via page-level evasion ───
    try {
        await page.evaluateOnNewDocument(() => {
            // Hide webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => false });

            // Hide automation
            window.navigator.chrome = { runtime: {} };

            // Fake plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });

            // Fake languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en', 'ar']
            });

            // Hide Chrome headless signals
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters);
        });
        console.log('✅ Stealth evasion applied');
    } catch (e) {
        console.log('⚠️ Stealth evasion: ' + e.message);
    }

    try {
        const context = browser.defaultBrowserContext();
        await context.overridePermissions('https://meet.google.com', [
            'camera', 'microphone', 'notifications'
        ]);
    } catch (e) { }

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
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
        console.log('✅ Cookies loaded into browser');
    } catch (e) {
        try { await page.setCookie(...cookies); } catch (err) { }
    }

    // ─── Verify Session ───
    console.log('\n🌐 Verifying Google Session...');

    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'domcontentloaded', timeout: 30000
        });
        await sleep(5000);
    } catch (e) { }

    const currUrl = page.url();
    console.log('📍 URL: ' + currUrl);

    const isSignedIn =
        currUrl.includes('myaccount.google.com') ||
        currUrl.includes('accounts.google.com/SignOutOptions') ||
        currUrl.includes('google.com/account/about');
    const isOnSignIn =
        currUrl.includes('ServiceLogin') ||
        currUrl.includes('signin/v2') ||
        currUrl.includes('accounts.google.com/v3/signin') ||
        currUrl.includes('signin/identifier');

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    if (!isSignedIn || isOnSignIn) {
        console.log('❌ Session invalid!');
        try { await page.screenshot({ path: path.join(reportsDir, 'debug_session.png'), fullPage: true }); } catch (e) { }
        await browser.close();
        process.exit(1);
    }
    console.log('✅ Session verified!');

    // ─── Navigate to Meet Link ───
    console.log('\n⏳ Going to ' + meetLink + '...');

    try {
        await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (e) {
        console.log('⚠️ Navigation timeout, continuing...');
    }

    // ─── Wait for join page ───
    console.log('⏳ Waiting for meeting page...');

    let joinPageState = 'unknown';

    for (let w = 0; w < 30; w++) {
        await sleep(2000);

        let pageText = '';
        try {
            pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
        } catch (e) { continue; }

        let url = page.url();

        if (pageText.includes('انضم الآن') || pageText.includes('Join now') ||
            pageText.includes('Ask to join') || pageText.includes('طلب الانضمام') ||
            pageText.includes('مستعد للانضمام')) {
            console.log('✅ [' + (w+1) + '] Join page ready!');
            joinPageState = 'ready';
            break;
        }

        if (pageText.includes("can't join") || pageText.includes('لا يمكنك الانضمام') ||
            pageText.includes('Meeting has ended') || pageText.includes('انتهى')) {
            console.log('❌ [' + (w+1) + '] Meeting unavailable');
            joinPageState = 'unavailable';
            break;
        }

        if (url === 'https://meet.google.com/' || url === 'https://meet.google.com') {
            if (w === 5 || w === 15) {
                console.log('⚠️ [' + (w+1) + '] On homepage, retrying...');
                try { await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 30000 }); } catch (e) { }
            }
        }

        if (w % 5 === 0) console.log('⏳ [' + (w+1) + '/30] URL: ' + url.substring(0, 60));
    }

    try { await page.screenshot({ path: path.join(reportsDir, 'step1_before_join.png') }); } catch (e) { }

    // ─── Dismiss popups ───
    console.log('\n🔕 Dismissing popups...');
    for (let esc = 0; esc < 3; esc++) {
        await page.keyboard.press('Escape');
        await sleep(300);
    }

    try {
        await page.evaluate(() => {
            var dismissTexts = ['close', 'Close', 'إغلاق', 'Dismiss', 'Got it', 'حسنًا', 'OK'];
            var buttons = document.querySelectorAll('button, [role="button"]');
            for (var btn of buttons) {
                var text = btn.textContent.trim();
                var aria = btn.getAttribute('aria-label') || '';
                for (var dt of dismissTexts) {
                    if (text === dt || aria === dt || aria.includes('Close') || aria.includes('إغلاق')) {
                        btn.click();
                        return;
                    }
                }
            }
        });
    } catch (e) { }
    await sleep(500);

    // ─── Mute ───
    console.log('🔇 Muting...');
    await page.keyboard.down('Control');
    await page.keyboard.press('d');
    await page.keyboard.press('e');
    await page.keyboard.up('Control');
    await sleep(1000);

    try { await page.screenshot({ path: path.join(reportsDir, 'step2_after_mute.png') }); } catch (e) { }

    // ─── JOIN MEETING ───
    console.log('\n🚪 JOINING...');

    let clickedButton = null;

    // METHOD 1: DOM click
    try {
        clickedButton = await page.evaluate(() => {
            var joinTexts = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'الانضمام الآن'];
            var skipTexts = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present'];

            var allBtns = document.querySelectorAll('button, [role="button"]');
            var btnInfo = [];

            for (var btn of allBtns) {
                var text = btn.textContent.trim();
                var rect = btn.getBoundingClientRect();
                var style = window.getComputedStyle(btn);

                if (rect.width === 0 || rect.height === 0) continue;
                if (style.display === 'none' || style.visibility === 'hidden') continue;

                btnInfo.push(text.substring(0, 60) + ' [' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ']');

                var skip = false;
                for (var s of skipTexts) { if (text.includes(s)) { skip = true; break; } }
                if (skip) continue;

                for (var jt of joinTexts) {
                    if (text.includes(jt)) {
                        btn.click();
                        return { clicked: text, buttons: btnInfo };
                    }
                }
            }

            // Fallback: largest blue button
            var best = null, bestArea = 0;
            for (var btn of allBtns) {
                var rect = btn.getBoundingClientRect();
                var style = window.getComputedStyle(btn);
                var text = btn.textContent.trim();
                var bg = style.backgroundColor;

                var skip = false;
                for (var s of skipTexts) { if (text.includes(s)) { skip = true; break; } }
                if (skip) continue;

                var area = rect.width * rect.height;
                var isBlue = bg.includes('26, 115, 232') || bg.includes('24, 90, 188') || bg.includes('66, 133, 244');

                if (isBlue && area > bestArea && area > 3000) {
                    best = btn;
                    bestArea = area;
                }
            }

            if (best) {
                best.click();
                return { clicked: 'BLUE:' + best.textContent.trim(), buttons: btnInfo };
            }

            return { clicked: null, buttons: btnInfo };
        });

        if (clickedButton) {
            console.log('📋 Buttons: ' + JSON.stringify(clickedButton.buttons));
            if (clickedButton.clicked) {
                console.log('✅ Clicked: "' + clickedButton.clicked + '"');
            } else {
                console.log('⚠️ No join button found');
            }
        }
    } catch (e) {
        console.log('⚠️ Method 1 error: ' + e.message);
    }

    await sleep(8000);

    // METHOD 2: Retry if still on join page
    try {
        var stillOnJoin = await page.evaluate(() => {
            return document.body.innerText.includes('انضم الآن') || document.body.innerText.includes('Join now');
        });
        if (stillOnJoin) {
            console.log('⚠️ Still on join page, retrying...');
            await page.keyboard.press('Escape');
            await sleep(500);
            await page.evaluate(() => {
                var btns = document.querySelectorAll('button');
                for (var btn of btns) {
                    var t = btn.textContent.trim();
                    if (t === 'انضم الآن' || t === 'Join now' || t === 'Ask to join' || t === 'طلب الانضمام') {
                        btn.focus();
                        btn.click();
                        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        return;
                    }
                }
            });
            await sleep(8000);
        }
    } catch (e) { }

    // METHOD 3: Keyboard Tab + Enter
    try {
        var stillOnJoin2 = await page.evaluate(() => {
            return document.body.innerText.includes('انضم الآن') || document.body.innerText.includes('Join now');
        });
        if (stillOnJoin2) {
            console.log('⚠️ Trying keyboard navigation...');
            for (let t = 0; t < 20; t++) {
                await page.keyboard.press('Tab');
                await sleep(200);
                var focused = await page.evaluate(() => {
                    var el = document.activeElement;
                    return el ? el.textContent.trim() : '';
                }).catch(() => '');
                if (focused.includes('انضم') || focused.includes('Join')) {
                    console.log('✅ Focused: "' + focused + '" → Enter');
                    await page.keyboard.press('Enter');
                    await sleep(8000);
                    break;
                }
            }
        }
    } catch (e) { }

    try { await page.screenshot({ path: path.join(reportsDir, 'step3_after_join.png') }); } catch (e) { }

    // ─── Check result ───
    console.log('\n🔍 Checking result...');
    var postJoinText = '';
    try { postJoinText = await page.evaluate(() => document.body.innerText); } catch (e) { }

    if (postJoinText.includes("can't join") || postJoinText.includes('لا يمكنك')) {
        console.log('❌ "You can\'t join this video call"');
    } else if (postJoinText.includes('Leave') || postJoinText.includes('مغادرة') ||
        postJoinText.includes('people') || postJoinText.includes('أشخاص')) {
        console.log('✅ JOINED SUCCESSFULLY!');
    } else if (postJoinText.includes('انضم الآن') || postJoinText.includes('Join now')) {
        console.log('⚠️ Still on join page — one more try...');
        try {
            await page.evaluate(() => {
                var btns = document.querySelectorAll('button');
                for (var btn of btns) {
                    var t = btn.textContent.trim();
                    if (t.includes('انضم الآن') || t.includes('Join now')) { btn.click(); return; }
                }
            });
            await sleep(8000);
        } catch (e) { }
    } else {
        console.log('⚠️ Unknown state: ' + postJoinText.substring(0, 200));
    }

    // ─── Stay in Meeting ───
    console.log('\n🎥 Staying for ' + durationMinutes + ' min...');

    let screenshotIndex = 1;
    var endTime = Date.now() + (durationMinutes * 60 * 1000);

    while (Date.now() < endTime) {
        var minLeft = Math.round((endTime - Date.now()) / 60000);
        console.log('[' + new Date().toISOString() + '] ' + minLeft + ' min left');
        try { await page.screenshot({ path: path.join(reportsDir, 'screenshot_' + screenshotIndex + '.png') }); } catch (e) { }
        screenshotIndex++;
        try { await page.mouse.move(Math.floor(Math.random() * 800) + 100, Math.floor(Math.random() * 500) + 100); } catch (e) { }
        var waitMs = Math.min(endTime - Date.now(), 10 * 60 * 1000);
        if (waitMs <= 0) break;
        await sleep(waitMs);
    }

    console.log('\n✅ Time over.');

    fs.writeFileSync(path.join(reportsDir, 'report.txt'), [
        '📊 Attendance Report',
        'Link: ' + meetLink,
        'Name: ' + (process.env.MEETING_NAME || 'Unknown'),
        'Duration: ' + durationMinutes + ' min',
        'Start: ' + new Date(endTime - durationMinutes * 60000).toISOString(),
        'End: ' + new Date().toISOString(),
    ].join('\n'));

    console.log('\n🍪 Saving cookies...');
    try {
        const client = await page.target().createCDPSession();
        const { cookies: fresh } = await client.send('Network.getAllCookies');
        if (fresh.length >= 10) {
            fs.writeFileSync(path.join(__dirname, 'cookies.json'), JSON.stringify(fresh));
            var cookiesDir = path.join(__dirname, '..', 'cookies');
            if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });
            fs.writeFileSync(path.join(cookiesDir, 'session.enc'),
                cryptoHelper.encrypt(JSON.stringify(fresh), COOKIE_PASSWORD));
            console.log('✅ Saved ' + fresh.length + ' cookies');
        }
    } catch (e) { console.log('⚠️ ' + e.message); }

    await browser.close();
    console.log('\n✅ Done!');
}

main().catch(function (e) {
    console.error('❌ Bot error:', e);
    process.exit(1);
});