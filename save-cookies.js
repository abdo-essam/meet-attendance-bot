const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function saveCookies() {
  console.log('=' .repeat(50));
  console.log('🚀 Step 1: Login & Save Cookies');
  console.log('=' .repeat(50));
  console.log('\nOpening Chrome...');
  console.log('👉 Please log in to your Google Account.');
  console.log('Waiting for you to finish logging in...');

  // Launch non-headless browser so user can login
  let browser;
  try {
      browser = await puppeteer.launch({
        headless: false,
        // You might need to change executablePath depending on your OS
        executablePath: process.platform === 'win32'
            ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            : (process.platform === 'darwin'
                ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
                : '/usr/bin/chromium-browser'),
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
  } catch (err) {
      console.log('⚠️ Could not find Chrome/Chromium installation.');
      console.log('Please make sure Chrome is installed or update executablePath in save-cookies.js.');
      process.exit(1);
  }

  const page = await browser.newPage();
  
  // Go to Google login page
  await page.goto('https://accounts.google.com/', { waitUntil: 'networkidle2' });

  // Wait for the user to reach a Google endpoint indicating they logged in, or ask them to press Enter in console
  console.log('\n⚠️ Once you have successfully logged in and can see your Google Account dashboard,');
  console.log('the script will detect it and save your cookies automatically within 5-10 seconds.');

  // Polling to wait until URL indicates successful sign-in
  let isLoggedIn = false;
  for (let i = 0; i < 60; i++) { // wait up to 5 minutes (60 * 5 sec)
    await new Promise(r => setTimeout(r, 5000));
    try {
        const url = page.url();
        if (url.includes('myaccount') || url.includes('accounts.google.com/ManageAccount')) {
            isLoggedIn = true;
            break;
        }
    } catch(e) { /* page might be closed */ break; }
  }

  if (!isLoggedIn) {
      console.log('\n❌ Login timed out or you closed the browser.');
      console.log('Please try again.');
      await browser.close();
      process.exit(1);
  }

  console.log('\n✅ Login detected! Saving cookies...');

  // Extract cookies for google.com
  const freshCookies = await page.cookies(
    'https://accounts.google.com',
    'https://meet.google.com',
    'https://www.google.com'
  );

  // Save base64 string
  const jsonStr = JSON.stringify(freshCookies);
  const base64Str = Buffer.from(jsonStr, 'utf8').toString('base64');

  fs.writeFileSync('cookies.base64.txt', base64Str, 'utf8');

  console.log('\n✅ Cookies saved successfully to cookies.base64.txt');
  console.log('📋 Now, copy the contents of cookies.base64.txt and paste it into');
  console.log('   your GitHub Secret named: GOOGLE_COOKIES');
  
  await browser.close();
}

saveCookies().catch(console.error);
