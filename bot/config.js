// ============================================
//  Shared configuration for the Meet Bot
// ============================================

const path = require('path');

// CHROME_PATH is optional — if not set, puppeteer uses its bundled Chrome
const CHROME_PATH = process.env.CHROME_PATH || '';
const COOKIE_PASSWORD = process.env.COOKIE_PASSWORD || 'default-password';
const MEET_LINK = process.env.MEET_LINK || 'https://meet.google.com/';
const DURATION_MINUTES = parseInt(process.env.DURATION_MINUTES || '120', 10);
const MEETING_NAME = process.env.MEETING_NAME || '';

const COOKIES_DIR = path.join(__dirname, '..', 'cookies');
const ENCRYPTED_COOKIES_PATH = path.join(COOKIES_DIR, 'session.enc');
const RAW_COOKIES_PATH = path.join(__dirname, 'cookies.json');
const REPORTS_DIR = path.join(__dirname, 'reports');

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CHROME_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-accept-camera-and-microphone-capture',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,720',
];

const CHROME_ARGS_MINIMAL = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,720',
];

function getBrowserLaunchOptions() {
    // ONLY the 3 args proven to work in CI (identical to verify step)
    const options = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-blink-features=AutomationControlled',
            '--disable-popup-blocking',
            '--window-size=1280,720',
        ],
        defaultViewport: { width: 1280, height: 720 },
        protocolTimeout: 120000,
    };

    // Only set executablePath if explicitly provided
    if (CHROME_PATH) {
        options.executablePath = CHROME_PATH;
    }

    return options;
}

module.exports = {
    CHROME_PATH,
    COOKIE_PASSWORD,
    MEET_LINK,
    DURATION_MINUTES,
    MEETING_NAME,
    COOKIES_DIR,
    ENCRYPTED_COOKIES_PATH,
    RAW_COOKIES_PATH,
    REPORTS_DIR,
    USER_AGENT,
    CHROME_ARGS,
    getBrowserLaunchOptions,
};
