// ============================================
//  LOCAL TEST — Login, verify Meet, join meeting
//  Run: node test-local.js
// ============================================

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── CONFIG ─────────────────────────────────────
const MEET_LINK = process.env.MEET_LINK || process.argv[2] || '';
const COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';
const COOKIES_DIR = path.join(__dirname, '..', 'cookies');
const ENCRYPTED_COOKIES_PATH = path.join(COOKIES_DIR, 'session.enc');
const RAW_COOKIES_PATH = path.join(__dirname, 'cookies.json');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Crypto helpers ─────────────────────────────
function encrypt(text, password) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(password, salt, 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        data: encrypted
    });
}

// ─── Load existing cookies ──────────────────────
function loadExistingCookies() {
    // Try raw JSON first
    if (fs.existsSync(RAW_COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(RAW_COOKIES_PATH, 'utf8'));
            console.log(`📂 Loaded ${cookies.length} cookies from cookies.json`);
            return cookies;
        } catch (e) {
            console.log(`⚠️ cookies.json load failed: ${e.message}`);
        }
    }

    // Try base64 file
    const base64Path = path.join(__dirname, '..', 'cookies.base64.txt');
    if (fs.existsSync(base64Path)) {
        try {
            const decoded = Buffer.from(fs.readFileSync(base64Path, 'utf8'), 'base64').toString('utf8');
            const cookies = JSON.parse(decoded);
            console.log(`📂 Loaded ${cookies.length} cookies from cookies.base64.txt`);
            return cookies;
        } catch (e) {
            console.log(`⚠️ base64 load failed: ${e.message}`);
        }
    }

    return [];
}

// ─── Save cookies ───────────────────────────────
function saveCookies(cookies) {
    // Save raw JSON
    fs.writeFileSync(RAW_COOKIES_PATH, JSON.stringify(cookies));
    console.log(`📄 Saved ${cookies.length} cookies to cookies.json`);

    // Save encrypted
    if (!fs.existsSync(COOKIES_DIR)) {
        fs.mkdirSync(COOKIES_DIR, { recursive: true });
    }
    try {
        const encrypted = encrypt(JSON.stringify(cookies), COOKIE_PASSWORD);
        fs.writeFileSync(ENCRYPTED_COOKIES_PATH, encrypted);
        console.log('🔒 Saved encrypted cookies to cookies/session.enc');
    } catch (e) {
        console.log(`⚠️ Encrypted save failed: ${e.message}`);
    }

    // Save base64 for GitHub secret
    const base64 = Buffer.from(JSON.stringify(cookies), 'utf8').toString('base64');
    const base64Path = path.join(__dirname, '..', 'cookies.base64.txt');
    fs.writeFileSync(base64Path, base64);
    console.log('📋 Saved cookies.base64.txt (for GitHub secret)');
}

// ─── Print cookie diagnostics ───────────────────
function diagnoseCookies(cookies) {
    const domains = {};
    for (const c of cookies) {
        const d = c.domain || 'unknown';
        domains[d] = (domains[d] || 0) + 1;
    }

    console.log('\n📋 Cookie domains:');
    for (const [domain, count] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
        const marker = domain.includes('meet') ? ' ⭐' : '';
        console.log(`   ${domain}: ${count}${marker}`);
    }

    const critical = {
        'SID': cookies.some(c => c.name === 'SID'),
        '__Secure-1PSID': cookies.some(c => c.name === '__Secure-1PSID'),
        '__Secure-3PSID': cookies.some(c => c.name === '__Secure-3PSID'),
        'HSID': cookies.some(c => c.name === 'HSID'),
        'SSID': cookies.some(c => c.name === 'SSID'),
        'APISID': cookies.some(c => c.name === 'APISID'),
        'SAPISID': cookies.some(c => c.name === 'SAPISID'),
        '__Secure-1PAPISID': cookies.some(c => c.name === '__Secure-1PAPISID'),
    };

    console.log('\n🔑 Critical cookies:');
    for (const [name, exists] of Object.entries(critical)) {
        console.log(`   ${exists ? '✅' : '❌'} ${name}`);
    }

    const meetCookies = cookies.filter(c => (c.domain || '').includes('meet'));
    console.log(`\n🎥 Meet-specific cookies: ${meetCookies.length}`);
    for (const c of meetCookies) {
        console.log(`   ${c.name} (${c.domain})`);
    }
}

// ─── MAIN ───────────────────────────────────────
async function main() {
    console.log('═'.repeat(60));
    console.log('🧪 LOCAL TEST — Meet Attendance Bot');
    console.log('═'.repeat(60));

    if (!MEET_LINK) {
        console.log('\n⚠️ No MEET_LINK provided!');
        console.log('Usage: node test-local.js https://meet.google.com/xxx-yyyy-zzz');
        console.log('\nContinuing without meeting link (login + cookie test only)...\n');
    }

    // ─── Step 1: Launch visible browser ─────────
    console.log('\n📌 STEP 1: Launching browser...');
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1300,800',
        ],
        defaultViewport: { width: 1280, height: 720 },
    });

    const pages = await browser.pages();
    let page = pages[0] || await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // ─── Step 2: Try loading existing cookies ───
    console.log('\n📌 STEP 2: Loading cookies...');
    const existingCookies = loadExistingCookies();

    if (existingCookies.length > 0) {
        console.log('Injecting existing cookies...');
        try {
            const client = await page.target().createCDPSession();
            const sanitized = existingCookies.map(c => {
                const copy = { ...c };
                delete copy.size;
                delete copy.session;
                return copy;
            });
            await client.send('Network.setCookies', { cookies: sanitized });
            console.log('✅ Cookies injected');
        } catch (e) {
            console.log(`⚠️ Cookie injection failed: ${e.message}`);
        }
    }

    // ─── Step 3: Check Google Account ───────────
    console.log('\n📌 STEP 3: Checking Google Account...');
    await page.goto('https://myaccount.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });
    await sleep(3000);

    let accountUrl = page.url();
    let accountText = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 300) : '');
    console.log(`📍 URL: ${accountUrl}`);

    let needsLogin = false;

    if (accountUrl.includes('ServiceLogin') || accountUrl.includes('signin')) {
        console.log('❌ Not logged in!');
        needsLogin = true;
    } else if (accountText.includes('Choose an account') || accountText.includes('Signed out')) {
        console.log('⚠️ Account chooser / Signed out');
        needsLogin = true;
    } else if (accountText.includes('Security') || accountText.includes('Personal info') ||
        accountText.includes('الأمان') || accountText.includes('المعلومات الشخصية')) {
        console.log('✅ Logged in to Google Account!');
    } else {
        console.log('⚠️ Unclear state, checking further...');
        needsLogin = true;
    }

    // ─── Step 4: Login if needed ────────────────
    if (needsLogin) {
        console.log('\n📌 STEP 4: Manual login required!');
        console.log('═'.repeat(60));
        console.log('👉 Please log in to your Google Account in the browser window.');
        console.log('👉 After login, visit https://meet.google.com/ and make sure');
        console.log('   you see the authenticated Meet page (not the marketing page).');
        console.log('═'.repeat(60));

        await page.goto('https://accounts.google.com/ServiceLogin', {
            waitUntil: 'networkidle2'
        });

        // Wait for login
        console.log('\n⏳ Waiting for you to log in...');
        let loggedIn = false;

        for (let i = 0; i < 120; i++) {
            await sleep(5000);

            try {
                const allPages = await browser.pages();
                for (const p of allPages) {
                    let url;
                    try { url = p.url(); } catch (_) { continue; }

                    if (url.includes('myaccount.google.com') && !url.includes('signin')) {
                        const text = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
                        if (text.includes('Security') || text.includes('Personal info') ||
                            text.includes('الأمان') || text.includes('المعلومات الشخصية')) {
                            loggedIn = true;
                            page = p;
                            break;
                        }
                    }

                    if (url.includes('google.com/account/about') || url.includes('ManageAccount')) {
                        // Navigate to myaccount to verify
                        await p.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2', timeout: 15000 });
                        await sleep(3000);
                        const finalUrl = p.url();
                        if (finalUrl.includes('myaccount.google.com') && !finalUrl.includes('signin')) {
                            loggedIn = true;
                            page = p;
                            break;
                        }
                    }
                }

                if (loggedIn) break;
                if (i % 6 === 0) console.log(`   Still waiting... (${i * 5}s)`);
            } catch (e) {
                // ignore
            }
        }

        if (!loggedIn) {
            console.log('❌ Login timed out!');
            await browser.close();
            process.exit(1);
        }

        console.log('✅ Login detected!');
    }

    // ─── Step 5: Visit Google services ──────────
    console.log('\n📌 STEP 5: Visiting Google services to collect cookies...');

    const services = [
        ['Google Account', 'https://myaccount.google.com/'],
        ['Gmail', 'https://mail.google.com/'],
        ['Google', 'https://www.google.com/'],
    ];

    for (const [name, url] of services) {
        try {
            console.log(`   → ${name}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
            await sleep(2000);
        } catch (_) {
            console.log(`   ⚠️ Timeout on ${name}`);
        }
    }

    // ─── Step 6: Check Meet authentication ──────
    console.log('\n📌 STEP 6: Checking Meet authentication...');
    await page.goto('https://meet.google.com/', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });
    await sleep(4000);

    let meetUrl = page.url();
    let meetText = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 500) : '');
    console.log(`📍 Meet URL: ${meetUrl}`);

    const isMarketingPage = meetUrl.includes('workspace.google.com') ||
        (meetText.includes('تسجيل الدخول') && meetText.includes('تجربة Meet')) ||
        (meetText.includes('Sign in') && meetText.includes('Try Meet'));

    if (isMarketingPage) {
        console.log('❌ Meet is showing the MARKETING page (not authenticated)!');
        console.log('');
        console.log('═'.repeat(60));
        console.log('🔧 FIX: You need to manually sign in to Meet.');
        console.log('');
        console.log('   I will now navigate to Meet login. Please:');
        console.log('   1. Click "Sign in" / "تسجيل الدخول"');
        console.log('   2. Select your Google account');
        console.log('   3. Wait until you see the authenticated Meet page');
        console.log('      (it should show "New meeting" / "اجتماع جديد")');
        console.log('═'.repeat(60));

        // Navigate to meet sign-in
        try {
            await page.goto('https://meet.google.com/?authuser=0', {
                waitUntil: 'networkidle2',
                timeout: 15000
            });
        } catch (_) {}

        // Wait for user to authenticate on Meet
        console.log('\n⏳ Waiting for Meet authentication...');
        let meetAuthed = false;

        for (let i = 0; i < 120; i++) {
            await sleep(5000);

            try {
                const allPages = await browser.pages();
                for (const p of allPages) {
                    let url;
                    try { url = p.url(); } catch (_) { continue; }

                    if (url.includes('meet.google.com') && !url.includes('workspace.google.com')) {
                        const text = await p.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

                        if (text.includes('New meeting') || text.includes('اجتماع جديد') ||
                            text.includes('Enter a code') || text.includes('إدخال الرمز')) {
                            console.log('✅ Meet authenticated!');
                            meetAuthed = true;
                            page = p;
                            break;
                        }
                    }
                }

                if (meetAuthed) break;
                if (i % 6 === 0) {
                    const currentText = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 100) : '').catch(() => '');
                    console.log(`   Still waiting... URL: ${page.url().substring(0, 60)} | "${currentText.substring(0, 50)}..."`);
                }
            } catch (_) {}
        }

        if (!meetAuthed) {
            console.log('❌ Meet authentication timed out!');
            console.log('   Saving current cookies anyway...');
        }
    } else {
        console.log('✅ Meet is authenticated!');
        console.log(`   Text: "${meetText.substring(0, 100)}..."`);
    }

    // ─── Step 7: Visit Meet a few more times for cookies ─
    console.log('\n📌 STEP 7: Collecting Meet cookies...');

    const meetUrls = [
        'https://meet.google.com/',
        'https://meet.google.com/new',
    ];

    for (const url of meetUrls) {
        try {
            console.log(`   → ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
            await sleep(3000);
        } catch (_) {
            console.log(`   ⚠️ Timeout`);
        }
    }

    // Navigate back to meet home
    try {
        await page.goto('https://meet.google.com/', { waitUntil: 'networkidle2', timeout: 15000 });
        await sleep(2000);
    } catch (_) {}

    // ─── Step 8: Extract and save cookies ───────
    console.log('\n📌 STEP 8: Extracting cookies...');
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    console.log(`\n📊 Total cookies: ${cookies.length}`);
    diagnoseCookies(cookies);

    saveCookies(cookies);

    // ─── Step 9: Test meeting join (if link provided) ─
    if (MEET_LINK) {
        console.log('\n📌 STEP 9: Testing meeting join...');
        console.log(`🔗 Meeting: ${MEET_LINK}`);

        await page.goto(MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(5000);

        const joinUrl = page.url();
        const joinText = await page.evaluate(() => document.body ? document.body.innerText : '');
        console.log(`📍 URL: ${joinUrl}`);

        if (joinUrl.includes('ServiceLogin') || joinUrl.includes('signin')) {
            console.log('❌ Redirected to sign-in! Cookies are not working for this meeting.');
        } else if (joinText.includes('Choose an account')) {
            console.log('⚠️ Account chooser appeared');
            console.log('   Trying to click account...');

            await page.evaluate(() => {
                const items = document.querySelectorAll('[data-identifier], [data-email]');
                if (items.length > 0) items[0].click();
            });
            await sleep(8000);

            const newUrl = page.url();
            if (newUrl.includes('signin')) {
                console.log('❌ Account selection led to sign-in — session dead for Meet');
            } else {
                console.log(`📍 After selection: ${newUrl}`);
            }
        } else if (joinText.includes("can't join") || joinText.includes("You can't join")) {
            console.log('⚠️ Meeting says "can\'t join" — meeting may not be active');
            console.log('   This is normal if the meeting hasn\'t started yet.');
        } else if (joinText.includes('Join now') || joinText.includes('Ask to join') ||
            joinText.includes('انضم الآن') || joinText.includes('طلب الانضمام')) {
            console.log('✅ JOIN PAGE REACHED! Bot can join this meeting!');

            console.log('\n🔇 Muting mic & camera...');
            await page.keyboard.down('Control');
            await page.keyboard.press('d');
            await page.keyboard.press('e');
            await page.keyboard.up('Control');
            await sleep(1000);

            console.log('🚪 Clicking join button...');
            const clicked = await page.evaluate(() => {
                const joinTexts = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام'];
                const buttons = document.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    if (joinTexts.some(j => text.includes(j))) {
                        btn.click();
                        return text;
                    }
                }
                return null;
            });

            if (clicked) {
                console.log(`✅ Clicked: "${clicked}"`);
                await sleep(8000);

                const afterJoinText = await page.evaluate(() => document.body ? document.body.innerText : '');
                if (afterJoinText.includes('Leave') || afterJoinText.includes('مغادرة')) {
                    console.log('🎉🎉🎉 SUCCESSFULLY JOINED THE MEETING! 🎉🎉🎉');
                } else {
                    console.log('⚠️ Join click done, but unclear if joined.');
                    console.log(`   Text: "${afterJoinText.substring(0, 150)}..."`);
                }
            } else {
                console.log('⚠️ Could not find join button to click');
            }
        } else {
            console.log(`⚠️ Unknown meeting page state:`);
            console.log(`   "${joinText.substring(0, 200)}..."`);
        }

        // Take screenshot
        const reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        await page.screenshot({ path: path.join(reportsDir, 'test_meeting.png') });
        console.log('📸 Screenshot saved to bot/reports/test_meeting.png');
    }

    // ─── Step 10: Final cookie extraction ───────
    console.log('\n📌 STEP 10: Final cookie extraction...');
    const { cookies: finalCookies } = await client.send('Network.getAllCookies');
    if (finalCookies.length > cookies.length) {
        console.log(`📊 Got ${finalCookies.length - cookies.length} additional cookies!`);
        saveCookies(finalCookies);
        diagnoseCookies(finalCookies);
    } else {
        console.log(`📊 ${finalCookies.length} cookies (same as before)`);
    }

    // ─── Summary ────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('📋 SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✅ Google Account: Authenticated`);

    const hasMeetCookies = finalCookies.some(c => (c.domain || '').includes('meet.google.com'));
    const hasSID = finalCookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID');
    console.log(`${hasSID ? '✅' : '❌'} SID cookies present`);
    console.log(`${hasMeetCookies ? '✅' : '⚠️'} Meet cookies present`);
    console.log(`📊 Total cookies: ${finalCookies.length}`);
    console.log('');
    console.log('📁 Files saved:');
    console.log('   • bot/cookies.json (raw cookies)');
    console.log('   • cookies/session.enc (encrypted)');
    console.log('   • cookies.base64.txt (for GitHub secret)');
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Copy contents of cookies.base64.txt');
    console.log('   2. Update GOOGLE_COOKIES secret on GitHub');
    console.log('   3. Push updated code');
    console.log('   4. Run the workflow');

    console.log('\n⏳ Browser will close in 10 seconds...');
    console.log('   (Switch to browser to inspect if needed)');
    await sleep(10000);

    await browser.close();
    console.log('\n✅ Done!');
}

main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});