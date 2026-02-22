var puppeteer = require('puppeteer-core');
var fs = require('fs');
var path = require('path');
var cryptoHelper = require('./crypto-helper');

var meetLink = process.env.MEET_LINK || 'https://meet.google.com/';
var durationMinutes = parseInt(process.env.DURATION_MINUTES || '120');
var CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('═'.repeat(50));
    console.log('🤖 Meet Attendance Bot');
    console.log('═'.repeat(50));

    var cookies = [];
    var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';

    var encPath = path.join(__dirname, '..', 'cookies', 'session.enc');
    if (fs.existsSync(encPath)) {
        try {
            cookies = JSON.parse(cryptoHelper.decrypt(fs.readFileSync(encPath, 'utf8'), COOKIE_PASSWORD));
            console.log('✅ Loaded ' + cookies.length + ' cookies from encrypted file');
        } catch (e) { console.log('⚠️ Encrypted failed: ' + e.message); }
    }

    if (cookies.length === 0 && fs.existsSync(path.join(__dirname, 'cookies.json'))) {
        try {
            cookies = JSON.parse(fs.readFileSync(path.join(__dirname, 'cookies.json'), 'utf8'));
            console.log('✅ Loaded ' + cookies.length + ' cookies from cookies.json');
        } catch (e) { }
    }

    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try {
            cookies = JSON.parse(Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8'));
            console.log('✅ Loaded ' + cookies.length + ' cookies from secret');
        } catch (e) { }
    }

    if (cookies.length === 0) { console.log('❌ NO COOKIES!'); process.exit(1); }

    // ─── Launch ───
    console.log('\n🚀 Launching Chrome at: ' + CHROME_PATH);

    var browser = await puppeteer.launch({
        headless: 'new',
        executablePath: CHROME_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--auto-accept-camera-and-microphone-capture',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720',
            '--disable-features=Crashpad',
            '--disable-crash-reporter',
            '--disable-breakpad',
            '--noerrdialogs',
            '--disable-component-update'
        ],
        defaultViewport: { width: 1280, height: 720 },
        protocolTimeout: 120000,
        ignoreDefaultArgs: ['--enable-automation'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        env: {
            ...process.env,
            CHROME_CRASHPAD_PIPE_NAME: 'none',
            BREAKPAD_DUMP_LOCATION: '/tmp',
            CHROME_LOG_FILE: '/dev/null'
        }
    });

    console.log('✅ Browser launched!');
    var page = await browser.newPage();

    // Stealth
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
    });

    try {
        const ctx = browser.defaultBrowserContext();
        await ctx.overridePermissions('https://meet.google.com', ['camera', 'microphone', 'notifications']);
    } catch (e) { }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' });

    // ─── Load Cookies ───
    try {
        const client = await page.target().createCDPSession();
        const valid = cookies.map(c => { let cp = {...c}; delete cp.size; delete cp.session; return cp; });
        await client.send('Network.setCookies', { cookies: valid });
        console.log('✅ Cookies loaded');
    } catch (e) {
        try { await page.setCookie(...cookies); } catch (err) { }
    }

    // ─── Verify Session ───
    console.log('\n🌐 Verifying session...');
    try { await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { }
    await sleep(5000);

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const currUrl = page.url();
    console.log('📍 ' + currUrl);

    if (currUrl.includes('ServiceLogin') || currUrl.includes('signin/identifier') || currUrl.includes('signin/v2')) {
        console.log('❌ Session expired!');
        try { await page.screenshot({ path: path.join(reportsDir, 'debug_session.png') }); } catch (e) { }
        await browser.close();
        process.exit(1);
    }
    console.log('✅ Session OK!');

    // ─── Go to Meet ───
    console.log('\n⏳ Going to ' + meetLink);
    try { await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 60000 }); } catch (e) { }

    // ─── Wait for join page ───
    console.log('⏳ Waiting for join page...');
    let joinReady = false;

    for (let w = 0; w < 30; w++) {
        await sleep(2000);
        let txt = '';
        try { txt = await page.evaluate(() => document.body ? document.body.innerText : ''); } catch (e) { continue; }

        if (txt.includes('انضم الآن') || txt.includes('Join now') || txt.includes('Ask to join') || txt.includes('طلب الانضمام')) {
            console.log('✅ Join page ready! [' + (w+1) + ']');
            joinReady = true;
            break;
        }
        if (txt.includes("can't join") || txt.includes('لا يمكنك')) {
            console.log('❌ Meeting unavailable [' + (w+1) + ']');
            break;
        }

        // If on Meet homepage, retry
        let u = page.url();
        if ((u === 'https://meet.google.com/' || u === 'https://meet.google.com') && (w === 3 || w === 10)) {
            console.log('⚠️ On homepage, retrying navigation...');
            try { await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 30000 }); } catch (e) { }
        }

        if (w % 5 === 0) console.log('⏳ [' + (w+1) + '/30] ' + u.substring(0, 60));
    }

    try { await page.screenshot({ path: path.join(reportsDir, 'step1_before_join.png') }); } catch (e) { }

    // ─── Dismiss popups ───
    console.log('\n🔕 Dismissing popups...');
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await sleep(300); }
    try {
        await page.evaluate(() => {
            var btns = document.querySelectorAll('button');
            for (var b of btns) {
                var a = b.getAttribute('aria-label') || '';
                if (a.includes('Close') || a.includes('إغلاق') || a === 'Got it' || a === 'حسنًا') { b.click(); break; }
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

    // ─── JOIN ───
    console.log('\n🚪 JOINING...');

    // Method 1: Direct DOM click
    try {
        var result = await page.evaluate(() => {
            var joinTexts = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام'];
            var skipTexts = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present'];
            var btns = document.querySelectorAll('button, [role="button"]');
            var info = [];

            for (var btn of btns) {
                var t = btn.textContent.trim();
                var r = btn.getBoundingClientRect();
                var s = window.getComputedStyle(btn);
                if (r.width === 0 || r.height === 0 || s.display === 'none') continue;

                info.push(t.substring(0, 60) + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + ']');

                var skip = false;
                for (var sk of skipTexts) { if (t.includes(sk)) { skip = true; break; } }
                if (skip) continue;

                for (var jt of joinTexts) {
                    if (t.includes(jt)) {
                        btn.click();
                        return { clicked: t, info: info };
                    }
                }
            }

            // Blue button fallback
            var best = null, bestA = 0;
            for (var btn of btns) {
                var r = btn.getBoundingClientRect();
                var s = window.getComputedStyle(btn);
                var t = btn.textContent.trim();
                var skip = false;
                for (var sk of skipTexts) { if (t.includes(sk)) { skip = true; break; } }
                if (skip) continue;
                var a = r.width * r.height;
                var blue = s.backgroundColor.includes('26, 115, 232') || s.backgroundColor.includes('66, 133, 244');
                if (blue && a > bestA && a > 3000) { best = btn; bestA = a; }
            }
            if (best) { best.click(); return { clicked: 'BLUE:' + best.textContent.trim(), info: info }; }

            return { clicked: null, info: info };
        });

        console.log('📋 Buttons: ' + JSON.stringify(result.info));
        if (result.clicked) console.log('✅ Clicked: "' + result.clicked + '"');
        else console.log('⚠️ No join button found');
    } catch (e) { console.log('⚠️ ' + e.message); }

    await sleep(8000);

    // Method 2: Retry
    try {
        var still = await page.evaluate(() => document.body.innerText.includes('انضم الآن') || document.body.innerText.includes('Join now'));
        if (still) {
            console.log('⚠️ Retrying join...');
            await page.keyboard.press('Escape');
            await sleep(500);
            await page.evaluate(() => {
                var btns = document.querySelectorAll('button');
                for (var b of btns) {
                    var t = b.textContent.trim();
                    if (t === 'انضم الآن' || t === 'Join now' || t === 'Ask to join') {
                        b.focus();
                        b.click();
                        b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        return;
                    }
                }
            });
            await sleep(8000);
        }
    } catch (e) { }

    // Method 3: Tab + Enter
    try {
        var still2 = await page.evaluate(() => document.body.innerText.includes('انضم الآن') || document.body.innerText.includes('Join now'));
        if (still2) {
            console.log('⚠️ Trying Tab+Enter...');
            for (let t = 0; t < 20; t++) {
                await page.keyboard.press('Tab');
                await sleep(200);
                var f = await page.evaluate(() => document.activeElement ? document.activeElement.textContent.trim() : '').catch(() => '');
                if (f.includes('انضم') || f.includes('Join')) {
                    console.log('✅ Focused: "' + f + '" → Enter');
                    await page.keyboard.press('Enter');
                    await sleep(8000);
                    break;
                }
            }
        }
    } catch (e) { }

    try { await page.screenshot({ path: path.join(reportsDir, 'step3_after_join.png') }); } catch (e) { }

    // ─── Check result ───
    console.log('\n🔍 Result...');
    var txt = '';
    try { txt = await page.evaluate(() => document.body.innerText); } catch (e) { }

    if (txt.includes("can't join") || txt.includes('لا يمكنك')) console.log('❌ Rejected');
    else if (txt.includes('Leave') || txt.includes('مغادرة')) console.log('✅ JOINED!');
    else if (txt.includes('انضم') || txt.includes('Join')) {
        console.log('⚠️ Still on join page, final attempt...');
        try {
            await page.evaluate(() => {
                var b = document.querySelectorAll('button');
                for (var x of b) { if (x.textContent.includes('انضم الآن') || x.textContent.includes('Join now')) { x.click(); return; } }
            });
        } catch (e) { }
        await sleep(8000);
    }
    else console.log('⚠️ Unknown: ' + txt.substring(0, 200));

    // ─── Stay ───
    console.log('\n🎥 Staying ' + durationMinutes + ' min...');
    let si = 1;
    var end = Date.now() + durationMinutes * 60000;
    while (Date.now() < end) {
        console.log('[' + new Date().toISOString() + '] ' + Math.round((end - Date.now()) / 60000) + ' min left');
        try { await page.screenshot({ path: path.join(reportsDir, 'screenshot_' + si + '.png') }); } catch (e) { }
        si++;
        try { await page.mouse.move(Math.random() * 800 + 100, Math.random() * 500 + 100); } catch (e) { }
        var w = Math.min(end - Date.now(), 600000);
        if (w <= 0) break;
        await sleep(w);
    }

    console.log('\n✅ Time over.');
    fs.writeFileSync(path.join(reportsDir, 'report.txt'), 'Link: ' + meetLink + '\nName: ' + (process.env.MEETING_NAME || '') + '\nDuration: ' + durationMinutes + ' min\nEnd: ' + new Date().toISOString());

    console.log('\n🍪 Saving cookies...');
    try {
        var cl = await page.target().createCDPSession();
        var fr = (await cl.send('Network.getAllCookies')).cookies;
        if (fr.length >= 10) {
            fs.writeFileSync(path.join(__dirname, 'cookies.json'), JSON.stringify(fr));
            var cd = path.join(__dirname, '..', 'cookies');
            if (!fs.existsSync(cd)) fs.mkdirSync(cd, { recursive: true });
            fs.writeFileSync(path.join(cd, 'session.enc'), cryptoHelper.encrypt(JSON.stringify(fr), COOKIE_PASSWORD));
            console.log('✅ Saved ' + fr.length + ' cookies');
        }
    } catch (e) { console.log('⚠️ ' + e.message); }

    await browser.close();
    console.log('\n✅ Done!');
}

main().catch(function (e) { console.error('❌ Bot error:', e); process.exit(1); });