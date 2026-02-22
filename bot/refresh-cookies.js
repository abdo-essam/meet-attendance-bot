// ============================================
//  DAILY KEEPALIVE — Refreshes Google session
//  Runs every day, visits Google, saves cookies
// ============================================

var puppeteer = require('puppeteer-extra');
var StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
var fs = require('fs');
var path = require('path');
var cryptoHelper = require('./crypto-helper');

var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';
var COOKIES_FILE = path.join(__dirname, '..', 'cookies', 'session.enc');
var RAW_COOKIES = path.join(__dirname, 'cookies.json');

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

async function refreshCookies() {
    console.log('═'.repeat(50));
    console.log('🔄 Cookie Refresh / Keepalive');
    console.log('═'.repeat(50));

    // ─── Load existing cookies ───
    var cookies = [];

    // Source 1: Try encrypted file first (freshest)
    if (fs.existsSync(COOKIES_FILE)) {
        console.log('🍪 Loading encrypted cookies...');
        try {
            var encrypted = fs.readFileSync(COOKIES_FILE, 'utf8');
            var decrypted = cryptoHelper.decrypt(encrypted, COOKIE_PASSWORD);
            cookies = JSON.parse(decrypted);
            console.log('✅ Loaded ' + cookies.length + ' cookies from encrypted file');
        } catch (e) {
            console.log('⚠️ Failed to decrypt: ' + e.message);
        }
    }

    // Source 2: Try raw cookies file
    if (cookies.length === 0 && fs.existsSync(RAW_COOKIES)) {
        console.log('🍪 Loading raw cookies.json...');
        try {
            cookies = JSON.parse(fs.readFileSync(RAW_COOKIES, 'utf8'));
            console.log('✅ Loaded ' + cookies.length + ' cookies from raw file');
        } catch (e) {
            console.log('⚠️ Failed to load raw cookies: ' + e.message);
        }
    }

    // Source 3: Try base64 from env (GitHub Secret)
    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        console.log('🍪 Loading cookies from GitHub Secret...');
        try {
            var decoded = Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8');
            cookies = JSON.parse(decoded);
            console.log('✅ Loaded ' + cookies.length + ' cookies from secret');
        } catch (e) {
            console.log('⚠️ Failed to decode secret: ' + e.message);
        }
    }

    if (cookies.length === 0) {
        console.log('❌ No cookies found! Run save-cookies.js on your PC first.');
        process.exit(1);
    }

    if (cookies.length < 10) {
        console.log('⚠️ WARNING: Only ' + cookies.length + ' cookies. This is suspiciously low.');
        console.log('   A proper Google session usually has 50-150+ cookies.');
    }

    // ─── Launch Browser ───
    console.log('\n🚀 Launching browser...');

    var browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote',
            '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    var page = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    // ─── Load cookies into browser ───
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
        console.log('⚠️ CDP cookie set error: ' + e.message);
        try {
            await page.setCookie(...cookies);
            console.log('✅ Cookies loaded via fallback method');
        } catch (err) {
            console.log('⚠️ Fallback cookie set also failed: ' + err.message);
        }
    }

    // ─── Visit Google Accounts to verify & refresh session ───
    console.log('\n🌐 Visiting Google Accounts...');

    var sessionAlive = false;

    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(4000);

        var url = page.url();
        console.log('📍 URL: ' + url);

        // Check if session is alive
        var isAlive =
            url.includes('myaccount.google.com') ||
            url.includes('accounts.google.com/SignOutOptions') ||
            url.includes('google.com/account/about') ||
            url.includes('accounts.google.com/');

        // Check if session is dead (redirected to login)
        var isDead =
            url.includes('ServiceLogin') ||
            url.includes('signin/v2') ||
            url.includes('signin/identifier') ||
            url.includes('accounts.google.com/v3/signin');

        if (isDead) {
            console.log('❌ Session EXPIRED! Redirected to sign-in page.');
            console.log('👉 Run save-cookies.js on your PC and update GOOGLE_COOKIES secret.');
            await browser.close();
            process.exit(1);
        } else if (isAlive) {
            console.log('✅ Google session is ALIVE!');
            sessionAlive = true;
        } else {
            console.log('⚠️ Unknown state: ' + url);
            console.log('   Continuing anyway to attempt cookie refresh...');
            sessionAlive = true; // try to continue
        }
    } catch (e) {
        console.log('⚠️ Could not visit Google Accounts: ' + e.message);
        console.log('   Continuing with other services...');
    }

    // ─── Visit Google Meet to refresh Meet-specific cookies ───
    console.log('\n🎥 Visiting Google Meet...');

    try {
        await page.goto('https://meet.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(3000);
        console.log('✅ Meet page loaded: ' + page.url());
    } catch (e) {
        console.log('⚠️ Meet visit failed: ' + e.message);
    }

    // ─── Visit Gmail to refresh Gmail-specific cookies ───
    console.log('\n📧 Visiting Gmail...');

    try {
        await page.goto('https://mail.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(3000);
        console.log('✅ Gmail loaded: ' + page.url());
    } catch (e) {
        console.log('⚠️ Gmail visit failed (ok): ' + e.message);
    }

    // ─── Visit Google.com for general cookies ───
    console.log('\n🔍 Visiting Google.com...');

    try {
        await page.goto('https://www.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(2000);
        console.log('✅ Google.com loaded');
    } catch (e) {
        console.log('⚠️ Google.com visit failed (ok): ' + e.message);
    }

    // ─── Extract fresh cookies ───
    console.log('\n🍪 Extracting fresh cookies...');

    var freshCookies = [];
    try {
        const client = await page.target().createCDPSession();
        const result = await client.send('Network.getAllCookies');
        freshCookies = result.cookies;
        console.log('✅ Got ' + freshCookies.length + ' fresh cookies');
    } catch (e) {
        console.log('❌ Failed to extract cookies: ' + e.message);
        await browser.close();
        process.exit(1);
    }

    // ─── Validate before saving ───
    if (freshCookies.length < 10) {
        console.log('⚠️ Only ' + freshCookies.length + ' cookies extracted.');
        console.log('   This is too few — skipping save to protect existing cookies.');
        console.log('   Existing encrypted cookies will NOT be overwritten.');
        await browser.close();
        process.exit(1);
    }

    // ─── Save encrypted cookies ───
    console.log('\n💾 Saving cookies...');

    var cookiesDir = path.join(__dirname, '..', 'cookies');
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }

    try {
        var cookiesJson = JSON.stringify(freshCookies);
        var encryptedData = cryptoHelper.encrypt(cookiesJson, COOKIE_PASSWORD);
        fs.writeFileSync(COOKIES_FILE, encryptedData, 'utf8');
        console.log('🔒 Saved encrypted cookies: ' + COOKIES_FILE);
    } catch (e) {
        console.log('❌ Failed to save encrypted cookies: ' + e.message);
    }

    // ─── Save raw backup for bot.js ───
    try {
        fs.writeFileSync(RAW_COOKIES, JSON.stringify(freshCookies), 'utf8');
        console.log('📄 Saved raw cookies: ' + RAW_COOKIES);
    } catch (e) {
        console.log('⚠️ Failed to save raw cookies: ' + e.message);
    }

    // ─── Done ───
    await browser.close();

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Cookies refreshed successfully!');
    console.log('   Cookies count: ' + freshCookies.length);
    console.log('   Session alive: ' + (sessionAlive ? 'YES ✅' : 'UNKNOWN ⚠️'));
    console.log('   Next refresh:  tomorrow at 3:00 AM UTC');
    console.log('═'.repeat(50));
}

refreshCookies().catch(function (e) {
    console.error('❌ Refresh error:', e);
    process.exit(1);
});