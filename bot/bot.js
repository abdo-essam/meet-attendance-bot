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

    // Source 2: Raw cookies.json
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
            '--use-fake-device-for-media-stream',
            '--disable-blink-features=AutomationControlled',
            '--auto-accept-camera-and-microphone-capture'
        ],
        defaultViewport: { width: 1280, height: 720 }
    });

    var page = await browser.newPage();

    // Grant permissions for camera and microphone to avoid popups
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://meet.google.com', [
        'camera',
        'microphone',
        'notifications'
    ]);

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8'
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

    const isSignedIn =
        currUrl.includes('myaccount.google.com') ||
        currUrl.includes('accounts.google.com/SignOutOptions') ||
        currUrl.includes('google.com/account/about');

    const isOnSignIn =
        currUrl.includes('ServiceLogin') ||
        currUrl.includes('signin/v2') ||
        currUrl.includes('accounts.google.com/v3/signin') ||
        currUrl.includes('signin/identifier');

    if (!isSignedIn || isOnSignIn) {
        console.log('❌ Google session invalid!');
        console.log('⚠️ Redirected to: ' + currUrl);
        console.log('🛑 Aborting.');

        var reportsDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
        try {
            await page.screenshot({
                path: path.join(reportsDir, 'debug_session_failed.png'),
                fullPage: true
            });
        } catch (e) { }

        await browser.close();
        process.exit(1);
    } else {
        console.log('✅ Google session verified! Profile is active.');
    }

    // ─── Navigate to Google Meet ───
    console.log('\n⏳ Navigating to ' + meetLink + '...');

    var reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    try {
        await page.goto(meetLink, {
            waitUntil: 'networkidle2',
            timeout: 90000
        });

        console.log('⏳ Letting page load for 10 seconds...');
        await sleep(10000);

        console.log('📍 Meet URL: ' + page.url());

        try {
            await page.screenshot({
                path: path.join(reportsDir, 'step1_meet_landing.png')
            });
            console.log('📸 Step 1: Landing page screenshot saved');
        } catch (e) { }

        // ─── Step 1: Dismiss any popups/dialogs ───
        console.log('\n🔕 Dismissing popups and dialogs...');

        // Close the "microphone not found" / "camera not found" popup
        try {
            // Look for the X/close button on the popup
            const closeSelectors = [
                'button[aria-label="Close"]',
                'button[aria-label="إغلاق"]',        // Arabic "Close"
                'button[aria-label="Dismiss"]',
                '[data-mdc-dialog-action="close"]',
                '.google-material-icons:has-text("close")',
            ];

            for (const sel of closeSelectors) {
                try {
                    const closeBtn = await page.$(sel);
                    if (closeBtn) {
                        await closeBtn.click();
                        console.log('✅ Closed popup via: ' + sel);
                        await sleep(1000);
                        break;
                    }
                } catch (e) { }
            }

            // Also try clicking the X icon by evaluating text content
            const allButtons = await page.
            $$
            ('button');
            for (const btn of allButtons) {
                try {
                    const text = await page.evaluate(el => el.textContent.trim(), btn);
                    const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label') || '', btn);
                    if (
                        text === 'close' ||
                        text === '✕' ||
                        text === '×' ||
                        ariaLabel.includes('Close') ||
                        ariaLabel.includes('إغلاق') ||
                        ariaLabel.includes('Dismiss')
                    ) {
                        await btn.click();
                        console.log('✅ Closed popup via button text/aria: "' + (text || ariaLabel) + '"');
                        await sleep(1000);
                        break;
                    }
                } catch (e) { }
            }
        } catch (e) {
            console.log('⚠️ Popup dismiss attempt: ' + e.message);
        }

        // Press Escape to dismiss any remaining overlays
        await page.keyboard.press('Escape');
        await sleep(1000);

        try {
            await page.screenshot({
                path: path.join(reportsDir, 'step2_after_popup_dismiss.png')
            });
            console.log('📸 Step 2: After popup dismiss screenshot saved');
        } catch (e) { }

        // ─── Step 2: Mute audio and video ───
        console.log('\n🔇 Muting microphone and camera...');

        // Method 1: Keyboard shortcuts
        await page.keyboard.down('Control');
        await page.keyboard.press('d');  // Toggle camera
        await page.keyboard.press('e');  // Toggle microphone
        await page.keyboard.up('Control');
        await sleep(2000);

        // Method 2: Try clicking the mic/camera toggle buttons directly
        try {
            // Mic button (has microphone icon with warning)
            const micButtons = await page.
            $$
            ('[data-is-muted]');
            for (const btn of micButtons) {
                try {
                    const isMuted = await page.evaluate(el => el.getAttribute('data-is-muted'), btn);
                    if (isMuted === 'false') {
                        await btn.click();
                        console.log('🔇 Muted via data-is-muted button');
                        await sleep(500);
                    }
                } catch (e) { }
            }
        } catch (e) { }

        try {
            await page.screenshot({
                path: path.join(reportsDir, 'step3_after_mute.png')
            });
            console.log('📸 Step 3: After mute screenshot saved');
        } catch (e) { }

        // ─── Step 3: Click the JOIN button ───
        console.log('\n🚪 Attempting to join meeting...');

        let inMeeting = false;

        // ════════════════════════════════════════
        // METHOD A: Direct CSS selector for "Join now" / "انضم الآن" button
        // ════════════════════════════════════════
        console.log('🔍 Method A: CSS selectors...');

        const joinSelectors = [
            // Google Meet known join button selectors
            'button[jsname="Qx7uuf"]',              // "Join now" (common jsname)
            'button[jsname="A5il2e"]',               // "Ask to join"
            'button[data-idom-class*="nN7Gse"]',     // Join button class
            '[role="button"][jsname="Qx7uuf"]',
            '[role="button"][jsname="A5il2e"]',
        ];

        for (const selector of joinSelectors) {
            try {
                const btn = await page.$(selector);
                if (btn) {
                    const btnText = await page.evaluate(el => el.textContent.trim(), btn);
                    console.log('✅ Found join button via selector "' + selector + '": "' + btnText + '"');
                    await btn.click();
                    await sleep(5000);
                    inMeeting = true;
                    break;
                }
            } catch (e) { }
        }

        // ════════════════════════════════════════
        // METHOD B: Find button by EXACT text match
        // ════════════════════════════════════════
        if (!inMeeting) {
            console.log('🔍 Method B: Exact text match...');

            // These are the EXACT texts for the join button in various languages
            const joinTexts = [
                'انضم الآن',          // Arabic: "Join now"
                'الانضمام الآن',       // Arabic variant
                'Join now',            // English
                'Ask to join',         // English
                'طلب الانضمام',       // Arabic: "Ask to join"
            ];

            try {
                const allButtons = await page.$$('button');
                console.log('   Found ' + allButtons.length + ' buttons on page');

                for (const btn of allButtons) {
                    try {
                        const text = await page.evaluate(el => el.textContent.trim(), btn);
                        const isVisible = await page.evaluate(el => {
                            const style = window.getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                style.opacity !== '0' &&
                                rect.width > 0 &&
                                rect.height > 0;
                        }, btn);

                        if (!isVisible) continue;

                        console.log('   Button: "' + text + '" (visible: ' + isVisible + ')');

                        // Check if button text EXACTLY matches a join text
                        for (const joinText of joinTexts) {
                            if (text === joinText || text.includes(joinText)) {
                                console.log('✅ MATCH! Clicking: "' + text + '"');
                                await btn.click();
                                await sleep(5000);
                                inMeeting = true;
                                break;
                            }
                        }

                        if (inMeeting) break;
                    } catch (e) { }
                }
            } catch (e) {
                console.log('⚠️ Button text search failed: ' + e.message);
            }
        }

        // ════════════════════════════════════════
        // METHOD C: Find by aria-label
        // ════════════════════════════════════════
        if (!inMeeting) {
            console.log('🔍 Method C: Aria-label search...');

            const joinAriaLabels = [
                'Join now',
                'انضم الآن',
                'Ask to join',
                'طلب الانضمام',
                'Join call',
                'Join meeting',
            ];

            for (const label of joinAriaLabels) {
                try {
                    const btn = await page.$('button[aria-label="' + label + '"]');
                    if (btn) {
                        console.log('✅ Found button with aria-label: "' + label + '"');
                        await btn.click();
                        await sleep(5000);
                        inMeeting = true;
                        break;
                    }
                } catch (e) { }
            }
        }

        // ════════════════════════════════════════
        // METHOD D: page.evaluate — find the BIG blue button
        // ════════════════════════════════════════
        if (!inMeeting) {
            console.log('🔍 Method D: Find large colored join button via JS evaluation...');

            try {
                const clicked = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        const style = window.getComputedStyle(btn);
                        const rect = btn.getBoundingClientRect();
                        const text = btn.textContent.trim();
                        const bgColor = style.backgroundColor;

                        // The "Join now" button is typically:
                        // - Large (width > 100px, height > 40px)
                        // - Blue background
                        // - Contains "انضم" or "Join"
                        const isLarge = rect.width > 100 && rect.height > 40;
                        const isBlue = bgColor.includes('26, 115, 232') ||  // Google blue
                            bgColor.includes('rgb(26, 115, 232)') ||
                            bgColor.includes('rgb(24, 90, 188)') ||
                            bgColor.includes('rgb(66, 133, 244)');
                        const hasJoinText = text.includes('انضم') ||
                            text.includes('Join') ||
                            text.includes('join');

                        if (isLarge && (isBlue || hasJoinText)) {
                            console.log('Found candidate: "' + text + '" size=' + rect.width + 'x' + rect.height + ' bg=' + bgColor);
                            btn.click();
                            return text;
                        }
                    }
                    return null;
                });

                if (clicked) {
                    console.log('✅ Clicked large button: "' + clicked + '"');
                    await sleep(5000);
                    inMeeting = true;
                }
            } catch (e) {
                console.log('⚠️ JS evaluation failed: ' + e.message);
            }
        }

        // ════════════════════════════════════════
        // METHOD E: XPath with contains text
        // ════════════════════════════════════════
        if (!inMeeting) {
            console.log('🔍 Method E: XPath text search...');

            const xpaths = [
                "//button[contains(., 'انضم الآن')]",
                "//button[contains(., 'Join now')]",
                "//button[contains(., 'Ask to join')]",
                "//button[contains(., 'طلب الانضمام')]",
                "//span[contains(., 'انضم الآن')]/ancestor::button",
                "//span[contains(., 'Join now')]/ancestor::button",
            ];

            for (const xpath of xpaths) {
                try {
                    const elements = await page.$x(xpath);
                    if (elements.length > 0) {
                        // Click the FIRST matching button
                        const text = await page.evaluate(el => el.textContent.trim(), elements[0]);
                        console.log('✅ Found via XPath: "' + text + '"');
                        await elements[0].click();
                        await sleep(5000);
                        inMeeting = true;
                        break;
                    }
                } catch (e) { }
            }
        }

        // ════════════════════════════════════════
        // METHOD F: Last resort — Tab + Enter
        // ════════════════════════════════════════
        if (!inMeeting) {
            console.log('🔍 Method F: Tab navigation + Enter...');

            // Tab through the page elements to reach the join button
            for (let i = 0; i < 15; i++) {
                await page.keyboard.press('Tab');
                await sleep(300);
            }
            await page.keyboard.press('Enter');
            await sleep(5000);

            console.log('   Pressed Tab x15 + Enter');
        }

        // Take screenshot after all join attempts
        try {
            await page.screenshot({
                path: path.join(reportsDir, 'step4_after_join_attempt.png')
            });
            console.log('📸 Step 4: After join attempt screenshot saved');
        } catch (e) { }

        // ─── Verify if we actually joined ───
        console.log('\n🔍 Verifying meeting join status...');
        await sleep(3000);

        let joinVerified = false;

        try {
            // Check for elements that only appear INSIDE a meeting
            const inMeetingIndicators = [
                '[data-meeting-title]',
                '[data-call-active]',
                'button[aria-label*="Leave"]',
                'button[aria-label*="مغادرة"]',        // Arabic "Leave"
                'button[aria-label*="End call"]',
                'button[aria-label*="إنهاء"]',         // Arabic "End"
                '[data-self-name]',
                'div[jsname="EaZ7Me"]',                // People panel
            ];

            for (const indicator of inMeetingIndicators) {
                const el = await page.$(indicator);
                if (el) {
                    console.log('✅ CONFIRMED: In meeting! Found: ' + indicator);
                    joinVerified = true;
                    break;
                }
            }

            if (!joinVerified) {
                // Check page content for meeting indicators
                const pageContent = await page.content();
                if (
                    pageContent.includes('data-meeting-title') ||
                    pageContent.includes('Leave call') ||
                    pageContent.includes('مغادرة المكالمة') ||
                    pageContent.includes('end_call')
                ) {
                    console.log('✅ CONFIRMED: In meeting (via page content)!');
                    joinVerified = true;
                }
            }

            if (!joinVerified) {
                console.log('⚠️ Could not confirm meeting join. Screenshots will show actual state.');
                console.log('   The bot will continue running regardless.');
            }
        } catch (e) {
            console.log('⚠️ Verification error: ' + e.message);
        }

    } catch (e) {
        console.log('⚠️ Error navigating or joining meeting: ' + e.message);
    }

    // ─── Stay in Meeting ───
    console.log('\n🎥 In meeting... staying for ' + durationMinutes + ' minutes.');

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

        // Keep page alive — random mouse movement
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
            fs.writeFileSync(
                path.join(__dirname, 'cookies.json'),
                JSON.stringify(freshCookies),
                'utf8'
            );
            console.log('📄 Raw cookies saved');

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