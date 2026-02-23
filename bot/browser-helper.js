const puppeteer = require('puppeteer');
const { getBrowserLaunchOptions, USER_AGENT, CHROME_PATH } = require('./config');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function launchBrowser() {
    console.log(`\n🚀 Launching Chrome${CHROME_PATH ? ` at: ${CHROME_PATH}` : ' (puppeteer bundled)'}`);
    const options = getBrowserLaunchOptions();
    const browser = await puppeteer.launch(options);
    console.log('✅ Browser launched!');
    return browser;
}

async function createStealthPage(browser) {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
    });

    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' });

    try {
        const ctx = browser.defaultBrowserContext();
        await ctx.overridePermissions('https://meet.google.com', [
            'camera',
            'microphone',
            'notifications',
        ]);
    } catch (_) { /* not critical */ }

    return page;
}

/**
 * Verify the Google session is still active.
 * IMPROVED: Actually checks page content, not just URL.
 */
async function verifySession(page) {
    console.log('\n🌐 Verifying session...');
    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });
    } catch (_) { /* timeout is non-fatal */ }

    await sleep(5000);

    const url = page.url();
    console.log(`📍 ${url}`);

    // Check URL-based indicators
    if (
        url.includes('ServiceLogin') ||
        url.includes('signin/identifier') ||
        url.includes('signin/v2')
    ) {
        console.log('❌ Session expired! (URL indicates sign-in page)');
        return false;
    }

    // IMPROVED: Check page content for sign-out indicators
    try {
        const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');

        if (pageText.includes('Choose an account') || pageText.includes('اختيار حساب')) {
            console.log('⚠️ "Choose an account" page detected — session may be partial');
            console.log('🔄 Attempting to select account...');

            // Try to click the account
            const clicked = await page.evaluate(() => {
                const items = document.querySelectorAll('[data-identifier], [data-email]');
                if (items.length > 0) {
                    items[0].click();
                    return true;
                }
                const listItems = document.querySelectorAll('li');
                for (const li of listItems) {
                    const t = li.textContent || '';
                    if (t.includes('@') && !t.includes('Use another') && !t.includes('Remove')) {
                        li.click();
                        return true;
                    }
                }
                return false;
            });

            if (clicked) {
                console.log('✅ Account selected, waiting...');
                await sleep(8000);

                const newUrl = page.url();
                const newText = await page.evaluate(() => document.body ? document.body.innerText : '');

                // Check if we ended up on sign-in
                if (newUrl.includes('ServiceLogin') || newUrl.includes('signin') ||
                    newText.includes('Signed out') || newText.includes('Enter your password')) {
                    console.log('❌ Session expired! Account is signed out.');
                    return false;
                }

                if (newUrl.includes('myaccount.google.com') && !newText.includes('Choose an account')) {
                    console.log('✅ Session OK! (after account selection)');
                    return true;
                }
            }

            // If the account shows "Signed out", session is dead
            if (pageText.includes('Signed out') || pageText.includes('تسجيل الخروج')) {
                console.log('❌ Session expired! Account shows "Signed out".');
                return false;
            }
        }

        // Check if we're actually on the account page with content
        if (pageText.includes('Sign in') && !pageText.includes('Sign out') &&
            !pageText.includes('Security') && !pageText.includes('Personal info')) {
            console.log('❌ Session expired! Page shows Sign in prompt.');
            return false;
        }

    } catch (err) {
        console.log(`⚠️ Content check error: ${err.message}`);
    }

    console.log('✅ Session OK!');
    return true;
}

module.exports = { sleep, launchBrowser, createStealthPage, verifySession };
