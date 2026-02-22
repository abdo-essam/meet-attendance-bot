// ============================================
//  Quick test — verify Chrome can launch
// ============================================

const { launchBrowser } = require('./browser-helper');

async function test() {
    const browser = await launchBrowser({ minimal: true });
    console.log('✅ Browser launched!');

    const page = await browser.newPage();
    await page.goto('https://www.google.com');
    console.log(`✅ Google loaded: ${page.url()}`);

    await browser.close();
    console.log('✅ Test passed!');
}

test().catch((err) => {
    console.error('❌', err.message);
    process.exit(1);
});