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

    // ─── Load Cookies (try multiple sources) ───
    console.log('\n🍪 Loading Google session...');

    var cookies = [];
    var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';

    // Source 1: Encrypted file in repo (freshest)
    var encPath = path.join(__dirname, '..', 'cookies', 'session.enc');
    if (cookies.length === 0 && fs.existsSync(encPath)) {
        try {
            var enc = fs.readFileSync(encPath, 'utf8');
            cookies = JSON.parse(cryptoHelper.decrypt(enc, COOKIE_PASSWORD));
            console.log('✅ Loaded from encrypted file (' + cookies.length + ')');
        } catch (e) {
            console.log('⚠️ Encrypted file failed: ' + e.message);
        }
    }

    // Source 2: Raw cookies.json (from initial setup or refresh)
    var rawPath = path.join(__dirname, 'cookies.json');
    if (cookies.length === 0 && fs.existsSync(rawPath)) {
        try {
            cookies = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
            console.log('✅ Loaded from cookies.json (' + cookies.length + ')');
        } catch (e) {
            console.log('⚠️ cookies.json failed: ' + e.message);
        }
    }

    // Source 3: GitHub Secret (base64)
    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try {
            var decoded = Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8');
            cookies = JSON.parse(decoded);
            console.log('✅ Loaded from GitHub Secret (' + cookies.length + ')');
        } catch (e) {
            console.log('⚠️ Secret failed: ' + e.message);
        }
    }

    if (cookies.length === 0) {
        console.log('❌ NO COOKIES! Run save-cookies.js on your PC first.');
        process.exit(1);
    }

    var browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote',
            '--use-fake-ui-for-media-stream',
            '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    var page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

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
        console.log('⚠️ Cookie set error: ', e.message);
        try { await page.setCookie(...cookies); } catch (err) { }
    }

    console.log('\n🌐 Verifying Google Session directly...');
    await page.goto('https://myaccount.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    const currUrl = page.url();
    if (!currUrl.includes('myaccount')) {
        console.log(`❌ Google didn't recognize cookies! Redirected to: ${currUrl}`);
        console.log('⚠️ The cookies may have expired or Google is blocking this login.');
    } else {
        console.log('✅ Google session verified! Profile is active.');
    }

    // Go to Meet
    console.log(`\n⏳ Navigating to ${meetLink}...`);
    try {
        await page.goto(meetLink, { waitUntil: 'domcontentloaded', timeout: 90000 });

        console.log('Letting page settle for 15 seconds to handle redirects...');
        await sleep(15000); // let it load fully and process redirects
        console.log('Attempting to join meeting...');
        // Mute audio and video via keyboard shortcuts (ctrl+d, ctrl+e)
        await page.keyboard.down('Control');
        await page.keyboard.press('d');
        await page.keyboard.press('e');
        await page.keyboard.up('Control');

        await sleep(3000);

        let joinAttempt = 0;
        let inMeeting = false;

        // Try pressing Enter periodically to join (up to 3 times)
        while (joinAttempt < 3 && !inMeeting) {
            joinAttempt++;
            console.log(`[Attempt ${joinAttempt}/3] Pressing 'Enter' to confirm join...`);

            // Focus page and Press Enter
            await page.bringToFront();
            await page.keyboard.press('Enter');
            await sleep(8000);

            let currentUrl = page.url();
            // Google Meet URLs often drop the landing page styling once inside
            if (!currentUrl.includes('landing') && !currentUrl.includes('workspace')) {
                inMeeting = true;
            }
        }

    } catch (e) {
        console.log('⚠️ Error navigating or joining meeting: ', e);
    }

    console.log(`\n🎥 In meeting... staying for ${durationMinutes} minutes.`);

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    let screenshotIndex = 1;
    const loopTimeMinutes = 10;
    var endTime = Date.now() + (durationMinutes * 60 * 1000);

    while (Date.now() < endTime) {
        console.log(`[${new Date().toISOString()}] Still in meeting...`);
        try {
            await page.screenshot({ path: path.join(reportsDir, `screenshot_${screenshotIndex}.png`) });
        } catch (err) {
            console.log('⚠️ Could not take screenshot: ' + err.message);
        }
        screenshotIndex++;

        const timeLeft = endTime - Date.now();
        const waitMs = Math.min(timeLeft, loopTimeMinutes * 60 * 1000);
        if (waitMs <= 0) break;

        await sleep(waitMs);
    }

    console.log('✅ Meeting time over. Generating final report.');
    fs.writeFileSync(path.join(reportsDir, 'report.txt'), `Attended ${meetLink} for ${durationMinutes} minutes.\nDate: ${new Date().toISOString()}`);

    // ═════════════════════════════════
    //  SAVE REFRESHED COOKIES
    // ═════════════════════════════════
    console.log('\n🍪 Saving refreshed cookies...');

    try {
        const client = await page.target().createCDPSession();
        const { cookies: freshCookies } = await client.send('Network.getAllCookies');

        // Save raw
        fs.writeFileSync(
            path.join(__dirname, 'cookies.json'),
            JSON.stringify(freshCookies),
            'utf8'
        );

        // Save encrypted
        var encrypted = cryptoHelper.encrypt(
            JSON.stringify(freshCookies),
            COOKIE_PASSWORD
        );

        var cookiesDir = path.join(__dirname, '..', 'cookies');
        if (!fs.existsSync(cookiesDir)) {
            fs.mkdirSync(cookiesDir, { recursive: true });
        }

        fs.writeFileSync(
            path.join(cookiesDir, 'session.enc'),
            encrypted,
            'utf8'
        );

        console.log('✅ Fresh cookies saved (' + freshCookies.length + ')');
    } catch (e) {
        console.log('⚠️ Cookie save error: ' + e.message);
    }

    await browser.close();
    console.log('\n✅ Done!');
}

main().catch(console.error);
