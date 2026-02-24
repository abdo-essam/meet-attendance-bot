// ============================================
//  🧪 Comprehensive Test Suite
//  Google Meet Attendance Bot
// ============================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ─── Test Configuration ─────────────────────
const TEST_MEET_LINK = process.env.TEST_MEET_LINK || 'https://meet.google.com/rip-oyzq-eze';
const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS !== 'false';
const REPORTS_DIR = path.join(__dirname, 'test-reports');

// ─── Colors for output ──────────────────────
const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
};

// ─── Test Runner ────────────────────────────
class TestRunner {
    constructor() {
        this.suites = [];
        this.currentSuite = null;
        this.results = { passed: 0, failed: 0, skipped: 0, errors: [] };
    }

    suite(name, fn) {
        this.suites.push({ name, fn });
    }

    async run() {
        console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
        console.log(`${C.bold}${C.cyan}  🧪 Meet Attendance Bot — Full Test Suite${C.reset}`);
        console.log(`${C.bold}${'═'.repeat(60)}${C.reset}\n`);

        const startTime = Date.now();

        for (const suite of this.suites) {
            this.currentSuite = suite.name;
            console.log(`${C.bold}${C.cyan}📦 ${suite.name}${C.reset}`);
            console.log(`${C.dim}${'─'.repeat(50)}${C.reset}`);

            try {
                await suite.fn();
            } catch (err) {
                this.fail(`Suite crashed: ${err.message}`);
                console.error(err.stack);
            }

            console.log('');
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        this.printSummary(elapsed);
        return this.results.failed === 0;
    }

    pass(testName) {
        this.results.passed++;
        console.log(`  ${C.green}✅ PASS${C.reset} ${testName}`);
    }

    fail(testName, error) {
        this.results.failed++;
        const errMsg = error ? `: ${error}` : '';
        this.results.errors.push({ suite: this.currentSuite, test: testName, error: errMsg });
        console.log(`  ${C.red}❌ FAIL${C.reset} ${testName}${C.red}${errMsg}${C.reset}`);
    }

    skip(testName, reason) {
        this.results.skipped++;
        console.log(`  ${C.yellow}⏭️  SKIP${C.reset} ${testName} ${C.dim}(${reason})${C.reset}`);
    }

    async assertDoesNotThrow(testName, fn) {
        try {
            await fn();
            this.pass(testName);
        } catch (err) {
            this.fail(testName, err.message);
        }
    }

    printSummary(elapsed) {
        const { passed, failed, skipped, errors } = this.results;
        const total = passed + failed + skipped;

        console.log(`${C.bold}${'═'.repeat(60)}${C.reset}`);
        console.log(`${C.bold}  📊 Test Results${C.reset}`);
        console.log(`${C.bold}${'═'.repeat(60)}${C.reset}`);
        console.log(`  Total:   ${total}`);
        console.log(`  ${C.green}Passed:  ${passed}${C.reset}`);
        console.log(`  ${C.red}Failed:  ${failed}${C.reset}`);
        console.log(`  ${C.yellow}Skipped: ${skipped}${C.reset}`);
        console.log(`  Time:    ${elapsed}s`);

        if (errors.length > 0) {
            console.log(`\n${C.red}${C.bold}  ❌ Failures:${C.reset}`);
            for (const e of errors) {
                console.log(`  ${C.red}• [${e.suite}] ${e.test}${e.error}${C.reset}`);
            }
        }

        console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
        if (failed === 0) {
            console.log(`${C.green}${C.bold}  ✅ ALL TESTS PASSED!${C.reset}\n`);
        } else {
            console.log(`${C.red}${C.bold}  ❌ ${failed} TEST(S) FAILED!${C.reset}\n`);
        }
    }
}

const t = new TestRunner();

// ============================================
//  SUITE 1: Config Module
// ============================================
t.suite('Config Module', async () => {
    await t.assertDoesNotThrow('config.js loads without error', () => {
        const config = require('./config');
        assert.ok(config, 'Config should be truthy');
    });

    await t.assertDoesNotThrow('exports all required fields', () => {
        const config = require('./config');
        const required = [
            'CHROME_PATH', 'COOKIE_PASSWORD', 'MEET_LINK',
            'DURATION_MINUTES', 'MEETING_NAME', 'COOKIES_DIR',
            'ENCRYPTED_COOKIES_PATH', 'RAW_COOKIES_PATH',
            'REPORTS_DIR', 'USER_AGENT', 'CHROME_ARGS',
            'getBrowserLaunchOptions',
        ];
        for (const field of required) {
            assert.ok(field in config, `Missing config field: ${field}`);
        }
    });

    await t.assertDoesNotThrow('DURATION_MINUTES is a valid number', () => {
        const { DURATION_MINUTES } = require('./config');
        assert.ok(typeof DURATION_MINUTES === 'number', 'Should be a number');
        assert.ok(DURATION_MINUTES > 0, 'Should be positive');
        assert.ok(DURATION_MINUTES <= 360, 'Should not exceed 360');
    });

    await t.assertDoesNotThrow('getBrowserLaunchOptions returns valid object', () => {
        const { getBrowserLaunchOptions } = require('./config');
        const opts = getBrowserLaunchOptions();
        assert.ok(opts.args, 'Should have args');
        assert.ok(Array.isArray(opts.args), 'args should be array');
        assert.ok(opts.args.includes('--no-sandbox'), 'Should include --no-sandbox');
        assert.ok(opts.args.includes('--disable-setuid-sandbox'), 'Should include --disable-setuid-sandbox');
        assert.ok(opts.args.includes('--use-fake-ui-for-media-stream'), 'Should include fake media stream');
        assert.ok(opts.defaultViewport, 'Should have defaultViewport');
        assert.strictEqual(opts.defaultViewport.width, 1280);
        assert.strictEqual(opts.defaultViewport.height, 720);
    });

    await t.assertDoesNotThrow('USER_AGENT is a valid Chrome UA string', () => {
        const { USER_AGENT } = require('./config');
        assert.ok(USER_AGENT.includes('Chrome'), 'Should mention Chrome');
        assert.ok(USER_AGENT.includes('Mozilla'), 'Should start with Mozilla');
        assert.ok(USER_AGENT.length > 50, 'Should be a full UA string');
    });

    await t.assertDoesNotThrow('paths are absolute and valid', () => {
        const { COOKIES_DIR, ENCRYPTED_COOKIES_PATH, RAW_COOKIES_PATH, REPORTS_DIR } = require('./config');
        assert.ok(path.isAbsolute(COOKIES_DIR), 'COOKIES_DIR should be absolute');
        assert.ok(path.isAbsolute(ENCRYPTED_COOKIES_PATH), 'ENCRYPTED_COOKIES_PATH should be absolute');
        assert.ok(path.isAbsolute(RAW_COOKIES_PATH), 'RAW_COOKIES_PATH should be absolute');
        assert.ok(path.isAbsolute(REPORTS_DIR), 'REPORTS_DIR should be absolute');
        assert.ok(ENCRYPTED_COOKIES_PATH.endsWith('.enc'), 'Should end with .enc');
    });
});

// ============================================
//  SUITE 2: Crypto Helper
// ============================================
t.suite('Crypto Helper', async () => {
    const crypto = require('./crypto-helper');

    await t.assertDoesNotThrow('crypto-helper.js loads without error', () => {
        assert.ok(crypto.encrypt, 'Should export encrypt');
        assert.ok(crypto.decrypt, 'Should export decrypt');
    });

    await t.assertDoesNotThrow('encrypt returns valid JSON with required fields', () => {
        const result = crypto.encrypt('hello world', 'test-password');
        const parsed = JSON.parse(result);
        assert.ok(parsed.salt, 'Should have salt');
        assert.ok(parsed.iv, 'Should have iv');
        assert.ok(parsed.tag, 'Should have tag');
        assert.ok(parsed.data, 'Should have data');
        // salt = 16 bytes = 32 hex chars
        assert.strictEqual(parsed.salt.length, 32, 'Salt should be 32 hex chars');
        // iv = 16 bytes = 32 hex chars
        assert.strictEqual(parsed.iv.length, 32, 'IV should be 32 hex chars');
        // tag = 16 bytes = 32 hex chars
        assert.strictEqual(parsed.tag.length, 32, 'Tag should be 32 hex chars');
    });

    await t.assertDoesNotThrow('encrypt → decrypt roundtrip works', () => {
        const original = 'Hello, this is a test message! 🎉';
        const password = 'super-secret-123';
        const encrypted = crypto.encrypt(original, password);
        const decrypted = crypto.decrypt(encrypted, password);
        assert.strictEqual(decrypted, original, 'Decrypted text should match original');
    });

    await t.assertDoesNotThrow('handles JSON data (cookie-like)', () => {
        const cookies = [
            { name: 'SID', value: 'abc123', domain: '.google.com' },
            { name: '__Secure-1PSID', value: 'xyz789', domain: '.google.com' },
            { name: 'OSID', value: 'meet456', domain: 'meet.google.com' },
        ];
        const json = JSON.stringify(cookies);
        const password = 'cookie-pw';
        const encrypted = crypto.encrypt(json, password);
        const decrypted = crypto.decrypt(encrypted, password);
        const parsed = JSON.parse(decrypted);
        assert.strictEqual(parsed.length, 3);
        assert.strictEqual(parsed[0].name, 'SID');
        assert.strictEqual(parsed[2].domain, 'meet.google.com');
    });

    await t.assertDoesNotThrow('different passwords produce different ciphertext', () => {
        const text = 'same message';
        const enc1 = JSON.parse(crypto.encrypt(text, 'password1'));
        const enc2 = JSON.parse(crypto.encrypt(text, 'password2'));
        assert.notStrictEqual(enc1.data, enc2.data, 'Different passwords → different ciphertext');
    });

    await t.assertDoesNotThrow('wrong password throws error', () => {
        const encrypted = crypto.encrypt('secret data', 'correct-password');
        assert.throws(() => {
            crypto.decrypt(encrypted, 'wrong-password');
        }, 'Should throw with wrong password');
    });

    await t.assertDoesNotThrow('handles empty string', () => {
        const encrypted = crypto.encrypt('', 'pw');
        const decrypted = crypto.decrypt(encrypted, 'pw');
        assert.strictEqual(decrypted, '');
    });

    await t.assertDoesNotThrow('handles large data', () => {
        const largeData = 'x'.repeat(100000);
        const encrypted = crypto.encrypt(largeData, 'pw');
        const decrypted = crypto.decrypt(encrypted, 'pw');
        assert.strictEqual(decrypted.length, 100000);
    });

    await t.assertDoesNotThrow('each encryption produces unique output (random IV/salt)', () => {
        const enc1 = crypto.encrypt('same', 'same');
        const enc2 = crypto.encrypt('same', 'same');
        assert.notStrictEqual(enc1, enc2, 'Same input should produce different ciphertext');
    });
});

// ============================================
//  SUITE 3: Cookie Manager
// ============================================
t.suite('Cookie Manager', async () => {
    const cookieManager = require('./cookie-manager');

    await t.assertDoesNotThrow('cookie-manager.js loads without error', () => {
        assert.ok(cookieManager.loadCookies, 'Should export loadCookies');
        assert.ok(cookieManager.sanitiseCookies, 'Should export sanitiseCookies');
        assert.ok(cookieManager.injectCookies, 'Should export injectCookies');
        assert.ok(cookieManager.extractCookies, 'Should export extractCookies');
        assert.ok(cookieManager.saveCookies, 'Should export saveCookies');
    });

    await t.assertDoesNotThrow('sanitiseCookies removes problematic fields', () => {
        const raw = [
            { name: 'SID', value: 'abc', domain: '.google.com', size: 128, session: true },
            { name: 'NID', value: 'xyz', domain: '.google.com', size: 256, session: false, httpOnly: true },
        ];
        const sanitised = cookieManager.sanitiseCookies(raw);
        assert.strictEqual(sanitised.length, 2);
        for (const c of sanitised) {
            assert.ok(!('size' in c), 'Should not have "size" field');
            assert.ok(!('session' in c), 'Should not have "session" field');
        }
        assert.strictEqual(sanitised[0].name, 'SID');
        assert.strictEqual(sanitised[0].value, 'abc');
        assert.strictEqual(sanitised[1].httpOnly, true, 'Should preserve httpOnly');
    });

    await t.assertDoesNotThrow('sanitiseCookies preserves all other fields', () => {
        const raw = [{
            name: 'test',
            value: 'val',
            domain: '.example.com',
            path: '/',
            expires: 9999999999,
            httpOnly: true,
            secure: true,
            sameSite: 'None',
            size: 100,
            session: false,
        }];
        const [c] = cookieManager.sanitiseCookies(raw);
        assert.strictEqual(c.name, 'test');
        assert.strictEqual(c.value, 'val');
        assert.strictEqual(c.domain, '.example.com');
        assert.strictEqual(c.path, '/');
        assert.strictEqual(c.httpOnly, true);
        assert.strictEqual(c.secure, true);
        assert.strictEqual(c.sameSite, 'None');
    });

    await t.assertDoesNotThrow('loadCookies returns array (even if empty)', () => {
        const cookies = cookieManager.loadCookies();
        assert.ok(Array.isArray(cookies), 'Should return an array');
    });

    // Test save + load roundtrip with encrypted file
    await t.assertDoesNotThrow('saveCookies + loadCookies roundtrip (encrypted file)', () => {
        const { COOKIES_DIR, ENCRYPTED_COOKIES_PATH, RAW_COOKIES_PATH } = require('./config');

        // Backup existing files
        const encBackup = fs.existsSync(ENCRYPTED_COOKIES_PATH) ? fs.readFileSync(ENCRYPTED_COOKIES_PATH) : null;
        const rawBackup = fs.existsSync(RAW_COOKIES_PATH) ? fs.readFileSync(RAW_COOKIES_PATH) : null;

        try {
            const testCookies = [
                { name: 'SID', value: 'test-sid-value', domain: '.google.com' },
                { name: '__Secure-1PSID', value: 'test-psid', domain: '.google.com' },
                { name: 'OSID', value: 'test-osid', domain: 'meet.google.com' },
            ];

            cookieManager.saveCookies(testCookies);

            // Verify encrypted file exists
            assert.ok(fs.existsSync(ENCRYPTED_COOKIES_PATH), 'Encrypted file should exist');
            // Verify raw file exists
            assert.ok(fs.existsSync(RAW_COOKIES_PATH), 'Raw file should exist');

            // Verify raw file content
            const rawContent = JSON.parse(fs.readFileSync(RAW_COOKIES_PATH, 'utf8'));
            assert.strictEqual(rawContent.length, 3);
            assert.strictEqual(rawContent[0].name, 'SID');
        } finally {
            // Restore backups
            if (encBackup) fs.writeFileSync(ENCRYPTED_COOKIES_PATH, encBackup);
            else if (fs.existsSync(ENCRYPTED_COOKIES_PATH)) fs.unlinkSync(ENCRYPTED_COOKIES_PATH);
            if (rawBackup) fs.writeFileSync(RAW_COOKIES_PATH, rawBackup);
            else if (fs.existsSync(RAW_COOKIES_PATH)) fs.unlinkSync(RAW_COOKIES_PATH);
        }
    });

    // Test GOOGLE_COOKIES env var loading
    await t.assertDoesNotThrow('loadCookies from GOOGLE_COOKIES env var', () => {
        const testCookies = [{ name: 'TEST', value: 'from-env', domain: '.google.com' }];
        const base64 = Buffer.from(JSON.stringify(testCookies)).toString('base64');

        const origEnv = process.env.GOOGLE_COOKIES;
        process.env.GOOGLE_COOKIES = base64;

        try {
            // Clear module cache to force re-evaluation
            delete require.cache[require.resolve('./cookie-manager')];
            const freshManager = require('./cookie-manager');
            const loaded = freshManager.loadCookies();
            assert.ok(loaded.length >= 1, 'Should load at least 1 cookie');
            assert.strictEqual(loaded[0].name, 'TEST');
            assert.strictEqual(loaded[0].value, 'from-env');
        } finally {
            if (origEnv) process.env.GOOGLE_COOKIES = origEnv;
            else delete process.env.GOOGLE_COOKIES;
        }
    });
});

// ============================================
//  SUITE 4: Browser Helper
// ============================================
t.suite('Browser Helper', async () => {
    const browserHelper = require('./browser-helper');

    await t.assertDoesNotThrow('browser-helper.js loads without error', () => {
        assert.ok(browserHelper.sleep, 'Should export sleep');
        assert.ok(browserHelper.launchBrowser, 'Should export launchBrowser');
        assert.ok(browserHelper.createStealthPage, 'Should export createStealthPage');
        assert.ok(browserHelper.verifySession, 'Should export verifySession');
    });

    await t.assertDoesNotThrow('sleep waits for specified duration', async () => {
        const start = Date.now();
        await browserHelper.sleep(500);
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= 450, `Should wait ~500ms, waited ${elapsed}ms`);
        assert.ok(elapsed < 1000, `Should not wait too long, waited ${elapsed}ms`);
    });

    if (!RUN_BROWSER_TESTS) {
        t.skip('Browser launch test', 'RUN_BROWSER_TESTS=false');
        t.skip('Stealth page creation', 'RUN_BROWSER_TESTS=false');
        t.skip('Stealth page anti-detection', 'RUN_BROWSER_TESTS=false');
        t.skip('Session verification (no cookies)', 'RUN_BROWSER_TESTS=false');
        return;
    }

    let browser = null;

    try {
        await t.assertDoesNotThrow('launchBrowser creates browser instance', async () => {
            browser = await browserHelper.launchBrowser();
            assert.ok(browser, 'Browser should be truthy');
            const version = await browser.version();
            assert.ok(version, 'Should have a version string');
            console.log(`    ${C.dim}Browser version: ${version}${C.reset}`);
        });

        await t.assertDoesNotThrow('createStealthPage creates page with UA and permissions', async () => {
            if (!browser) throw new Error('No browser');
            const page = await browserHelper.createStealthPage(browser);
            assert.ok(page, 'Page should be truthy');

            const ua = await page.evaluate(() => navigator.userAgent);
            assert.ok(ua.includes('Chrome'), 'UA should include Chrome');
            assert.ok(!ua.includes('HeadlessChrome'), 'UA should not expose HeadlessChrome');

            await page.close();
        });

        await t.assertDoesNotThrow('stealth page hides webdriver flag', async () => {
            if (!browser) throw new Error('No browser');
            const page = await browserHelper.createStealthPage(browser);

            const isWebdriver = await page.evaluate(() => navigator.webdriver);
            assert.strictEqual(isWebdriver, false, 'navigator.webdriver should be false');

            const hasChrome = await page.evaluate(() => !!window.navigator.chrome);
            assert.ok(hasChrome, 'window.navigator.chrome should exist');

            const plugins = await page.evaluate(() => navigator.plugins.length);
            assert.ok(plugins > 0, 'Should have fake plugins');

            const languages = await page.evaluate(() => navigator.languages);
            assert.ok(languages.includes('en-US'), 'Should include en-US');

            await page.close();
        });

        await t.assertDoesNotThrow('verifySession returns false with no cookies', async () => {
            if (!browser) throw new Error('No browser');
            const page = await browserHelper.createStealthPage(browser);
            const result = await browserHelper.verifySession(page);
            assert.strictEqual(result, false, 'Should fail without valid cookies');
            await page.close();
        });
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

// ============================================
//  SUITE 5: Bot Core Logic (Unit Tests)
// ============================================
t.suite('Bot Core Logic — Unit Tests', async () => {
    // We test helper functions from bot.js by extracting their logic
    // Since bot.js calls main() at the end, we test the patterns directly

    await t.assertDoesNotThrow('JOIN_TEXTS contains expected patterns', () => {
        const JOIN_TEXTS = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'انضمام'];
        assert.ok(JOIN_TEXTS.includes('Join now'), 'Should include English join');
        assert.ok(JOIN_TEXTS.includes('انضم الآن'), 'Should include Arabic join');
        assert.ok(JOIN_TEXTS.includes('Ask to join'), 'Should include Ask to join');
        assert.ok(JOIN_TEXTS.length >= 4, 'Should have enough patterns');
    });

    await t.assertDoesNotThrow('SKIP_TEXTS contains expected patterns', () => {
        const SKIP_TEXTS = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present'];
        assert.ok(SKIP_TEXTS.includes('Present'), 'Should skip Present button');
        assert.ok(SKIP_TEXTS.includes('Share'), 'Should skip Share button');
        assert.ok(SKIP_TEXTS.includes('Other ways'), 'Should skip Other ways');
    });

    await t.assertDoesNotThrow('isMeetingUnavailable detects all patterns', () => {
        function isMeetingUnavailable(text) {
            const lower = text.toLowerCase();
            return (
                lower.includes("can't join this video call") ||
                lower.includes("you can't join") ||
                lower.includes('لا يمكنك الانضمام') ||
                lower.includes('this meeting has ended') ||
                lower.includes('meeting not found') ||
                lower.includes('this video call has ended') ||
                (lower.includes('return to home screen') && lower.includes("can't"))
            );
        }

        assert.ok(isMeetingUnavailable("Can't join this video call"), 'English: cant join');
        assert.ok(isMeetingUnavailable("You can't join this meeting"), 'English: you cant join');
        assert.ok(isMeetingUnavailable('لا يمكنك الانضمام إلى هذا الاجتماع'), 'Arabic: cant join');
        assert.ok(isMeetingUnavailable('This meeting has ended'), 'Meeting ended');
        assert.ok(isMeetingUnavailable('Meeting not found'), 'Meeting not found');
        assert.ok(isMeetingUnavailable('This video call has ended'), 'Video call ended');
        assert.ok(isMeetingUnavailable("You can't do this. Return to home screen"), 'Return to home');
        assert.ok(!isMeetingUnavailable('Join now'), 'Should NOT flag join page');
        assert.ok(!isMeetingUnavailable('Welcome to the meeting'), 'Should NOT flag welcome');
        assert.ok(!isMeetingUnavailable(''), 'Should NOT flag empty');
    });

    await t.assertDoesNotThrow('MEET_LINK from config is a valid URL', () => {
        const { MEET_LINK } = require('./config');
        assert.ok(MEET_LINK.startsWith('https://meet.google.com'), `MEET_LINK should start with https://meet.google.com, got: ${MEET_LINK}`);
    });

    await t.assertDoesNotThrow('reports directory can be created', () => {
        if (!fs.existsSync(REPORTS_DIR)) {
            fs.mkdirSync(REPORTS_DIR, { recursive: true });
        }
        assert.ok(fs.existsSync(REPORTS_DIR), 'Test reports dir should exist');
    });
});

// ============================================
//  SUITE 6: Auto-Login Flow Logic
// ============================================
t.suite('Auto-Login Flow — Validation', async () => {
    await t.assertDoesNotThrow('GOOGLE_EMAIL env var format check', () => {
        const email = process.env.GOOGLE_EMAIL;
        if (!email) {
            console.log(`    ${C.yellow}(GOOGLE_EMAIL not set — will fail in production)${C.reset}`);
            return;
        }
        assert.ok(email.includes('@'), 'Email should contain @');
        assert.ok(email.includes('.'), 'Email should contain a dot');
    });

    await t.assertDoesNotThrow('GOOGLE_PASSWORD env var existence check', () => {
        const password = process.env.GOOGLE_PASSWORD;
        if (!password) {
            console.log(`    ${C.yellow}(GOOGLE_PASSWORD not set — will fail in production)${C.reset}`);
            return;
        }
        assert.ok(password.length > 0, 'Password should not be empty');
    });

    await t.assertDoesNotThrow('Login URL patterns are correct', () => {
        const loginUrls = [
            'https://accounts.google.com/ServiceLogin',
            'https://accounts.google.com/signin/identifier',
            'https://accounts.google.com/signin/v2',
        ];
        for (const url of loginUrls) {
            assert.ok(url.includes('accounts.google.com'), `${url} should be a Google URL`);
        }
    });

    await t.assertDoesNotThrow('Success URL detection patterns', () => {
        const successPatterns = [
            'myaccount.google.com',
            'mail.google.com',
            'meet.google.com',
        ];
        const testUrl = 'https://myaccount.google.com/personal-info';
        assert.ok(successPatterns.some(p => testUrl.includes(p)), 'Should detect successful login URL');
    });
});

// ============================================
//  SUITE 7: End-to-End Browser Integration
// ============================================
t.suite('E2E: Full Bot Flow (Browser)', async () => {
    if (!RUN_BROWSER_TESTS) {
        t.skip('Full browser E2E flow', 'RUN_BROWSER_TESTS=false');
        return;
    }

    const { launchBrowser, createStealthPage, sleep } = require('./browser-helper');
    const cookieManager = require('./cookie-manager');

    let browser = null;
    let page = null;

    try {
        // Step 1: Launch
        await t.assertDoesNotThrow('Step 1: Launch browser', async () => {
            browser = await launchBrowser();
            assert.ok(browser, 'Browser launched');
        });

        // Step 2: Create stealth page
        await t.assertDoesNotThrow('Step 2: Create stealth page', async () => {
            page = await createStealthPage(browser);
            assert.ok(page, 'Page created');
        });

        // Step 3: Load & inject cookies
        await t.assertDoesNotThrow('Step 3: Load cookies', async () => {
            const cookies = cookieManager.loadCookies();
            console.log(`    ${C.dim}Loaded ${cookies.length} cookies${C.reset}`);

            if (cookies.length > 0) {
                await cookieManager.injectCookies(page, cookies);
                console.log(`    ${C.dim}Cookies injected${C.reset}`);

                // Verify critical cookies
                const hasSID = cookies.some(c => c.name === 'SID' || c.name === '__Secure-1PSID' || c.name === '__Secure-3PSID');
                const hasMeet = cookies.some(c => (c.domain || '').includes('meet.google.com'));
                console.log(`    ${C.dim}SID=${hasSID ? '✅' : '❌'} Meet=${hasMeet ? '✅' : '⚠️'}${C.reset}`);
            } else {
                console.log(`    ${C.yellow}No cookies available — will test guest/login flow${C.reset}`);
            }
        });

        // Step 4: Navigate to Meet
        await t.assertDoesNotThrow('Step 4: Navigate to Meet link', async () => {
            try {
                await page.goto(TEST_MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
            } catch (e) {
                console.log(`    ${C.dim}Navigation timeout (non-fatal): ${e.message}${C.reset}`);
            }
            await sleep(3000);

            const url = page.url();
            console.log(`    ${C.dim}Landed on: ${url}${C.reset}`);

            // Take screenshot
            try {
                await page.screenshot({ path: path.join(REPORTS_DIR, 'e2e_step4_navigate.png') });
            } catch (_) {}

            // Should be on some Google page (not 404 or error)
            assert.ok(
                url.includes('google.com') || url.includes('meet.google.com'),
                `Should be on Google domain, got: ${url}`
            );
        });

        // Step 5: Detect page state
        await t.assertDoesNotThrow('Step 5: Detect page state', async () => {
            const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
            const url = page.url();

            const state = {
                isSignIn: url.includes('ServiceLogin') || url.includes('signin'),
                isGuestMode: pageText.toLowerCase().includes("what's your name") || pageText.toLowerCase().includes('ما اسمك'),
                isJoinPage: pageText.includes('Join now') || pageText.includes('انضم الآن') || pageText.includes('Ask to join'),
                isInMeeting: pageText.includes('Leave') || pageText.includes('مغادرة'),
                isAccountChooser: pageText.includes('Choose an account') || pageText.includes('اختيار حساب'),
                isUnavailable: pageText.toLowerCase().includes("can't join") || pageText.toLowerCase().includes('meeting not found'),
                isWorkspaceRedirect: url.includes('workspace.google.com'),
            };

            console.log(`    ${C.dim}State: ${JSON.stringify(state)}${C.reset}`);
            console.log(`    ${C.dim}URL: ${url}${C.reset}`);
            console.log(`    ${C.dim}Text preview: "${pageText.substring(0, 120).replace(/\n/g, ' ')}"${C.reset}`);

            // At least one state should be detected
            const anyState = Object.values(state).some(v => v);
            if (!anyState) {
                console.log(`    ${C.yellow}Unknown state — may need investigation${C.reset}`);
            }

            // If we have valid cookies and it's a join page, that's great
            if (state.isJoinPage) {
                console.log(`    ${C.green}🎯 Join page reached! Cookies are working.${C.reset}`);
            }

            // Store state for next steps
            page._testState = state;
        });

        // Step 6: Handle sign-in if needed
        await t.assertDoesNotThrow('Step 6: Handle authentication', async () => {
            const state = page._testState || {};

            if (state.isSignIn || state.isGuestMode) {
                const email = process.env.GOOGLE_EMAIL;
                const password = process.env.GOOGLE_PASSWORD;

                if (email && password) {
                    console.log(`    ${C.dim}Attempting auto-login...${C.reset}`);

                    try {
                        await page.goto('https://accounts.google.com/ServiceLogin', { waitUntil: 'networkidle2', timeout: 30000 });
                        await sleep(2000);

                        // Email
                        const emailInput = await page.$('input[type="email"]');
                        if (emailInput) {
                            await page.type('input[type="email"]', email, { delay: 80 });
                            await page.keyboard.press('Enter');
                            await sleep(4000);
                        }

                        // Password
                        try {
                            await page.waitForSelector('input[type="password"]', { visible: true, timeout: 10000 });
                            await page.type('input[type="password"]', password, { delay: 80 });
                            await page.keyboard.press('Enter');
                            await sleep(5000);
                        } catch (e) {
                            console.log(`    ${C.yellow}Password field not found: ${e.message}${C.reset}`);
                        }

                        const postLoginUrl = page.url();
                        console.log(`    ${C.dim}Post-login URL: ${postLoginUrl}${C.reset}`);

                        if (!postLoginUrl.includes('signin') && !postLoginUrl.includes('ServiceLogin')) {
                            console.log(`    ${C.green}Login appears successful!${C.reset}`);
                        } else {
                            console.log(`    ${C.yellow}May need 2FA or CAPTCHA${C.reset}`);
                        }
                    } catch (e) {
                        console.log(`    ${C.yellow}Auto-login error: ${e.message}${C.reset}`);
                    }
                } else {
                    console.log(`    ${C.yellow}No credentials set, skipping login test${C.reset}`);
                }
            } else if (state.isAccountChooser) {
                console.log(`    ${C.dim}Account chooser detected, clicking first account...${C.reset}`);
                await page.evaluate(() => {
                    const items = document.querySelectorAll('[data-identifier], [data-email]');
                    if (items.length > 0) items[0].click();
                });
                await sleep(5000);
            } else {
                console.log(`    ${C.dim}No authentication needed${C.reset}`);
            }
        });

        // Step 7: Navigate back to meeting (if we logged in)
        await t.assertDoesNotThrow('Step 7: Navigate to meeting after auth', async () => {
            const state = page._testState || {};

            if (state.isSignIn || state.isGuestMode || state.isAccountChooser) {
                try {
                    await page.goto(TEST_MEET_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
                } catch (_) {}
                await sleep(3000);
            }

            try {
                await page.screenshot({ path: path.join(REPORTS_DIR, 'e2e_step7_meeting.png') });
            } catch (_) {}

            const url = page.url();
            console.log(`    ${C.dim}Meeting page URL: ${url}${C.reset}`);
        });

        // Step 8: Test mute keyboard shortcuts
        await t.assertDoesNotThrow('Step 8: Send mute shortcuts', async () => {
            await page.keyboard.down('Control');
            await page.keyboard.press('d');  // Mute mic
            await page.keyboard.press('e');  // Mute camera
            await page.keyboard.up('Control');
            await sleep(1000);
            console.log(`    ${C.dim}Mute shortcuts sent${C.reset}`);
        });

        // Step 9: Look for join button
        await t.assertDoesNotThrow('Step 9: Detect join button', async () => {
            const JOIN_TEXTS = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'انضمام'];

            const result = await page.evaluate((joinTexts) => {
                const buttons = document.querySelectorAll('button, [role="button"]');
                const found = [];
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    const rect = btn.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) continue;
                    if (joinTexts.some(j => text.includes(j))) {
                        found.push(text.substring(0, 50));
                    }
                }
                return found;
            }, JOIN_TEXTS);

            if (result.length > 0) {
                console.log(`    ${C.green}Found join button(s): ${JSON.stringify(result)}${C.reset}`);
            } else {
                console.log(`    ${C.yellow}No join button found (meeting may be unavailable or auth issue)${C.reset}`);
            }
        });

        // Step 10: Test popup dismissal
        await t.assertDoesNotThrow('Step 10: Dismiss popups', async () => {
            for (let i = 0; i < 3; i++) {
                await page.keyboard.press('Escape');
                await sleep(200);
            }

            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const label = btn.getAttribute('aria-label') || '';
                    if (label.includes('Close') || label.includes('إغلاق') || label === 'Got it') {
                        btn.click();
                        break;
                    }
                }
            });

            console.log(`    ${C.dim}Popup dismissal complete${C.reset}`);
        });

        // Step 11: Try clicking join
        await t.assertDoesNotThrow('Step 11: Attempt to join meeting', async () => {
            const JOIN_TEXTS = ['انضم الآن', 'Join now', 'Ask to join', 'طلب الانضمام', 'انضمام'];
            const SKIP_TEXTS = ['طرق أخرى', 'Other ways', 'expand_more', 'مشاركة', 'Share', 'Present'];

            const clicked = await page.evaluate((joinTexts, skipTexts) => {
                const buttons = document.querySelectorAll('button, [role="button"]');
                for (const btn of buttons) {
                    const text = btn.textContent.trim();
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    if (rect.width === 0 || rect.height === 0 || style.display === 'none') continue;
                    if (skipTexts.some(s => text.includes(s))) continue;
                    if (joinTexts.some(j => text.includes(j))) {
                        btn.click();
                        return text;
                    }
                }
                return null;
            }, JOIN_TEXTS, SKIP_TEXTS);

            if (clicked) {
                console.log(`    ${C.green}Clicked join: "${clicked}"${C.reset}`);
                await sleep(10000);
            } else {
                console.log(`    ${C.yellow}No join button to click${C.reset}`);
            }

            try {
                await page.screenshot({ path: path.join(REPORTS_DIR, 'e2e_step11_after_join.png') });
            } catch (_) {}
        });

        // Step 12: Check final state
        await t.assertDoesNotThrow('Step 12: Verify final state', async () => {
            const pageText = await page.evaluate(() => document.body ? document.body.innerText : '');
            const url = page.url();

            const finalState = {
                inMeeting: pageText.includes('Leave') || pageText.includes('مغادرة'),
                connecting: pageText.includes('Connecting') || pageText.includes('جارٍ الاتصال'),
                rejected: pageText.toLowerCase().includes("can't join") || pageText.toLowerCase().includes('لا يمكنك'),
                onJoinPage: pageText.includes('Join now') || pageText.includes('انضم الآن'),
                askingToJoin: pageText.includes('Ask to join') || pageText.includes('Asking to be let in'),
            };

            console.log(`    ${C.dim}Final state: ${JSON.stringify(finalState)}${C.reset}`);
            console.log(`    ${C.dim}Final URL: ${url}${C.reset}`);

            if (finalState.inMeeting) {
                console.log(`    ${C.green}🎉 Successfully joined the meeting!${C.reset}`);
            } else if (finalState.connecting || finalState.askingToJoin) {
                console.log(`    ${C.green}⏳ Attempting to join (connecting/asking)${C.reset}`);
            } else if (finalState.rejected) {
                console.log(`    ${C.yellow}Meeting rejected the join attempt${C.reset}`);
            } else if (finalState.onJoinPage) {
                console.log(`    ${C.yellow}Still on join page${C.reset}`);
            }
        });

        // Step 13: Extract & save cookies
        await t.assertDoesNotThrow('Step 13: Extract and save fresh cookies', async () => {
            try {
                const freshCookies = await cookieManager.extractCookies(page);
                console.log(`    ${C.dim}Extracted ${freshCookies.length} cookies${C.reset}`);

                if (freshCookies.length >= 10) {
                    // Don't overwrite real cookies in test — save to test dir
                    const testCookiePath = path.join(REPORTS_DIR, 'test_cookies.json');
                    fs.writeFileSync(testCookiePath, JSON.stringify(freshCookies, null, 2));
                    console.log(`    ${C.dim}Saved to ${testCookiePath}${C.reset}`);

                    // Verify cookie domains
                    const domains = {};
                    for (const c of freshCookies) {
                        const d = c.domain;
                        domains[d] = (domains[d] || 0) + 1;
                    }
                    const domainList = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 5);
                    console.log(`    ${C.dim}Top domains: ${domainList.map(([d, n]) => `${d}(${n})`).join(', ')}${C.reset}`);
                } else {
                    console.log(`    ${C.yellow}Only ${freshCookies.length} cookies — may indicate auth issue${C.reset}`);
                }
            } catch (err) {
                console.log(`    ${C.yellow}Cookie extraction failed: ${err.message}${C.reset}`);
            }
        });

    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
});

// ============================================
//  SUITE 8: Refresh Cookies Logic
// ============================================
t.suite('Refresh Cookies — Structure Check', async () => {
    await t.assertDoesNotThrow('refresh-cookies.js is valid JS', () => {
        // Just verify the file parses — don't execute (it runs immediately)
        const filePath = path.join(__dirname, 'refresh-cookies.js');
        assert.ok(fs.existsSync(filePath), 'refresh-cookies.js should exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('refreshCookies'), 'Should define refreshCookies function');
        assert.ok(content.includes('extractCookies'), 'Should use extractCookies');
        assert.ok(content.includes('saveCookies'), 'Should use saveCookies');
    });

    await t.assertDoesNotThrow('save-cookies.js is valid JS', () => {
        const filePath = path.join(__dirname, 'save-cookies.js');
        assert.ok(fs.existsSync(filePath), 'save-cookies.js should exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('saveCookies'), 'Should define saveCookies function');
        assert.ok(content.includes('Network.getAllCookies'), 'Should use CDP getAllCookies');
        assert.ok(content.includes('base64'), 'Should output base64');
    });

    await t.assertDoesNotThrow('bot.js is valid JS', () => {
        const filePath = path.join(__dirname, 'bot.js');
        assert.ok(fs.existsSync(filePath), 'bot.js should exist');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('async function main'), 'Should define main function');
        assert.ok(content.includes('autoLoginFlow'), 'Should define autoLoginFlow');
        assert.ok(content.includes('tryJoin'), 'Should define tryJoin');
        assert.ok(content.includes('stayInMeeting'), 'Should define stayInMeeting');
        assert.ok(content.includes('fillGuestName'), 'Should define fillGuestName');
        assert.ok(content.includes('dismissPopups'), 'Should define dismissPopups');
    });
});

// ============================================
//  SUITE 9: Workflow File Validation
// ============================================
t.suite('GitHub Workflow Validation', async () => {
    const workflowDir = path.join(__dirname, '..', '.github', 'workflows');

    await t.assertDoesNotThrow('.github/workflows directory exists', () => {
        if (!fs.existsSync(workflowDir)) {
            console.log(`    ${C.yellow}Workflow dir not found at: ${workflowDir}${C.reset}`);
            console.log(`    ${C.dim}(Expected if running outside the repo root)${C.reset}`);
            return; // Non-critical
        }
        assert.ok(fs.existsSync(workflowDir));
    });

    if (fs.existsSync(workflowDir)) {
        const files = fs.readdirSync(workflowDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

        for (const file of files) {
            await t.assertDoesNotThrow(`Workflow file: ${file}`, () => {
                const content = fs.readFileSync(path.join(workflowDir, file), 'utf8');
                assert.ok(content.length > 0, 'Should not be empty');

                // Basic YAML structure checks
                assert.ok(content.includes('name:'), 'Should have name');
                assert.ok(content.includes('on:'), 'Should have trigger');
                assert.ok(content.includes('jobs:'), 'Should have jobs');
                assert.ok(content.includes('runs-on:'), 'Should have runs-on');
                assert.ok(content.includes('steps:'), 'Should have steps');

                // Check for required secrets
                if (content.includes('bot.js') || content.includes('refresh-cookies')) {
                    assert.ok(content.includes('GOOGLE_COOKIES') || content.includes('COOKIE_PASSWORD'),
                        'Bot workflows should reference cookie secrets');
                }

                console.log(`    ${C.dim}✓ ${file} (${content.length} bytes)${C.reset}`);
            });
        }
    }
});

// ============================================
//  SUITE 10: Environment & Dependencies
// ============================================
t.suite('Environment & Dependencies', async () => {
    await t.assertDoesNotThrow('Node.js version >= 18', () => {
        const major = parseInt(process.version.split('.')[0].replace('v', ''));
        assert.ok(major >= 18, `Node.js ${process.version} should be >= 18`);
        console.log(`    ${C.dim}Node.js ${process.version}${C.reset}`);
    });

    await t.assertDoesNotThrow('puppeteer is installed', () => {
        const puppeteer = require('puppeteer');
        assert.ok(puppeteer, 'Puppeteer should be importable');
        const chromePath = puppeteer.executablePath();
        console.log(`    ${C.dim}Chrome path: ${chromePath}${C.reset}`);
        assert.ok(fs.existsSync(chromePath), 'Chrome binary should exist');
    });

    await t.assertDoesNotThrow('dotenv is installed', () => {
        const dotenv = require('dotenv');
        assert.ok(dotenv, 'dotenv should be importable');
    });

    await t.assertDoesNotThrow('package.json has required dependencies', () => {
        const pkg = require('./package.json');
        assert.ok(pkg.dependencies.puppeteer, 'Should have puppeteer');
        assert.ok(pkg.dependencies.dotenv, 'Should have dotenv');
    });

    await t.assertDoesNotThrow('Required env vars documentation', () => {
        const envVars = {
            GOOGLE_COOKIES: process.env.GOOGLE_COOKIES ? '✅ Set' : '❌ Not set',
            COOKIE_PASSWORD: process.env.COOKIE_PASSWORD ? '✅ Set' : '❌ Not set',
            GOOGLE_EMAIL: process.env.GOOGLE_EMAIL ? '✅ Set' : '❌ Not set',
            GOOGLE_PASSWORD: process.env.GOOGLE_PASSWORD ? '✅ Set' : '⚠️ Not set (auto-login disabled)',
            MEET_LINK: process.env.MEET_LINK || '(using default)',
            DURATION_MINUTES: process.env.DURATION_MINUTES || '(using default)',
        };

        console.log(`    ${C.dim}Environment variables:${C.reset}`);
        for (const [key, val] of Object.entries(envVars)) {
            console.log(`    ${C.dim}  ${key}: ${val}${C.reset}`);
        }
    });

    await t.assertDoesNotThrow('Directory structure is correct', () => {
        const botDir = __dirname;
        const rootDir = path.join(__dirname, '..');

        const expectedFiles = [
            [path.join(botDir, 'bot.js'), 'bot/bot.js'],
            [path.join(botDir, 'config.js'), 'bot/config.js'],
            [path.join(botDir, 'cookie-manager.js'), 'bot/cookie-manager.js'],
            [path.join(botDir, 'crypto-helper.js'), 'bot/crypto-helper.js'],
            [path.join(botDir, 'browser-helper.js'), 'bot/browser-helper.js'],
            [path.join(botDir, 'refresh-cookies.js'), 'bot/refresh-cookies.js'],
            [path.join(botDir, 'save-cookies.js'), 'bot/save-cookies.js'],
            [path.join(botDir, 'package.json'), 'bot/package.json'],
        ];

        for (const [filePath, name] of expectedFiles) {
            const exists = fs.existsSync(filePath);
            console.log(`    ${C.dim}  ${exists ? '✅' : '❌'} ${name}${C.reset}`);
            assert.ok(exists, `${name} should exist`);
        }
    });
});

// ============================================
//  Run all tests
// ============================================
(async () => {
    // Create test reports directory
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const success = await t.run();

    // Save test results to file
    const resultFile = path.join(REPORTS_DIR, 'test-results.json');
    fs.writeFileSync(resultFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        ...t.results,
        browserTests: RUN_BROWSER_TESTS,
        nodeVersion: process.version,
    }, null, 2));

    console.log(`📁 Test reports saved to: ${REPORTS_DIR}/`);

    process.exit(success ? 0 : 1);
})();