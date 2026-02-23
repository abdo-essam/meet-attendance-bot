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
 * Checks both URL and page content thoroughly.
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
        url.includes('signin/v2') ||
        url.includes('/account/about')
    ) {
        console.log('❌ Session expired! (URL indicates sign-in page or about page)');
        return false;
    }

    // Check page content
    try {
        const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');

        // Handle "Choose an account" page
        if (pageText.includes('Choose an account') || pageText.includes('اختيار حساب')) {
            // Check if any account says "Signed out"
            if (pageText.includes('Signed out') || pageText.includes('تم تسجيل الخروج')) {
                console.log('❌ Session expired! All accounts are signed out.');
                return false;
            }

            console.log('⚠️ "Choose an account" page — trying to select...');
            const clicked = await page.evaluate(() => {
                // Look for accounts that are NOT signed out
                const items = document.querySelectorAll('[data-identifier], [data-email]');
                for (const item of items) {
                    const text = item.textContent || '';
                    if (!text.includes('Signed out') && !text.includes('تم تسجيل الخروج')) {
                        item.click();
                        return true;
                    }
                }
                // If all are signed out, click first anyway to see what happens
                if (items.length > 0) {
                    items[0].click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                await sleep(8000);
                const newUrl = page.url();
                const newText = await page.evaluate(() => document.body ? document.body.innerText : '');

                if (newUrl.includes('ServiceLogin') || newUrl.includes('signin') ||
                    newText.includes('Enter your password') || newText.includes('أدخل كلمة المرور')) {
                    console.log('❌ Session expired! Redirected to password entry.');
                    return false;
                }

                if (newUrl.includes('myaccount.google.com') && !newText.includes('Choose an account')) {
                    console.log('✅ Session OK! (after account selection)');
                    return true;
                }
            }

            console.log('❌ Could not verify session through account chooser');
            return false;
        }

        // Check for actual account content
        if (pageText.includes('Security') || pageText.includes('الأمان') ||
            pageText.includes('Personal info') || pageText.includes('المعلومات الشخصية') ||
            pageText.includes('Data & privacy') || pageText.includes('البيانات والخصوصية')) {
            console.log('✅ Session OK! (account page content verified)');
            return true;
        }

        // Generic sign-in check
        if (pageText.includes('Sign in') && !pageText.includes('Sign out') &&
            !pageText.includes('Security') && !pageText.includes('Personal info')) {
            console.log('❌ Session expired! Page shows sign-in prompt.');
            return false;
        }

    } catch (err) {
        console.log(`⚠️ Content check error: ${err.message}`);
    }

    console.log('✅ Session OK!');
    return true;
}

module.exports = { sleep, launchBrowser, createStealthPage, verifySession };