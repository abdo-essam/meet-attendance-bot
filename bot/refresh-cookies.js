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

    var cookies = [];

    if (fs.existsSync(COOKIES_FILE)) {
        try {
            var encrypted = fs.readFileSync(COOKIES_FILE, 'utf8');
            cookies = JSON.parse(cryptoHelper.decrypt(encrypted, COOKIE_PASSWORD));
            console.log('✅ Loaded ' + cookies.length + ' cookies from encrypted file');
        } catch (e) {
            console.log('⚠️ Failed to decrypt: ' + e.message);
        }
    }

    if (cookies.length === 0 && fs.existsSync(RAW_COOKIES)) {
        try {
            cookies = JSON.parse(fs.readFileSync(RAW_COOKIES, 'utf8'));
            console.log('✅ Loaded ' + cookies.length + ' cookies from raw file');
        } catch (e) {
            console.log('⚠️ Failed to load raw cookies: ' + e.message);
        }
    }

    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try {
            var decoded = Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8');
            cookies = JSON.parse(decoded);
            console.log('✅ Loaded ' + cookies.length + ' cookies from secret');
        } catch (e) {
            console.log('⚠️ Failed to decode secret: ' + e.message);
        }
    }

    if (cookies.length === 0) {
        console.log('❌ No cookies found!');
        process.exit(1);
    }

    // ─── Launch Browser (minimal args) ───
    console.log('\n🚀 Launching browser...');

    var browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,720'
        ],
        defaultViewport: { width: 1280, height: 720 },
        protocolTimeout: 120000
    });

    console.log('✅ Browser launched!');

    var page = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    try {
        const client = await page.target().createCDPSession();
        const validCookies = cookies.map(c => {
            let copy = { ...c };
            delete copy.size;
            delete copy.session;
            return copy;
        });
        await client.send('Network.setCookies', { cookies: validCookies });
        console.log('✅ Cookies loaded');
    } catch (e) {
        try { await page.setCookie(...cookies); } catch (err) { }
    }

    // ─── Visit Google Accounts ───
    console.log('\n🌐 Visiting Google Accounts...');
    var sessionAlive = false;

    try {
        await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(4000);

        var url = page.url();
        console.log('📍 URL: ' + url);

        var isDead =
            url.includes('ServiceLogin') ||
            url.includes('signin/v2') ||
            url.includes('signin/identifier') ||
            url.includes('accounts.google.com/v3/signin');

        if (isDead) {
            console.log('❌ Session EXPIRED!');
            await browser.close();
            process.exit(1);
        }

        console.log('✅ Google session is ALIVE!');
        sessionAlive = true;
    } catch (e) {
        console.log('⚠️ Could not visit Google Accounts: ' + e.message);
    }

    // ─── Visit services ───
    var services = [
        { name: 'Google Meet', url: 'https://meet.google.com' },
        { name: 'Gmail', url: 'https://mail.google.com' },
        { name: 'Google.com', url: 'https://www.google.com' }
    ];

    for (var svc of services) {
        console.log('\n🌐 Visiting ' + svc.name + '...');
        try {
            await page.goto(svc.url, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
            console.log('✅ ' + svc.name + ' loaded');
        } catch (e) {
            console.log('⚠️ ' + svc.name + ' failed (ok)');
        }
    }

    // ─── Extract & save cookies ───
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

    if (freshCookies.length < 10) {
        console.log('⚠️ Too few cookies — skipping save');
        await browser.close();
        process.exit(1);
    }

    var cookiesDir = path.join(__dirname, '..', 'cookies');
    if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });

    try {
        var encryptedData = cryptoHelper.encrypt(JSON.stringify(freshCookies), COOKIE_PASSWORD);
        fs.writeFileSync(COOKIES_FILE, encryptedData, 'utf8');
        console.log('🔒 Saved encrypted cookies');
    } catch (e) {
        console.log('❌ Failed to save encrypted: ' + e.message);
    }

    try {
        fs.writeFileSync(RAW_COOKIES, JSON.stringify(freshCookies), 'utf8');
        console.log('📄 Saved raw cookies');
    } catch (e) { }

    await browser.close();

    console.log('\n' + '═'.repeat(50));
    console.log('✅ Cookies refreshed! (' + freshCookies.length + ')');
    console.log('   Session: ' + (sessionAlive ? 'ALIVE ✅' : 'UNKNOWN ⚠️'));
    console.log('═'.repeat(50));
}

refreshCookies().catch(function (e) {
    console.error('❌ Refresh error:', e);
    process.exit(1);
});