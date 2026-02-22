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

async function launchBrowser() {
    var minimalArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,720'
    ];

    var chromePath = null;
    var possiblePaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ];
    for (var p of possiblePaths) {
        if (fs.existsSync(p)) { chromePath = p; break; }
    }

    var puppeteerChrome = null;
    try {
        puppeteerChrome = require('puppeteer').executablePath();
        if (!fs.existsSync(puppeteerChrome)) puppeteerChrome = null;
    } catch (e) { }

    var strategies = [];

    if (puppeteerChrome) {
        strategies.push({ name: 'Puppeteer Chrome', opts: { headless: 'new', executablePath: puppeteerChrome, args: minimalArgs } });
        strategies.push({ name: 'Puppeteer Chrome (old)', opts: { headless: true, executablePath: puppeteerChrome, args: minimalArgs } });
    }
    if (chromePath) {
        strategies.push({ name: 'System Chrome', opts: { headless: 'new', executablePath: chromePath, args: minimalArgs } });
        strategies.push({ name: 'System Chrome (old)', opts: { headless: true, executablePath: chromePath, args: minimalArgs } });
    }
    strategies.push({ name: 'Auto-detect', opts: { headless: 'new', args: minimalArgs } });
    strategies.push({ name: 'Auto-detect (old)', opts: { headless: true, args: minimalArgs } });

    console.log('System Chrome: ' + (chromePath || 'NONE'));
    console.log('Puppeteer Chrome: ' + (puppeteerChrome || 'NONE'));

    for (var i = 0; i < strategies.length; i++) {
        try {
            console.log('🚀 [' + (i+1) + '/' + strategies.length + '] ' + strategies[i].name);
            var browser = await puppeteer.launch({
                ...strategies[i].opts,
                defaultViewport: { width: 1280, height: 720 },
                protocolTimeout: 120000,
                ignoreDefaultArgs: ['--enable-automation']
            });
            console.log('✅ ' + strategies[i].name + ' worked!');
            return browser;
        } catch (e) {
            console.log('❌ ' + e.message.split('\n')[0]);
            await sleep(1000);
        }
    }

    throw new Error('ALL launch strategies failed');
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
    var browser = await launchBrowser();
    var page = await browser.newPage();

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

    if (fresh.length < 10) { console.log('⚠️ Too few, skipping save'); await browser.close(); process.exit(1); }

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