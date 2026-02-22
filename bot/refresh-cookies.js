// ============================================
//  DAILY KEEPALIVE — Refreshes Google session
//  Runs every day, visits Google, saves cookies
// ============================================

var puppeteer = require('puppeteer-core');
var fs = require('fs');
var path = require('path');
var cryptoHelper = require('./crypto-helper');

var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';
var COOKIES_FILE = path.join(__dirname, '..', 'cookies', 'session.enc');
var RAW_COOKIES = path.join(__dirname, 'cookies.json');

async function refreshCookies() {
    console.log('═'.repeat(50));
    console.log('🔄 Cookie Refresh / Keepalive');
    console.log('═'.repeat(50));

    // ─── Load existing cookies ───
    var cookies = [];

    // Try encrypted file first
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

    // Try raw cookies file (from initial setup)
    if (cookies.length === 0 && fs.existsSync(RAW_COOKIES)) {
        console.log('🍪 Loading raw cookies.json...');
        try {
            cookies = JSON.parse(fs.readFileSync(RAW_COOKIES, 'utf8'));
            console.log('✅ Loaded ' + cookies.length + ' cookies from raw file');
        } catch (e) {
            console.log('⚠️ Failed to load raw cookies: ' + e.message);
        }
    }

    // Try base64 from env (GitHub Secret)
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

    // ─── Launch Browser ───
    console.log('\n🚀 Launching browser...');

    var browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/chromium-browser',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
            '--no-zygote'
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    var page = await browser.newPage();

    // ─── Set cookies ───
    await page.setCookie(...cookies);
    console.log('✅ Cookies set');

    // ─── Visit Google to refresh session ───
    console.log('\n🌐 Visiting Google accounts...');

    try {
        await page.goto('https://accounts.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(3000);

        var url = page.url();
        console.log('📍 URL: ' + url);

        if (url.includes('myaccount') || url.includes('SignOutOptions') ||
            url.includes('accounts.google.com/')) {
            console.log('✅ Google session is ALIVE!');
        } else if (url.includes('signin') || url.includes('ServiceLogin')) {
            console.log('❌ Session EXPIRED! Need new cookies.');
            console.log('👉 Run save-cookies.js on your PC');
            await browser.close();
            process.exit(1);
        }
    } catch (e) {
        console.log('⚠️ Could not visit Google: ' + e.message);
    }

    // ─── Visit Google Meet to refresh Meet cookies ───
    console.log('\n🎥 Visiting Google Meet...');

    try {
        await page.goto('https://meet.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(3000);
        console.log('✅ Meet page loaded');
    } catch (e) {
        console.log('⚠️ Meet visit failed: ' + e.message);
    }

    // ─── Visit Gmail to refresh additional cookies ───
    console.log('\n📧 Visiting Gmail...');

    try {
        await page.goto('https://mail.google.com', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        await sleep(3000);
        console.log('✅ Gmail loaded');
    } catch (e) {
        console.log('⚠️ Gmail visit failed (ok)');
    }

    // ─── Extract fresh cookies ───
    console.log('\n🍪 Extracting fresh cookies...');

    var freshCookies = await page.cookies(
        'https://accounts.google.com',
        'https://meet.google.com',
        'https://www.google.com',
        'https://mail.google.com'
    );

    console.log('✅ Got ' + freshCookies.length + ' fresh cookies');

    // ─── Save encrypted cookies ───
    var cookiesDir = path.join(__dirname, '..', 'cookies');
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }

    var cookiesJson = JSON.stringify(freshCookies);
    var encrypted = cryptoHelper.encrypt(cookiesJson, COOKIE_PASSWORD);
    fs.writeFileSync(COOKIES_FILE, encrypted, 'utf8');
    console.log('🔒 Saved encrypted cookies: ' + COOKIES_FILE);

    // ─── Also save raw for bot.js ───
    fs.writeFileSync(RAW_COOKIES, JSON.stringify(freshCookies), 'utf8');
    console.log('📄 Saved raw cookies: ' + RAW_COOKIES);

    // ─── Done ───
    await browser.close();

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Cookies refreshed successfully!');
    console.log('   Next refresh: tomorrow');
    console.log('═'.repeat(50));
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

refreshCookies().catch(function (e) {
    console.error('❌ Refresh error:', e);
    process.exit(1);
});
