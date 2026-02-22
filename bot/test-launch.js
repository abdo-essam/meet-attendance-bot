var puppeteer = require('puppeteer-core');
var fs = require('fs');

async function test() {
    // Try different Chrome paths
    var paths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.CHROME_PATH || ''
    ];

    var chromePath = null;
    for (var p of paths) {
        if (p && fs.existsSync(p)) {
            chromePath = p;
            break;
        }
    }

    if (!chromePath) {
        console.log('No Chrome found! Trying without executablePath...');
        // Try using puppeteer (full) instead
        try {
            var pup = require('puppeteer');
            chromePath = pup.executablePath();
            console.log('Puppeteer Chrome: ' + chromePath);
        } catch (e) {
            console.log('Install puppeteer: npm install puppeteer');
            process.exit(1);
        }
    }

    console.log('Using Chrome: ' + chromePath);

    var browser = await puppeteer.launch({
        headless: 'new',
        executablePath: chromePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        defaultViewport: { width: 1280, height: 720 }
    });

    console.log('✅ Browser launched!');

    var page = await browser.newPage();
    await page.goto('https://www.google.com');
    console.log('✅ Google loaded: ' + page.url());

    await browser.close();
    console.log('✅ Test passed!');
}

test().catch(e => { console.error('❌', e.message); process.exit(1); });