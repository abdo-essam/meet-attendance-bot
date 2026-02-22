var vanillaPuppeteer = require('puppeteer');
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
            cookies = JSON.parse(cryptoHelper.decrypt(fs.readFileSync(COOKIES_FILE, 'utf8'), COOKIE_PASSWORD));
            console.log('✅ ' + cookies.length + ' cookies from encrypted file');
        } catch (e) { console.log('⚠️ Decrypt failed: ' + e.message); }
    }
    if (cookies.length === 0 && fs.existsSync(RAW_COOKIES)) {
        try {
            cookies = JSON.parse(fs.readFileSync(RAW_COOKIES, 'utf8'));
            console.log('✅ ' + cookies.length + ' cookies from raw file');
        } catch (e) { }
    }
    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try {
            cookies = JSON.parse(Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8'));
            console.log('✅ ' + cookies.length + ' cookies from secret');
        } catch (e) { }
    }
    if (cookies.length === 0) { console.log('❌ No cookies!'); process.exit(1); }

    console.log('\n🚀 Launching browser...');

    var browser = await vanillaPuppeteer.launch({
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

    // Apply stealth manually
    try {
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.navigator.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });
    } catch (e) { }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    try {
        const client = await page.target().createCDPSession();
        const valid = cookies.map(c => { let copy = {...c}; delete copy.size; delete copy.session; return copy; });
        await client.send('Network.setCookies', { cookies: valid });
        console.log('✅ Cookies loaded');
    } catch (e) { try { await page.setCookie(...cookies); } catch (err) { } }

    console.log('\n🌐 Visiting Google Accounts...');
    var sessionAlive = false;
    try {
        await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(4000);
        var url = page.url();
        console.log('📍 ' + url);
        if (url.includes('ServiceLogin') || url.includes('signin')) {
            console.log('❌ Session EXPIRED!');
            await browser.close();
            process.exit(1);
        }
        console.log('✅ Session alive!');
        sessionAlive = true;
    } catch (e) { console.log('⚠️ ' + e.message); }

    var services = [
        ['Google Meet', 'https://meet.google.com'],
        ['Gmail', 'https://mail.google.com'],
        ['Google', 'https://www.google.com']
    ];
    for (var svc of services) {
        try {
            console.log('🌐 ' + svc[0] + '...');
            await page.goto(svc[1], { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
            console.log('✅ OK');
        } catch (e) { console.log('⚠️ Failed (ok)'); }
    }

    console.log('\n🍪 Extracting...');
    var fresh = [];
    try {
        const client = await page.target().createCDPSession();
        fresh = (await client.send('Network.getAllCookies')).cookies;
        console.log('✅ ' + fresh.length + ' cookies');
    } catch (e) { console.log('❌ ' + e.message); await browser.close(); process.exit(1); }

    if (fresh.length < 10) { console.log('⚠️ Too few'); await browser.close(); process.exit(1); }

    var cookiesDir = path.join(__dirname, '..', 'cookies');
    if (!fs.existsSync(cookiesDir)) fs.mkdirSync(cookiesDir, { recursive: true });

    try {
        fs.writeFileSync(COOKIES_FILE, cryptoHelper.encrypt(JSON.stringify(fresh), COOKIE_PASSWORD));
        console.log('🔒 Encrypted saved');
    } catch (e) { console.log('❌ ' + e.message); }

    try { fs.writeFileSync(RAW_COOKIES, JSON.stringify(fresh)); console.log('📄 Raw saved'); } catch (e) { }

    await browser.close();
    console.log('\n✅ Done! (' + fresh.length + ' cookies, session: ' + (sessionAlive ? 'ALIVE' : 'UNKNOWN') + ')');
}

refreshCookies().catch(function (e) {
    console.error('❌ Error:', e);
    process.exit(1);
});