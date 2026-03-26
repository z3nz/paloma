#!/usr/bin/env bash
#
# railway-django-deploy.sh — Spin up a complete Django backend on Railway
#
# Usage:
#   ./scripts/railway-django-deploy.sh <project-dir> <project-name> [api-domain]
#
# Examples:
#   ./scripts/railway-django-deploy.sh /Users/adam/Projects/verifesto.com verifesto api.verifesto.com
#   ./scripts/railway-django-deploy.sh /Users/adam/Projects/newclient.com newclient api.newclient.com
#
# What it does:
#   1. Creates a Railway project with PostgreSQL
#   2. Sets all required Django env vars
#   3. Deploys the backend
#   4. Runs migrations
#   5. Creates a superuser (admin / admin@verifesto.com)
#   6. Attaches a custom domain (if provided)
#   7. Outputs DNS records and next steps
#
# Prerequisites:
#   - railway CLI installed (brew install railway)
#   - railway login completed
#   - Django project with backend/ directory structure
#   - requirements.txt in backend/
#   - config.settings as DJANGO_SETTINGS_MODULE

set -euo pipefail

# --- Args ---
PROJECT_DIR="${1:?Usage: $0 <project-dir> <project-name> [api-domain]}"
PROJECT_NAME="${2:?Usage: $0 <project-dir> <project-name> [api-domain]}"
API_DOMAIN="${3:-}"

# --- Validation ---
if [ ! -d "$PROJECT_DIR/backend" ]; then
    echo "ERROR: $PROJECT_DIR/backend does not exist. Expected Django project structure."
    exit 1
fi

if [ ! -f "$PROJECT_DIR/backend/requirements.txt" ]; then
    echo "ERROR: $PROJECT_DIR/backend/requirements.txt not found."
    exit 1
fi

if ! command -v railway &> /dev/null; then
    echo "ERROR: railway CLI not found. Install with: brew install railway"
    exit 1
fi

echo "=== Railway Django Deploy ==="
echo "Project dir:  $PROJECT_DIR"
echo "Project name: $PROJECT_NAME"
echo "API domain:   ${API_DOMAIN:-<none, will use railway subdomain>}"
echo ""

cd "$PROJECT_DIR"

# --- Generate a secure SECRET_KEY ---
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")

# --- Step 1: Create Railway project ---
echo ">>> Step 1: Creating Railway project '$PROJECT_NAME'..."
railway init -n "$PROJECT_NAME" 2>&1 || {
    echo "NOTE: Project may already exist. Attempting to link..."
    railway link
}
echo "    Done."

# --- Step 2: Provision PostgreSQL ---
echo ">>> Step 2: Provisioning PostgreSQL..."
railway add -d postgres 2>&1 || echo "    NOTE: Postgres may already be provisioned."
echo "    Done."

# --- Step 3: Create/link the backend service ---
echo ">>> Step 3: Setting up backend service..."
# Railway auto-creates a service when you deploy. We link the current directory.
railway service link 2>&1 || true
echo "    Done."

# --- Step 4: Set environment variables ---
echo ">>> Step 4: Setting environment variables..."

# Build ALLOWED_HOSTS and CORS_ALLOWED_ORIGINS based on domain
if [ -n "$API_DOMAIN" ]; then
    ALLOWED_HOSTS="$API_DOMAIN"
    CORS_ORIGINS="https://${API_DOMAIN/api./}"
else
    ALLOWED_HOSTS="*.up.railway.app"
    CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
fi

railway variables set \
    SECRET_KEY="$SECRET_KEY" \
    DEBUG="False" \
    ALLOWED_HOSTS="$ALLOWED_HOSTS" \
    CORS_ALLOWED_ORIGINS="$CORS_ORIGINS" \
    DEFAULT_FROM_EMAIL="Verifesto Studios <hello@verifesto.com>" \
    2>&1

echo "    Done. Variables set:"
echo "      SECRET_KEY=<generated>"
echo "      DEBUG=False"
echo "      ALLOWED_HOSTS=$ALLOWED_HOSTS"
echo "      CORS_ALLOWED_ORIGINS=$CORS_ORIGINS"
echo ""

# --- Step 5: Create Procfile if it doesn't exist ---
if [ ! -f "$PROJECT_DIR/Procfile" ]; then
    echo ">>> Step 5: Creating Procfile..."
    cat > "$PROJECT_DIR/Procfile" << 'PROCFILE'
web: cd backend && python manage.py migrate --noinput && python manage.py collectstatic --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8080} --workers 2
PROCFILE
    echo "    Created Procfile."
else
    echo ">>> Step 5: Procfile already exists, skipping."
fi

# --- Step 6: Deploy ---
echo ">>> Step 6: Deploying to Railway..."
railway up -d 2>&1
echo "    Deploy started (detached). Waiting 30s for build to begin..."
sleep 5

# --- Step 7: Attach custom domain ---
if [ -n "$API_DOMAIN" ]; then
    echo ">>> Step 7: Attaching custom domain '$API_DOMAIN'..."
    railway domain "$API_DOMAIN" 2>&1 || echo "    NOTE: Domain may already be attached."
    echo "    Done."
    echo ""
    echo "    DNS RECORD NEEDED:"
    echo "    Type:  CNAME"
    echo "    Name:  ${API_DOMAIN%%.*}"
    echo "    Value: <check Railway dashboard for the target>"
    echo ""
else
    echo ">>> Step 7: Generating Railway domain..."
    railway domain 2>&1
fi

# --- Step 8: Post-deploy tasks ---
echo ""
echo ">>> Step 8: Post-deploy tasks"
echo ""
echo "    Once the deploy finishes (check 'railway logs'), run these:"
echo ""
echo "    # Activate local venv for railway run commands"
echo "    source $PROJECT_DIR/backend/venv/bin/activate"
echo ""
echo "    # Create superuser"
echo "    cd $PROJECT_DIR && railway run python backend/manage.py createsuperuser"
echo ""
echo "    # Or set a password for an existing admin user"
echo "    cd $PROJECT_DIR && railway run python backend/manage.py changepassword admin"
echo ""

# --- Step 9: Summary ---
echo "=== Deploy Complete ==="
echo ""
echo "Project:  $PROJECT_NAME"
echo "Backend:  ${API_DOMAIN:-<check railway domain output above>}"
echo "Admin:    https://${API_DOMAIN:-<domain>}/admin/"
echo "API:      https://${API_DOMAIN:-<domain>}/api/"
echo ""
echo "Remaining manual steps:"
echo "  1. Set RESEND_API_KEY in Railway:  railway variables set RESEND_API_KEY=re_xxx"
echo "  2. Add SPF/DKIM DNS records for email (from Resend dashboard)"
echo "  3. Create superuser (see Step 8 above)"
echo "  4. Verify: curl https://${API_DOMAIN:-<domain>}/admin/"
echo ""
echo "To check deploy status:  cd $PROJECT_DIR && railway logs"
echo "To redeploy:             cd $PROJECT_DIR && railway up -d"
echo ""
