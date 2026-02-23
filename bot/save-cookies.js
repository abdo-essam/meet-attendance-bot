const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function saveCookies() {
    console.log('='.repeat(50));
    console.log('🚀 Step 1: Login & Save Cookies');
    console.log('='.repeat(50));
    console.log('\nOpening Chrome...');
    console.log('👉 Please log in to your Google Account.');

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled'
            ],
            defaultViewport: null
        });
    } catch (err) {
        console.log('⚠️ Could not launch Chrome.');
        console.log(err.message);
        process.exit(1);
    }

    const pages = await browser.pages();
    let page = pages.length ? pages[0] : await browser.newPage();
    //  ^^^ CHANGED: const → let (so we can reassign later)

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Navigate to Google Account
    await page.goto('https://accounts.google.com/ServiceLogin', {
        waitUntil: 'networkidle2'
    });

    console.log('\n⚠️  Log in to your Google account in the browser window.');
    console.log('    Once you see your Google Account dashboard, cookies will be saved.\n');

    // ─── Wait for successful login ───
    let isLoggedIn = false;
    let targetPage = null;

    for (let i = 0; i < 180; i++) { // up to ~15 minutes
        await sleep(5000);

        try {
            const currentPages = await browser.pages();

            for (let p of currentPages) {
                let url;
                try {
                    url = p.url();
                } catch (e) {
                    continue; // page might be closed
                }

                console.log(`[Check ${i + 1}] Tab: ${url}`);

                // ─── Expanded detection ───
                // Google may land on any of these after successful login:
                if (
                    url.includes('myaccount.google.com') ||
                    url.includes('accounts.google.com/SignOutOptions') ||
                    url.includes('google.com/account/about') ||  // ← THIS is your case!
                    url.includes('ManageAccount')
                ) {
                    // Double-check: try to visit myaccount and see if we stay
                    await p.goto('https://myaccount.google.com/', {
                        waitUntil: 'networkidle2',
                        timeout: 15000
                    });
                    await sleep(3000);

                    const finalUrl = p.url();
                    console.log(`[Verify] Final URL: ${finalUrl}`);

                    if (
                        finalUrl.includes('myaccount.google.com') &&
                        !finalUrl.includes('signin') &&
                        !finalUrl.includes('ServiceLogin')
                    ) {
                        isLoggedIn = true;
                        targetPage = p;
                        break;
                    }
                }
            }

            if (isLoggedIn) break;
        } catch (e) {
            console.log(`[Check ${i + 1}] Error: ${e.message}`);
        }
    }

    if (!isLoggedIn || !targetPage) {
        console.log('\n❌ Login timed out. Please try again.');
        await browser.close();
        process.exit(1);
    }

    console.log('\n✅ Login detected! Extracting cookies...');

    // ─── Visit multiple Google services to collect ALL cookies ───
    console.log('🌐 Visiting Google services to collect all cookies...');

    const servicesToVisit = [
        'https://myaccount.google.com/',
        'https://mail.google.com/',
        'https://meet.google.com/',
        'https://www.google.com/',
    ];

    for (const serviceUrl of servicesToVisit) {
        try {
            console.log(`  → Visiting ${serviceUrl}`);
            await targetPage.goto(serviceUrl, {
                waitUntil: 'networkidle2',
                timeout: 20000
            });
            await sleep(2000);
        } catch (e) {
            console.log(`  ⚠️ Could not visit ${serviceUrl}: ${e.message}`);
        }
    }

    // ─── Extract ALL cookies via CDP ───
    const client = await targetPage.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    console.log(`\n📊 Extracted ${cookies.length} cookies`);

    if (cookies.length < 10) {
        console.log('⚠️ WARNING: Very few cookies extracted. Login may not be complete.');
        console.log('   Try logging in again and make sure you reach the dashboard.');
    }

    // Save as base64
    const jsonStr = JSON.stringify(cookies);
    const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64');
    fs.writeFileSync('cookies.base64.txt', base64Str, 'utf8');

    // Also save raw JSON for debugging
    fs.writeFileSync('cookies.debug.json', JSON.stringify(cookies, null, 2), 'utf8');

    console.log('\n✅ Saved to cookies.base64.txt (' + cookies.length + ' cookies)');
    console.log('📋 Copy the contents of cookies.base64.txt into your GitHub Secret: GOOGLE_COOKIES');
    console.log('\n💡 Debug: cookies.debug.json also saved (do NOT upload this to GitHub)');

    await browser.close();
}

saveCookies().catch(console.error);