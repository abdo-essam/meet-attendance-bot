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

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
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

    for (let i = 0; i < 180; i++) {
        await sleep(5000);

        try {
            const currentPages = await browser.pages();

            for (let p of currentPages) {
                let url;
                try {
                    url = p.url();
                } catch (e) {
                    continue;
                }

                console.log(`[Check ${i + 1}] Tab: ${url}`);

                if (
                    url.includes('myaccount.google.com') ||
                    url.includes('accounts.google.com/SignOutOptions') ||
                    url.includes('google.com/account/about') ||
                    url.includes('ManageAccount')
                ) {
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
    // CRITICAL: We must visit meet.google.com while logged in AND interact with it
    console.log('🌐 Visiting Google services to collect all cookies...');

    const servicesToVisit = [
        ['Google Account', 'https://myaccount.google.com/'],
        ['Gmail', 'https://mail.google.com/'],
        ['Google Meet (main)', 'https://meet.google.com/'],
        ['Google', 'https://www.google.com/'],
        ['YouTube', 'https://www.youtube.com/'],
    ];

    for (const [name, serviceUrl] of servicesToVisit) {
        try {
            console.log(`  → Visiting ${name}: ${serviceUrl}`);
            await targetPage.goto(serviceUrl, {
                waitUntil: 'networkidle2',
                timeout: 25000
            });
            await sleep(4000);

            // For Meet, verify we see the authenticated version
            if (serviceUrl.includes('meet.google.com')) {
                const meetUrl = targetPage.url();
                const meetText = await targetPage.evaluate(() => document.body ? document.body.innerText.substring(0, 300) : '');
                console.log(`  📍 Meet URL: ${meetUrl}`);

                if (meetText.includes('تسجيل الدخول') || meetText.includes('Sign in')) {
                    console.log('  ⚠️ WARNING: NOT logged into Meet! Trying to join a test meeting...');
                    // Navigate to a dummy meet URL to trigger auth
                    try {
                        await targetPage.goto('https://meet.google.com/landing', {
                            waitUntil: 'networkidle2',
                            timeout: 15000
                        });
                        await sleep(3000);
                    } catch (_) {}
                } else {
                    console.log('  ✅ Meet shows authenticated view');
                }

                // Also visit meet with /new to trigger more cookies
                try {
                    await targetPage.goto('https://meet.google.com/new', {
                        waitUntil: 'networkidle2',
                        timeout: 15000
                    });
                    await sleep(3000);
                } catch (_) {}
            }
        } catch (e) {
            console.log(`  ⚠️ Could not visit ${serviceUrl}: ${e.message}`);
        }
    }

    // ─── Go back to Meet one more time to ensure cookies are set ───
    console.log('  → Final Meet visit...');
    try {
        await targetPage.goto('https://meet.google.com/', {
            waitUntil: 'networkidle2',
            timeout: 15000
        });
        await sleep(3000);

        const finalMeetText = await targetPage.evaluate(() => document.body ? document.body.innerText.substring(0, 200) : '');
        if (finalMeetText.includes('New meeting') || finalMeetText.includes('اجتماع جديد') ||
            finalMeetText.includes('Enter a code') || finalMeetText.includes('إدخال الرمز')) {
            console.log('  ✅ Meet is authenticated!');
        } else {
            console.log('  ⚠️ Meet may not be fully authenticated. Check manually.');
            console.log(`  Text: ${finalMeetText.substring(0, 100)}`);
        }
    } catch (_) {}

    // ─── Extract ALL cookies via CDP ───
    const client = await targetPage.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');

    console.log(`\n📊 Extracted ${cookies.length} cookies`);

    // Show cookie domains for debugging
    const domains = {};
    for (const c of cookies) {
        const d = c.domain;
        domains[d] = (domains[d] || 0) + 1;
    }
    console.log('\n📋 Cookie domains:');
    for (const [domain, count] of Object.entries(domains).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${domain}: ${count} cookies`);
    }

    // Check for critical cookies
    const hasMeetCookies = cookies.some(c => c.domain.includes('meet.google.com'));
    const hasGoogleCookies = cookies.some(c => c.domain.includes('.google.com'));
    const hasSID = cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID');

    console.log(`\n🔍 Critical cookie check:`);
    console.log(`  meet.google.com cookies: ${hasMeetCookies ? '✅' : '❌ MISSING!'}`);
    console.log(`  .google.com cookies: ${hasGoogleCookies ? '✅' : '❌ MISSING!'}`);
    console.log(`  SID/PSID cookies: ${hasSID ? '✅' : '❌ MISSING!'}`);

    if (!hasSID) {
        console.log('\n⚠️ WARNING: Missing critical session cookies! Login may not be complete.');
    }

    if (cookies.length < 10) {
        console.log('⚠️ WARNING: Very few cookies extracted.');
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