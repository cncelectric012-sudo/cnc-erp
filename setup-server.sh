#!/bin/bash
# CNC Bot — Oracle Cloud Ubuntu Server Setup Script
# Run as root: bash setup-server.sh

set -e
echo "=== CNC Bot Server Setup ==="

# 1. Update system
apt-get update -y && apt-get upgrade -y

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 3. Install Google Chrome
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb
echo "Chrome: $(google-chrome-stable --version)"

# 4. Install PM2
npm install -g pm2

# 5. Install git
apt-get install -y git

echo ""
echo "=== Setup complete! ==="
echo "Next steps:"
echo "  git clone https://github.com/cncelectric012-sudo/cnc-erp.git"
echo "  cd cnc-erp"
echo "  npm install"
echo "  cp .env.example .env && nano .env   (fill in your keys)"
echo "  pm2 start index.js --name cnc-bot"
echo "  pm2 save && pm2 startup"
