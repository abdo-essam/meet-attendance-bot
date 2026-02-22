const puppeteer = require('puppeteer');
const fs = require('fs');

async function saveCookies() {
    console.log('='.repeat(50));
    console.log('🚀 Step 1: Login & Save Cookies (Remote Debug)');
    console.log('='.repeat(50));

    console.log('\n⚠️ Make sure Chrome is running with remote debugging:');
    console.log('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-debug"');

    let browser;

    try {
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null
        });
    } catch (err) {
        console.error('\n❌ Could not connect to Chrome on port 9222.');
        console.error('👉 Start Chrome with remote debugging first.');
        process.exit(1);
    }

    const pages = await browser.pages();
    const page = pages.length ? pages[0] : await browser.newPage();

    console.log('\nOpening Google Account page...');
    await page.goto('https://myaccount.google.com/', { waitUntil: 'networkidle2' });

    console.log('\n👉 If not logged in, please log in manually in the opened Chrome window.');
    console.log('Waiting for login detection...');

    let isLoggedIn = false;

    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 5000));

        const url = page.url();

        if (url.includes('myaccount.google.com')) {
            isLoggedIn = true;
            break;
        }
    }

    if (!isLoggedIn) {
        console.log('\n❌ Login not detected.');
        process.exit(1);
    }

    console.log('\n✅ Login detected! Saving cookies...');

    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    const jsonStr = JSON.stringify(cookies);
    const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64');

    fs.writeFileSync('cookies.base64.txt', base64Str, 'utf8');

    console.log('\n✅ Cookies saved to cookies.base64.txt');
    console.log('📋 Copy it into GitHub Secret GOOGLE_COOKIES');

    console.log('\n🎉 Done!');
}

saveCookies().catch(console.error);