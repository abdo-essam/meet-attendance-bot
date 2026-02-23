const { CHROME_PATH } = require('./config');
const { loadCookies, injectCookies, extractCookies, saveCookies } = require('./cookie-manager');
const { sleep, launchBrowser, createStealthPage } = require('./browser-helper');

const SERVICES = [
    ['Google Account', 'https://myaccount.google.com/'],
    ['Meet', 'https://meet.google.com'],
    ['Gmail', 'https://mail.google.com'],
    ['Google', 'https://www.google.com'],
];

async function refreshCookies() {
    console.log('═'.repeat(50));
    console.log('🔄 Cookie Refresh');
    console.log('═'.repeat(50));

    // ─── Load cookies ───────────────────────────
    const cookies = loadCookies();
    if (cookies.length === 0) {
        console.log('❌ No cookies found!');
        process.exit(1);
    }

    // ─── Launch browser ─────────────────────────
    const browser = await launchBrowser();
    const page = await createStealthPage(browser);

    // ─── Inject cookies ─────────────────────────
    await injectCookies(page, cookies);

    // ─── Check session ──────────────────────────
    console.log('\n🌐 Checking Google Account...');
    try {
        await page.goto('https://myaccount.google.com/', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });
        await sleep(4000);

        const url = page.url();
        console.log(`📍 ${url}`);

        if (url.includes('ServiceLogin') || url.includes('signin')) {
            console.log('❌ Session expired!');
            await browser.close();
            process.exit(1);
        }
        console.log('✅ Session alive!');
    } catch (err) {
        console.log(`⚠️ Session check failed: ${err.message}`);
    }

    // ─── Visit services to refresh cookies ──────
    for (const [name, serviceUrl] of SERVICES) {
        try {
            console.log(`🌐 ${name}`);
            await page.goto(serviceUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(3000);
            console.log('✅');
        } catch (_) {
            console.log('⚠️ Timed out');
        }
    }

    // ─── Extract and save cookies ───────────────
    console.log('\n🍪 Extracting cookies...');
    let freshCookies;
    try {
        freshCookies = await extractCookies(page);
        console.log(`✅ Got ${freshCookies.length} cookies`);
    } catch (err) {
        console.log(`❌ Extraction failed: ${err.message}`);
        await browser.close();
        process.exit(1);
    }

    if (freshCookies.length < 10) {
        console.log('⚠️ Too few cookies — session may be invalid');
        await browser.close();
        process.exit(1);
    }

    saveCookies(freshCookies);

    await browser.close();
    console.log(`\n✅ Done! (${freshCookies.length} cookies)`);
}

refreshCookies().catch((err) => {
    console.error('❌ Cookie refresh error:', err);
    process.exit(1);
});