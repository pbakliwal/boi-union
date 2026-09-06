# Deploying to a VPS

Step-by-step for a fresh Ubuntu 22.04+ server. Run as a sudo-capable user (not
directly as root). Swap `your-domain.com` and the passwords for your own.

## 1. Provision & firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

## 2. Install Node, PostgreSQL, nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update
sudo apt install -y nodejs postgresql nginx certbot python3-certbot-nginx git
```

## 3. Create the database

```bash
sudo -u postgres psql -c "CREATE USER boi_user WITH PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "CREATE DATABASE boi_union OWNER boi_user;"
```

## 4. Create a dedicated system user (no login shell, no home directory writes)

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin boiunion
```

## 5. Deploy the code

```bash
sudo mkdir -p /opt/boi_union
sudo git clone <your-repo-url> /opt/boi_union   # or rsync the folder up
cd /opt/boi_union
sudo -u boiunion npm install
```

## 6. Configure environment

```bash
sudo cp .env.example .env
sudo nano .env
```
Set at minimum:
- `DATABASE_URL=postgres://boi_user:CHANGE_ME@localhost:5432/boi_union`
- `SESSION_SECRET=` output of `openssl rand -hex 32`
- `NODE_ENV=production`
- `PORT=3000`
- `ADMIN_USER` / `ADMIN_PASSWORD` — a real password, not the dev default

```bash
sudo chown boiunion:boiunion .env
sudo chmod 600 .env
```

## 7. Initialize schema, admin, and build the frontend

```bash
cd /opt/boi_union
sudo -u boiunion npm run migrate
sudo -u boiunion npm run setup
sudo -u boiunion npm run build
```

## 8. Run as a systemd service

```bash
sudo cp deploy/boi-union.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now boi-union
sudo systemctl status boi-union   # should show "active (running)"
```

## 9. nginx reverse proxy + HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/boi-union
sudo nano /etc/nginx/sites-available/boi-union   # replace your-domain.com
sudo ln -s /etc/nginx/sites-available/boi-union /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com          # free TLS cert, auto-renews
```
`NODE_ENV=production` makes the app set `Secure` session cookies — login will
only work over `https://` once this step is done.

## 10. Point DNS

Add an `A` record for your domain pointing at the server's IP.

## 11. Load real data

Log in at `https://your-domain.com` and use **Import Salary Register**, or run
on the server:
```bash
cd /opt/boi_union
sudo -u boiunion npm run ingest -- data/your-file.csv --month 4 --year 2026
```

## 12. Backups

```bash
sudo mkdir -p /var/backups/boi_union
sudo crontab -e
```
Add a nightly line:
```
0 2 * * * pg_dump -U boi_user boi_union | gzip > /var/backups/boi_union/$(date +\%F).sql.gz
```

## Redeploying an update later

```bash
cd /opt/boi_union
sudo -u boiunion git pull
sudo -u boiunion npm install
sudo -u boiunion npm run migrate
sudo -u boiunion npm run build
sudo systemctl restart boi-union
```

## Troubleshooting

- `sudo systemctl status boi-union` / `sudo journalctl -u boi-union -f` — app logs
- `sudo nginx -t` — validate nginx config before reloading
- `psql -U boi_user -d boi_union -h localhost` — check the app can actually reach Postgres
  with the credentials in `.env`
