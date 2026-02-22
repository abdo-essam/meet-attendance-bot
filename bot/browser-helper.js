// ============================================
//  Browser launch, stealth, and session helpers
// ============================================

const puppeteer = require('puppeteer-core');
const { getBrowserLaunchOptions, USER_AGENT, CHROME_PATH } = require('./config');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launch Chrome with stealth patches applied.
 */
async function launchBrowser({ minimal = false } = {}) {
    console.log(`\n🚀 Launching Chrome at: ${CHROME_PATH}`);
    const options = getBrowserLaunchOptions({ minimal });
    const browser = await puppeteer.launch(options);
    console.log('✅ Browser launched!');
    return browser;
}

/**
 * Create a new page with stealth patches and a realistic user-agent.
 */
async function createStealthPage(browser) {
    const page = await browser.newPage();

    // Hide webdriver flag
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.navigator.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ar'] });
    });

    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8' });

    // Grant permissions
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
 * Returns true if session is alive, false if expired.
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

    if (
        url.includes('ServiceLogin') ||
        url.includes('signin/identifier') ||
        url.includes('signin/v2')
    ) {
        console.log('❌ Session expired!');
        return false;
    }

    console.log('✅ Session OK!');
    return true;
}

module.exports = { sleep, launchBrowser, createStealthPage, verifySession };
