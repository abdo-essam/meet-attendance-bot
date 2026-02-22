// ============================================
//  Shared configuration for the Meet Bot
// ============================================

const path = require('path');

const CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/google-chrome-stable';
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
    '--disable-features=Crashpad,OptimizationGuideModelDownloading',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--noerrdialogs',
    '--disable-component-update',
];

const CHROME_ARGS_MINIMAL = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,720',
    '--disable-features=Crashpad,OptimizationGuideModelDownloading',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--noerrdialogs',
    '--disable-component-update',
];

function getBrowserLaunchOptions({ minimal = false } = {}) {
    return {
        headless: 'new',
        executablePath: CHROME_PATH,
        args: minimal ? CHROME_ARGS_MINIMAL : CHROME_ARGS,
        defaultViewport: { width: 1280, height: 720 },
        protocolTimeout: 120000,
        ignoreDefaultArgs: ['--enable-automation'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        env: {
            ...process.env,
            CHROME_CRASHPAD_PIPE_NAME: 'none',
            BREAKPAD_DUMP_LOCATION: '/tmp',
            CHROME_LOG_FILE: '/dev/null',
        },
    };
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
