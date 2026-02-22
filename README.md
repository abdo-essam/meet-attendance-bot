# 🤖 Meet Attendance Bot

![GitHub Action: Attend Meeting](https://img.shields.io/badge/GitHub%20Actions-Attend%20Meeting-blue?logo=githubactions)
![GitHub Action: Keepalive](https://img.shields.io/badge/GitHub%20Actions-Keepalive-green?logo=githubactions)

An automated tool that uses **Puppeteer** on **GitHub Actions** to automatically join Google Meet sessions, stay for a defined duration, take regular screenshots, and generate attendance reports. 

Most importantly, it features an **intelligent Cookie Auto-Refresh System**! The bot encrypts and saves updated session cookies directly back to your repository so your Google login almost never expires.

---

## ✨ Features
- **Fully Automated Attendance:** Runs silently on GitHub infrastructure.
- **Dynamic Keepalive:** Visits Google every day to refresh your session cookies.
- **Military-Grade Cookie Security:** Uses AES-256-GCM to ensure your cookies are securely encrypted before being committed to your public or private repo.
- **Triple Fallback Cookie System:** 
  1. `cookies/session.enc` (Freshest, in repo)
  2. `bot/cookies.json` (Local backup)
  3. `GOOGLE_COOKIES` secret (Initial fallback)
- **Zero Maintenance Architecture:** Setup once. Let the Keepalive workflow prevent session expiration. 
- **Notification Integration:** Configurable email failure alerts via GitHub to inform you if manual re-login is required (rarely happens, every 2-3 months).

---

## 🛠️ Complete Setup Checklist

### On YOUR PC (One-time Setup)
1. **Install Node.js** on your machine.
2. Clone this repository and open your terminal.
3. Run `node save-cookies.js`.
4. Log in to your Google Account (e.g., your `@eui.edu.eg` account) in the Chrome window that opens.
5. The script will automatically detect successful login and save your secure cookie string to a file named `cookies.base64.txt`.

### On GitHub Projects Settings
1. Create a repository on GitHub (PUBLIC or PRIVATE) and push this code.
2. Go to **Settings → Secrets and variables → Actions**.
3. Add the following **3 secrets**:

| Secret Name | Details / Value |
|-------------|-----------------|
| `GOOGLE_COOKIES`| Paste the *entire* contents of your newly generated `cookies.base64.txt`. |
| `MEET_LINK` | The default Google Meet URL (e.g. `https://meet.google.com/wjf-fkuv-ivp`). |
| `COOKIE_PASSWORD`| Make up a strong password (e.g., `MySecretKey2026!AttendanceBot`). This encrypts your cookies before they are saved to the repo! |

### Configuration
1. Open `.github/workflows/attend-meeting.yml`
2. Edit the **cron schedule** to match your classes. (Times are in UTC by default; 9:00 AM Egypt = 7:00 AM UTC).
3. Push the changes.

---

## 📅 Timeline & Flow Details

### How Auto-Refresh Works
Your cookies refresh **EVERY DAY** so they almost never expire!

**Day 1 (Monday):**
- **3:00 AM** → 🔄 Keepalive runs → Loads cookies → Visits Google, Meet, Gmail → Saves fresh cookies ✅ → Commits to repo
- **9:00 AM** → 📊 Bot joins meeting → Uses fresh cookies → Tracks attendance → Saves report + fresh cookies ✅ → Commits to repo

**Day 2 (Tuesday):**
- **3:00 AM** → 🔄 Keepalive refreshes cookies ✅

... and so on FOREVER ♾️

### What If Cookies STILL Expire?
If Google forces a strict re-login (can happen every 2-3 months):
1. The **Keepalive** job will FAIL and you'll see a ❌ in GitHub Actions.
   - *Tip: Go to your personal GitHub Settings → Notifications → Enable "Failed workflows" to get an email automatically!*
2. To fix it (takes 2 minutes):
   - Run `node save-cookies.js` on your PC.
   - Login again.
   - Update your `GOOGLE_COOKIES` secret in GitHub.

---

## 📂 Project Structure

```text
meet-attendance-bot/
├── .github/
│   └── workflows/
│       ├── attend-meeting.yml    (Main bot workflow)
│       └── keepalive.yml         (Daily cookie refresh workflow)
├── bot/
│   ├── package.json
│   ├── bot.js                    (Core Puppeteer automation & attendance)
│   ├── refresh-cookies.js        (Keepalive script)
│   └── crypto-helper.js          (Encrypts/decrypts cookies)
├── cookies/
│   └── .gitkeep                  (Empty folder to hold your encrypted session tracking)
├── save-cookies.js               (Utility to easily grab standard cookies on PC)
└── README.md                     (This file)
```

---

*Enjoy automated attendance tracking with ZERO worries about expiring cookies!* 🎉
