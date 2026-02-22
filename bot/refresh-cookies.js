var puppeteer = require('puppeteer-core');
var fs = require('fs');
var path = require('path');
var cryptoHelper = require('./crypto-helper');

var COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';
var COOKIES_FILE = path.join(__dirname, '..', 'cookies', 'session.enc');
var RAW_COOKIES = path.join(__dirname, 'cookies.json');
var CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function refreshCookies() {
    console.log('═'.repeat(50));
    console.log('🔄 Cookie Refresh');
    console.log('═'.repeat(50));

    var cookies = [];
    if (fs.existsSync(COOKIES_FILE)) {
        try { cookies = JSON.parse(cryptoHelper.decrypt(fs.readFileSync(COOKIES_FILE, 'utf8'), COOKIE_PASSWORD)); console.log('✅ ' + cookies.length + ' from encrypted'); } catch (e) { }
    }
    if (cookies.length === 0 && fs.existsSync(RAW_COOKIES)) {
        try { cookies = JSON.parse(fs.readFileSync(RAW_COOKIES, 'utf8')); console.log('✅ ' + cookies.length + ' from raw'); } catch (e) { }
    }
    if (cookies.length === 0 && process.env.GOOGLE_COOKIES) {
        try { cookies = JSON.parse(Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8')); console.log('✅ ' + cookies.length + ' from secret'); } catch (e) { }
    }
    if (cookies.length === 0) { console.log('❌ No cookies!'); process.exit(1); }

    console.log('\n🚀 Launching Chrome at: ' + CHROME_PATH);
    var browser = await puppeteer.launch({
        headless: 'new',
        executablePath: CHROME_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
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
    console.log('✅ Launched!');

    var page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    try {
        var cl = await page.target().createCDPSession();
        var valid = cookies.map(c => { let cp = {...c}; delete cp.size; delete cp.session; return cp; });
        await cl.send('Network.setCookies', { cookies: valid });
        console.log('✅ Cookies loaded');
    } catch (e) { try { await page.setCookie(...cookies); } catch (err) { } }

    console.log('\n🌐 Google Accounts...');
    var alive = false;
    try {
        await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(4000);
        var u = page.url();
        console.log('📍 ' + u);
        if (u.includes('ServiceLogin') || u.includes('signin')) { console.log('❌ Expired!'); await browser.close(); process.exit(1); }
        console.log('✅ Alive!');
        alive = true;
    } catch (e) { }

    for (var svc of [['Meet', 'https://meet.google.com'], ['Gmail', 'https://mail.google.com'], ['Google', 'https://www.google.com']]) {
        try { console.log('🌐 ' + svc[0]); await page.goto(svc[1], { waitUntil: 'networkidle2', timeout: 30000 }); await sleep(3000); console.log('✅'); } catch (e) { console.log('⚠️'); }
    }

    console.log('\n🍪 Extracting...');
    var fresh = [];
    try { var cl = await page.target().createCDPSession(); fresh = (await cl.send('Network.getAllCookies')).cookies; console.log('✅ ' + fresh.length); } catch (e) { await browser.close(); process.exit(1); }
    if (fresh.length < 10) { console.log('⚠️ Too few'); await browser.close(); process.exit(1); }

    var cd = path.join(__dirname, '..', 'cookies');
    if (!fs.existsSync(cd)) fs.mkdirSync(cd, { recursive: true });
    try { fs.writeFileSync(COOKIES_FILE, cryptoHelper.encrypt(JSON.stringify(fresh), COOKIE_PASSWORD)); console.log('🔒 Encrypted saved'); } catch (e) { }
    try { fs.writeFileSync(RAW_COOKIES, JSON.stringify(fresh)); console.log('📄 Raw saved'); } catch (e) { }

    await browser.close();
    console.log('\n✅ Done! (' + fresh.length + ' cookies)');
}

refreshCookies().catch(function (e) { console.error('❌', e); process.exit(1); });