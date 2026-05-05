# CNC WhatsApp Bot — Setup Guide (Z840 Server)

## Kya karta hai yeh system:

### Payments Group:
- Client payment screenshot aaye → AI se naam + amount extract kare
- Group mein confirm kare ✅
- Muddasir + Awais ko WhatsApp alert bheje

### CS INVOICES APPROVAL Group:
- Invoice PDF aaye → AI se discount check kare
- Discount < 20% → Auto approve + bosses ko alert
- Discount >= 20% → Bosses ko approval request bheje
- Boss "APPROVE SI-CNC-152" ya "REJECT SI-CNC-152" reply kare
- Group mein result post kare

---

## Z840 PC pe Setup — Step by Step

### Step 1 — Node.js Install Karo
1. https://nodejs.org/en/download pe jao
2. Windows version download karo (LTS)
3. Install karo — Next Next Finish

### Step 2 — Bot Files Copy Karo
1. Yeh folder Z840 pe kisi jagah rakho — jaise:
   `C:\CNC-Bot\`

2. In teen files rakho us folder mein:
   - `index.js`
   - `package.json`
   - `.env`

### Step 3 — .env File Mein API Key Daalo
`.env` file kholo Notepad se aur yeh line mein actual key daalo:
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxx
```
(Anthropic Console se milegi: https://console.anthropic.com)

### Step 4 — Dependencies Install Karo
Command Prompt kholo aur yeh type karo:
```
cd C:\CNC-Bot
npm install
```
(Internet se packages download honge — 2-3 minutes lagenge)

### Step 5 — Bot Chalaao
```
node index.js
```

### Step 6 — QR Code Scan Karo
- Terminal mein QR code dikhega
- Apne phone (+92 321 7198443) pe WhatsApp kholo
- Linked Devices → Link a Device → QR scan karo

### Step 7 — Confirm
Terminal mein dikhega:
```
✅ CNC WhatsApp Bot is LIVE and running!
```

---

## 24/7 Chalne ke liye PM2 Setup

### PM2 Install Karo:
```
npm install -g pm2
```

### Bot PM2 se Start Karo:
```
cd C:\CNC-Bot
pm2 start index.js --name cnc-bot
pm2 save
pm2 startup
```

Ab bot Windows restart hone pe bhi khud start hoga.

### Useful Commands:
```
pm2 status          # bot ka status
pm2 logs cnc-bot    # logs dekho
pm2 restart cnc-bot # restart karo
pm2 stop cnc-bot    # stop karo
```

---

## Boss ka Approval Flow:

Jab 20%+ discount wali invoice aaye — boss ko WhatsApp aayega:
```
⚠️ Invoice Approval Required
Client: Mr. Irfan
Invoice #: SI-CNC-152
Amount: Rs. 18,550
Discount: 25% ⚠️

Reply karein:
✅ APPROVE SI-CNC-152
❌ REJECT SI-CNC-152
```

Boss simply reply kare:
```
APPROVE SI-CNC-152
```
Ya:
```
REJECT SI-CNC-152
```

System automatically group mein post kar dega.

---

## Koi Problem Ho To:

1. `.wwebjs_auth` folder delete karo → dobara QR scan karo
2. Logs dekho: `pm2 logs cnc-bot`
3. Restart karo: `pm2 restart cnc-bot`
