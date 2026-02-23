// ============================================
//  Cookie loading, saving, and CDP helpers
// ============================================

const fs = require('fs');
const cryptoHelper = require('./crypto-helper');
const {
    COOKIE_PASSWORD,
    ENCRYPTED_COOKIES_PATH,
    RAW_COOKIES_PATH,
    COOKIES_DIR,
} = require('./config');

/**
 * Load cookies — priority order:
 * 1. GOOGLE_COOKIES env var (always freshest from secret)
 * 2. Encrypted file (committed by previous run)
 * 3. Raw JSON file (local backup)
 */
function loadCookies() {
    // 1. Environment variable FIRST (this is the GitHub secret — most reliable)
    if (process.env.GOOGLE_COOKIES) {
        try {
            const decoded = Buffer.from(process.env.GOOGLE_COOKIES, 'base64').toString('utf8');
            const cookies = JSON.parse(decoded);
            if (cookies.length > 0) {
                console.log(`✅ Loaded ${cookies.length} cookies from GOOGLE_COOKIES secret`);
                return cookies;
            }
        } catch (err) {
            console.log(`⚠️ Secret cookie load failed: ${err.message}`);
        }
    }

    // 2. Encrypted file (from previous bot run)
    if (fs.existsSync(ENCRYPTED_COOKIES_PATH)) {
        try {
            const raw = fs.readFileSync(ENCRYPTED_COOKIES_PATH, 'utf8');
            const cookies = JSON.parse(cryptoHelper.decrypt(raw, COOKIE_PASSWORD));
            if (cookies.length > 0) {
                console.log(`✅ Loaded ${cookies.length} cookies from encrypted file`);
                return cookies;
            }
        } catch (err) {
            console.log(`⚠️ Encrypted cookie load failed: ${err.message}`);
        }
    }

    // 3. Raw JSON file (local backup)
    if (fs.existsSync(RAW_COOKIES_PATH)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(RAW_COOKIES_PATH, 'utf8'));
            if (cookies.length > 0) {
                console.log(`✅ Loaded ${cookies.length} cookies from cookies.json`);
                return cookies;
            }
        } catch (err) {
            console.log(`⚠️ Raw cookie load failed: ${err.message}`);
        }
    }

    return [];
}

/**
 * Sanitise cookies for CDP — remove fields that cause errors.
 */
function sanitiseCookies(cookies) {
    return cookies.map((c) => {
        const copy = { ...c };
        delete copy.size;
        delete copy.session;
        return copy;
    });
}

/**
 * Inject cookies into the page via CDP (with page.setCookie fallback).
 */
async function injectCookies(page, cookies) {
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.setCookies', { cookies: sanitiseCookies(cookies) });
        console.log('✅ Cookies injected via CDP');
    } catch (err) {
        try {
            await page.setCookie(...cookies);
            console.log('✅ Cookies injected via page.setCookie');
        } catch (fallbackErr) {
            console.log(`⚠️ Cookie injection failed: ${fallbackErr.message}`);
        }
    }
}

/**
 * Extract all cookies from the browser via CDP.
 */
async function extractCookies(page) {
    const client = await page.target().createCDPSession();
    const { cookies } = await client.send('Network.getAllCookies');
    return cookies;
}

/**
 * Save cookies to encrypted file and raw JSON.
 */
function saveCookies(cookies) {
    if (!fs.existsSync(COOKIES_DIR)) {
        fs.mkdirSync(COOKIES_DIR, { recursive: true });
    }

    try {
        const encrypted = cryptoHelper.encrypt(JSON.stringify(cookies), COOKIE_PASSWORD);
        fs.writeFileSync(ENCRYPTED_COOKIES_PATH, encrypted);
        console.log('🔒 Encrypted cookies saved');
    } catch (err) {
        console.log(`⚠️ Failed to save encrypted cookies: ${err.message}`);
    }

    try {
        fs.writeFileSync(RAW_COOKIES_PATH, JSON.stringify(cookies));
        console.log('📄 Raw cookies saved');
    } catch (err) {
        console.log(`⚠️ Failed to save raw cookies: ${err.message}`);
    }
}

module.exports = {
    loadCookies,
    sanitiseCookies,
    injectCookies,
    extractCookies,
    saveCookies,
};