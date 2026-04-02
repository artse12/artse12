#!/bin/bash
# ════════════════════════════════════════════════════════════════
# BTC Dual Bot SaaS — Script de despliegue en Hetzner Cloud
# Ubuntu 22.04 LTS
# Uso: bash deploy.sh
# ════════════════════════════════════════════════════════════════

set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  BTC Dual Bot SaaS — Deploy Script    ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"

# ── 1. Sistema ──────────────────────────────────────────────────
echo -e "\n${YELLOW}[1/8] Actualizando sistema...${NC}"
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Docker ───────────────────────────────────────────────────
echo -e "${YELLOW}[2/8] Instalando Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "  Docker ya instalado."
fi

# ── 3. Node.js 20 ───────────────────────────────────────────────
echo -e "${YELLOW}[3/8] Instalando Node.js 20...${NC}"
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "  Node.js $(node -v) ya instalado."
fi

# ── 4. Nginx + Certbot ──────────────────────────────────────────
echo -e "${YELLOW}[4/8] Instalando Nginx + Certbot...${NC}"
apt-get install -y nginx certbot python3-certbot-nginx -qq

# ── 5. Firewall ─────────────────────────────────────────────────
echo -e "${YELLOW}[5/8] Configurando firewall...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── 6. Clonar repo ──────────────────────────────────────────────
echo -e "${YELLOW}[6/8] Configurando proyecto...${NC}"
read -p "  GitHub PAT (para clonar repo privado): " GITHUB_PAT
INSTALL_DIR="/opt/btc-saas"
if [ ! -d "$INSTALL_DIR" ]; then
    git clone "https://artse12:${GITHUB_PAT}@github.com/artse12/btc-dual-bot-bingx.git" \
      "$INSTALL_DIR" --branch main
    cd "$INSTALL_DIR"
    git remote set-url origin https://github.com/artse12/btc-dual-bot-bingx.git
else
    echo "  Directorio ya existe. Actualizando..."
    cd "$INSTALL_DIR" && git pull origin main
fi
cd "$INSTALL_DIR"

# Crear directorios necesarios
mkdir -p data/users logs cache

# ── 7. Variables de entorno ─────────────────────────────────────
echo -e "${YELLOW}[7/8] Generando variables de entorno...${NC}"
if [ ! -f ".env" ]; then
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    SESSION_SECRET=$(openssl rand -hex 32)

    echo ""
    read -p "  Tu email de admin (recibirá permisos de propietario): " ADMIN_EMAIL
    read -p "  API key Anthropic compartida del servidor (opcional, Enter para omitir): " SERVER_ANTHROPIC_KEY
    read -p "  Google Client ID (OAuth, opcional, Enter para omitir): " GOOGLE_CLIENT_ID
    read -p "  Google Client Secret (OAuth, opcional, Enter para omitir): " GOOGLE_CLIENT_SECRET
    echo ""

    cat > .env << EOF
# Generado automáticamente por deploy.sh — $(date)
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production

# SaaS
ADMIN_EMAIL=${ADMIN_EMAIL}
ANTHROPIC_API_KEY=${SERVER_ANTHROPIC_KEY}
CLAUDE_MODEL=claude-sonnet-4-6

# Google OAuth (dejar vacío si no se usa)
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
EOF
    echo -e "${GREEN}  .env generado con claves seguras.${NC}"
    echo -e "${RED}  ⚠ GUARDA ENCRYPTION_KEY: ${ENCRYPTION_KEY}${NC}"
    echo -e "${RED}  ⚠ Si la pierdes, los datos encriptados quedan inutilizables.${NC}"
else
    echo "  .env ya existe, no se sobreescribe."
fi

# ── 8. Build y arrancar ─────────────────────────────────────────
echo -e "${YELLOW}[8/8] Compilando bot y arrancando servicios...${NC}"
npm ci --silent
npm run build

docker compose build --quiet
docker compose up -d saas

# ── SSL (opcional) ──────────────────────────────────────────────
echo ""
read -p "¿Configurar SSL con Let's Encrypt? (s/N): " SETUP_SSL
if [[ "$SETUP_SSL" == "s" || "$SETUP_SSL" == "S" ]]; then
    read -p "Introduce tu dominio (ej: trade.artemlabs.es): " DOMAIN
    if [ -n "$DOMAIN" ]; then
        # Parar y deshabilitar nginx del host (Docker nginx toma los puertos)
        systemctl stop nginx 2>/dev/null || true
        systemctl disable nginx 2>/dev/null || true

        # Obtener certificado con servidor standalone temporal
        certbot certonly --standalone -d "$DOMAIN" \
          --non-interactive --agree-tos -m "admin@$DOMAIN"

        # Actualizar nginx config con el dominio
        sed -i "s/TU_DOMINIO/$DOMAIN/g" nginx/default.conf

        # Arrancar Docker nginx con los certs montados
        docker compose up -d nginx

        echo -e "\n${GREEN}✅ SSL configurado para $DOMAIN${NC}"
        echo -e "${GREEN}   Dashboard: https://$DOMAIN${NC}"
    fi
else
    ufw allow 3000/tcp
    VPS_IP=$(curl -s ifconfig.me)
    echo -e "${YELLOW}  SSL omitido. Dashboard: http://${VPS_IP}:3000${NC}"
fi

# ── Resumen ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deploy completado                   ${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "  Estado:   docker compose ps"
echo -e "  Logs:     docker compose logs -f saas"
echo -e "  Restart:  docker compose restart saas"
echo -e "  Update:   git pull && npm run build && docker compose up -d --build"
