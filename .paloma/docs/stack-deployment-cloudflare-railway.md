# Stack Reference: Deployment — Cloudflare Pages + Railway

> Verifesto Studios deployment standard. Frontend on Cloudflare Pages, Backend on Railway.

---

## Architecture

```
[Browser] → Cloudflare Pages (Vue 3 SPA)
                  ↓ API calls
            Railway (Django + PostgreSQL)
```

## Cloudflare Pages (Frontend)

### Setup
1. Connect GitHub repo to Cloudflare Pages
2. Build configuration:
   - Framework preset: **Vue**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `frontend`
3. Environment variables:
   - `VITE_API_URL` = `https://api.yourdomain.com`

### Custom Domain
1. Add domain in Cloudflare Pages → Custom Domains
2. If domain is on Cloudflare DNS, it auto-configures
3. SSL is automatic

### Deploy Previews
- Every PR gets a preview URL automatically
- Great for client review before merging

## Railway (Backend)

### Setup
1. Create new project in Railway
2. Add **Django service** from GitHub repo
   - Root directory: `backend`
   - Build command: `pip install -r requirements.txt && python manage.py collectstatic --noinput && python manage.py migrate`
   - Start command: `gunicorn config.wsgi`
3. Add **PostgreSQL** plugin (one click)
   - `DATABASE_URL` is auto-set

### Environment Variables
```
SECRET_KEY=<generate-a-strong-key>
DEBUG=False
ALLOWED_HOSTS=api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

### Custom Domain
1. Railway → Service → Settings → Custom Domain
2. Add `api.yourdomain.com`
3. Add CNAME record in Cloudflare DNS pointing to Railway's provided domain
4. SSL is automatic via Railway

### Create Superuser (one-time)
```bash
railway run python manage.py createsuperuser
```

## DNS Setup (Cloudflare)

| Type  | Name | Target                          |
|-------|------|---------------------------------|
| CNAME | @    | (Cloudflare Pages auto-config)  |
| CNAME | api  | <railway-provided-domain>.up.railway.app |

## Cost Estimates

| Service              | Free Tier          | Typical Cost      |
|----------------------|--------------------|--------------------|
| Cloudflare Pages     | Unlimited sites    | Free               |
| Railway (backend)    | $5/mo trial credit | ~$5-10/mo          |
| Railway (PostgreSQL) | Included in credit | ~$5/mo             |
| Custom domain        | —                  | ~$10-15/yr         |

**Typical monthly hosting: $10-20/mo per project**

## Monorepo Considerations

Both services deploy from the same repo but different root directories:
- Cloudflare Pages: `frontend/`
- Railway: `backend/`

This works natively with both platforms — no special monorepo tooling needed.

## Notes

- Cloudflare Pages is free and fast — no reason to use anything else for static frontends
- Railway is simple and affordable — good for small-to-medium Django projects
- For larger projects, consider Railway's team plans or migrating to AWS/GCP
- Always use HTTPS (both platforms provide it automatically)
- Cloudflare's CDN caches the frontend globally — excellent performance
