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
            console.log('✅ Loaded from encrypted file (' + cookies.length + ' cookies)');
        } catch (e) {
            console.log('⚠️ Encrypted file failed: ' + e.message);
        }
    }

    // Source 2: Raw cookies.json (from initial setup or refresh)
    var rawPath = path.join(__dirname, 'cookies.json');
    if (cookies.length === 0 && fs.existsSync(rawPath)) {
        try {
            cookies = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
            console.log('✅ Loaded from cookies.json (' + cookies.length + ' cookies)');
        } catch (e) {
            console.log('⚠️ cookies.json failed: ' + e.message);
        }
    }

    // Source 3: GitHub Secret (base64)
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
        console.log('❌ NO COOKIES! Run save-cookies.js on your PC first.');
        process.exit(1);
    }

    if (cookies.length < 10) {
        console.log('⚠️ WARNING: Only ' + cookies.length + ' cookies found. This is suspiciously low.');
        console.log('   A proper Google session usually has 50-150+ cookies.');
        console.log('   Consider re-running save-cookies.js on your PC.');
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
            '--no-zygote',
            '--use-fake-ui-for-media-stream',
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

    // ─── Load Cookies into Browser ───
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

    // ─── Verify Google Session ───
    console.log('\n🌐 Verifying Google Session...');

    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await sleep(5000);
    } catch (e) {
        console.log('⚠️ Navigation error: ' + e.message);
    }

    const currUrl = page.url();
    console.log('📍 Current URL: ' + currUrl);

    // Check if we're signed in (Google redirects to various URLs when logged in)
    const isSignedIn =
        currUrl.includes('myaccount.google.com') ||
        currUrl.includes('accounts.google.com/SignOutOptions') ||
        currUrl.includes('google.com/account/about');

    // Make sure we're NOT on a sign-in/login page
    const isOnSignIn =
        currUrl.includes('ServiceLogin') ||
        currUrl.includes('signin/v2') ||
        currUrl.includes('accounts.google.com/v3/signin') ||
        currUrl.includes('signin/identifier');

    if (!isSignedIn || isOnSignIn) {
        console.log('❌ Google session invalid!');
        console.log('⚠️ Redirected to: ' + currUrl);
        console.log('🛑 Aborting to prevent overwriting saved cookies with empty ones.');
        console.log('👉 Run save-cookies.js on your PC and update GOOGLE_COOKIES secret.');

        // Take a debug screenshot before exiting
        var reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        try {
            await page.screenshot({
                path: path.join(reportsDir, 'debug_session_failed.png'),
                fullPage: true
            });
            console.log('📸 Debug screenshot saved to reports/debug_session_failed.png');
        } catch (e) {
            console.log('⚠️ Could not take debug screenshot: ' + e.message);
        }

        await browser.close();
        process.exit(1);
    } else {
        console.log('✅ Google session verified! Profile is active.');
    }

    // ─── Navigate to Google Meet ───
    console.log('\n⏳ Navigating to ' + meetLink + '...');

    try {
        await page.goto(meetLink, {
            waitUntil: 'domcontentloaded',
            timeout: 90000
        });

        console.log('⏳ Letting page settle for 15 seconds...');
        await sleep(15000);

        console.log('📍 Meet URL: ' + page.url());

        // Take a screenshot of the meet landing page
        var reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }

        try {
            await page.screenshot({
                path: path.join(reportsDir, 'meet_landing.png')
            });
            console.log('📸 Meet landing screenshot saved');
        } catch (e) {
            console.log('⚠️ Could not take landing screenshot');
        }

        // ─── Mute audio and video ───
        console.log('🔇 Muting microphone and camera...');
        await page.keyboard.down('Control');
        await page.keyboard.press('d');
        await page.keyboard.press('e');
        await page.keyboard.up('Control');
        await sleep(3000);

        // ─── Try to join the meeting ───
        let joinAttempt = 0;
        let inMeeting = false;

        // Method 1: Try clicking join buttons
        console.log('🔍 Looking for join button...');

        const joinButtonSelectors = [
            'button[jsname="Qx7uuf"]',           // "Join now" button
            'button[data-idom-class*="join"]',
            '[role="button"][jsname="A5il2e"]',    // "Ask to join"
            'button:has-text("Join now")',
            'button:has-text("Ask to join")',
            'button:has-text("Join")',
        ];

        for (const selector of joinButtonSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    console.log('✅ Found join button: ' + selector);
                    await btn.click();
                    await sleep(5000);
                    inMeeting = true;
                    break;
                }
            } catch (e) {
                // try next selector
            }
        }

        // Method 2: Try XPath text matching
        if (!inMeeting) {
            console.log('🔍 Trying text-based button search...');
            try {
                const buttons = await page.$$('button');
                for (const btn of buttons) {
                    const text = await page.evaluate(el => el.textContent, btn);
                    if (text && (
                        text.includes('Join now') ||
                        text.includes('Ask to join') ||
                        text.includes('Join') ||
                        text.includes('انضمام')  // Arabic "Join"
                    )) {
                        console.log('✅ Found button with text: ' + text.trim());
                        await btn.click();
                        await sleep(5000);
                        inMeeting = true;
                        break;
                    }
                }
            } catch (e) {
                console.log('⚠️ Text search failed: ' + e.message);
            }
        }

        // Method 3: Fallback to Enter key (original method)
        if (!inMeeting) {
            console.log('🔍 Falling back to Enter key method...');
            while (joinAttempt < 3 && !inMeeting) {
                joinAttempt++;
                console.log('[Attempt ' + joinAttempt + '/3] Pressing Enter to join...');

                await page.bringToFront();
                await page.keyboard.press('Enter');
                await sleep(8000);

                let currentUrl = page.url();
                if (!currentUrl.includes('landing') && !currentUrl.includes('workspace')) {
                    inMeeting = true;
                }
            }
        }

        // Take screenshot after join attempt
        try {
            await page.screenshot({
                path: path.join(reportsDir, 'after_join_attempt.png')
            });
            console.log('📸 Post-join screenshot saved');
        } catch (e) { }

        if (inMeeting) {
            console.log('✅ Successfully joined (or attempted to join) the meeting!');
        } else {
            console.log('⚠️ Could not confirm meeting join. Continuing anyway...');
        }

    } catch (e) {
        console.log('⚠️ Error navigating or joining meeting: ' + e.message);
    }

    // ─── Stay in Meeting ───
    console.log('\n🎥 In meeting... staying for ' + durationMinutes + ' minutes.');

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    let screenshotIndex = 1;
    const loopTimeMinutes = 10;
    var endTime = Date.now() + (durationMinutes * 60 * 1000);

    while (Date.now() < endTime) {
        var now = new Date().toISOString();
        var minutesLeft = Math.round((endTime - Date.now()) / 60000);
        console.log('[' + now + '] Still in meeting... ' + minutesLeft + ' minutes remaining');

        try {
            await page.screenshot({
                path: path.join(reportsDir, 'screenshot_' + screenshotIndex + '.png')
            });
            console.log('📸 Screenshot ' + screenshotIndex + ' saved');
        } catch (err) {
            console.log('⚠️ Could not take screenshot: ' + err.message);
        }
        screenshotIndex++;

        // Keep the page alive — move mouse occasionally to prevent idle timeout
        try {
            await page.mouse.move(
                Math.floor(Math.random() * 800) + 100,
                Math.floor(Math.random() * 500) + 100
            );
        } catch (e) { }

        const timeLeft = endTime - Date.now();
        const waitMs = Math.min(timeLeft, loopTimeMinutes * 60 * 1000);
        if (waitMs <= 0) break;

        await sleep(waitMs);
    }

    console.log('\n✅ Meeting time over. Generating final report.');

    // ─── Generate Report ───
    var reportContent = [
        '═══════════════════════════════════════',
        '📊 Attendance Report',
        '═══════════════════════════════════════',
        '',
        'Meeting Link: ' + meetLink,
        'Meeting Name: ' + (process.env.MEETING_NAME || 'Unknown'),
        'Duration:     ' + durationMinutes + ' minutes',
        'Started:      ' + new Date(endTime - durationMinutes * 60000).toISOString(),
        'Ended:        ' + new Date().toISOString(),
        'Screenshots:  ' + (screenshotIndex - 1),
        '',
        '═══════════════════════════════════════'
    ].join('\n');

    fs.writeFileSync(path.join(reportsDir, 'report.txt'), reportContent);
    console.log('📄 Report saved');

    // ═════════════════════════════════
    //  SAVE REFRESHED COOKIES
    // ═════════════════════════════════
    console.log('\n🍪 Saving refreshed cookies...');

    try {
        const client = await page.target().createCDPSession();
        const { cookies: freshCookies } = await client.send('Network.getAllCookies');

        console.log('📊 Got ' + freshCookies.length + ' fresh cookies');

        if (freshCookies.length < 10) {
            console.log('⚠️ Too few cookies — skipping save to protect existing cookies');
        } else {
            // Save raw backup
            fs.writeFileSync(
                path.join(__dirname, 'cookies.json'),
                JSON.stringify(freshCookies),
                'utf8'
            );
            console.log('📄 Raw cookies saved');

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

            console.log('🔒 Encrypted cookies saved (' + freshCookies.length + ')');
        }
    } catch (e) {
        console.log('⚠️ Cookie save error: ' + e.message);
    }

    await browser.close();
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Bot finished successfully!');
    console.log('═'.repeat(50));
}

main().catch(function (e) {
    console.error('❌ Bot error:', e);
    process.exit(1);
});