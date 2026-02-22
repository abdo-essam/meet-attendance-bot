const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');

async function saveCookies() {
    console.log('='.repeat(50));
    console.log('🚀 Step 1: Login & Save Cookies (Automated Browser)');
    console.log('='.repeat(50));
    console.log('\nOpening Chrome...');
    console.log('👉 Please log in to your Google Account.');
    console.log('Waiting for you to finish logging in...');

    // Launch non-headless browser so user can login directly inside it
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
    const page = pages.length ? pages[0] : await browser.newPage();

    // Spoof User Agent to avoid "This browser or app may not be secure." block by Google
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    // Go to Google login page
    await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2' });

    console.log('\n⚠️ Once you have successfully logged in and can see your Google Account dashboard,');
    console.log('the script will detect it and save your cookies automatically within 5-10 seconds.');

    // Polling to wait until URL indicates successful sign-in
    let isLoggedIn = false;
    for (let i = 0; i < 180; i++) { // wait up to 15 minutes
        await new Promise(r => setTimeout(r, 5000));
        try {
            // Re-fetch all pages in case the user opened a new tab or popup
            const currentPages = await browser.pages();
            for (let p of currentPages) {
                const url = p.url();
                console.log(`[Timer] Checking tab URL: ${url}`);

                if (url.includes('myaccount.google.com') || url.includes('myaccount.google') || url.includes('ManageAccount')) {
                    isLoggedIn = true;
                    // Switch to the correct page for CDP extraction
                    page = p;
                    break;
                }
            }
            if (isLoggedIn) break;
        } catch (e) { /* ignore */ }
    }

    if (!isLoggedIn) {
        console.log('\n❌ Login timed out or you closed the browser.');
        console.log('Please try again.');
        await browser.close();
        process.exit(1);
    }

    console.log('\n✅ Login detected! Extracting full session cookies via CDP...');

    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    // Save base64 string
    const jsonStr = JSON.stringify(cookies);
    const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64');

    fs.writeFileSync('cookies.base64.txt', base64Str, 'utf8');

    console.log('\n✅ Cookies successfully extracted and saved to cookies.base64.txt (' + cookies.length + ' cookies)');
    console.log('📋 Now, copy the contents of cookies.base64.txt and paste it into');
    console.log('   your GitHub Secret named: GOOGLE_COOKIES');

    await browser.close();
}

saveCookies().catch(console.error);