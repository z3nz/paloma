# Plan: Verifesto Email Notifications

**Goal:** Integrate email notifications for new inquiries on verifesto.com. This involves sending an internal notification to admins and a confirmation to the user.
**Date:** 2026-03-26
**Status:** Charted

---

## Story

When a potential client submits an inquiry through the Verifesto website, two automated emails should be sent:
1.  An **admin notification** is sent to Kelsey and Adam, containing all the details of the submission. It must allow them to reply directly to the potential client.
2.  A **client confirmation** is sent to the person who submitted the form, acknowledging receipt and setting expectations.

This system must be reliable and not interfere with the core functionality of saving the inquiry to the database, even if email sending fails.

## Design Decisions

- **Email Service Provider (ESP):** Resend will be used, as it's API-based, works well with Railway, and has a generous free tier.
- **Integration:** `django-anymail` will be used as a bridge between Django's mail functions and the Resend API. This provides flexibility and cleaner code.
- **Error Handling:** Email sending failures **must not** prevent the inquiry from being saved. The API should still return a `201 CREATED` response. Errors will be logged to the console for now.
- **Templates:** Emails will be rendered from HTML templates within Django (`intake/templates/emails/`), not as inline strings, to separate presentation from logic.
- **Synchronous Send:** Given the low expected volume, emails will be sent synchronously within the `submit_inquiry` view. An asynchronous task queue (like Celery) is overkill for this MVP.
- **Reply-To Header:** The admin notification email will have its `Reply-To` header set to the client's email address, enabling seamless replies.

---

## Work Units

### WU-1: Dependencies & Configuration
- **Status:** complete
- **Scope:** Add `django-anymail` with the Resend extra to `requirements.txt`. Update `settings.py` to configure `anymail` as the email backend and pull the Resend API key from environment variables.
- **Files:**
    - `backend/requirements.txt`
    - `backend/config/settings.py`
- **Backend:** gemini

### WU-2: Create HTML Email Templates
- **Status:** complete
- **Scope:** Create two HTML templates for the emails.
    - `admin_notification.html`: Displays all fields from the `Inquiry` model.
    - `client_confirmation.html`: A warm, professional confirmation message for the client.
- **Files:**
    - `backend/intake/templates/emails/admin_notification.html` (create)
    - `backend/intake/templates/emails/client_confirmation.html` (create)
- **Backend:** gemini

### WU-3: Implement Email Dispatch Logic
- **Status:** complete
- **Scope:** Update the `submit_inquiry` view in `intake/views.py`. After the inquiry is successfully saved, send both the admin and client emails within a `try...except` block to handle potential sending errors gracefully.
- **Files:**
    - `backend/intake/views.py`
- **Backend:** gemini

### WU-4: DNS Configuration (Manual)
- **Status:** ready
- **Scope:** Document the manual steps for Adam to add the required SPF and DKIM records to Cloudflare for the `verifesto.com` domain. Resend will provide these values after domain verification.
- **Files:**
    - This plan document serves as the instruction.
- **Backend:** (none)

### WU-5: Set Environment Variable (Manual)
- **Status:** ready
- **Scope:** Document the manual step for Adam to set the `RESEND_API_KEY` environment variable in the Railway project settings for the Verifesto backend.
- **Files:**
    - This plan document serves as the instruction.
- **Backend:** (none)

### WU-6: End-to-End Testing
- **Status:** ready
- **Scope:** Instructions for testing the full flow. First, locally using Resend's test mode or a mock backend. Finally, a live test on the production environment after deployment and manual steps (WU-4, WU-5) are complete.
- **Files:** (none)
- **Backend:** (none)

---

## File Change Map

- **Modified:**
    - `/Users/adam/Projects/verifesto.com/backend/requirements.txt`
    - `/Users/adam/Projects/verifesto.com/backend/config/settings.py`
    - `/Users/adam/Projects/verifesto.com/backend/intake/views.py`
- **Created:**
    - `/Users/adam/Projects/verifesto.com/backend/intake/templates/emails/admin_notification.html`
    - `/Users/adam/Projects/verifesto.com/backend/intake/templates/emails/client_confirmation.html`

---

## Implementation Notes

**Built by Forge on 2026-03-26.**

### Files Created
- `backend/intake/templates/emails/admin_notification.html` — Internal notification with all inquiry fields, reply-to set to client email, NDA badge if requested
- `backend/intake/templates/emails/client_confirmation.html` — Warm client confirmation, conditionally mentions NDA if requested

### Files Modified
- `backend/requirements.txt` — Added `django-anymail[resend]>=10.0`
- `backend/config/settings.py` — Added `anymail` to INSTALLED_APPS, EMAIL_BACKEND, ANYMAIL config, DEFAULT_FROM_EMAIL
- `backend/intake/views.py` — Full rewrite with email dispatch logic

### Deviations from Plan
- Used `EmailMultiAlternatives` instead of `send_mail` for both emails — `send_mail` doesn't support `reply_to`. This is the correct Django pattern for HTML emails with reply-to.
- Split email dispatch into private `_send_admin_notification` and `_send_client_confirmation` helpers — makes each try/except independent so one failure doesn't prevent the other from sending.
- Used `logger.exception()` (captures full traceback) instead of `print()` for error logging.

### WU-4, WU-5, WU-6 remain
- WU-4: Adam must add SPF/DKIM DNS records in Cloudflare after Resend domain verification
- WU-5: Adam must set `RESEND_API_KEY` env var in Railway
- WU-6: End-to-end test after manual steps complete

---

## Dependencies

- **WU-3** depends on **WU-1** and **WU-2**.
- **WU-6** depends on **WU-3**, **WU-4**, and **WU-5**.
- **WU-4** and **WU-5** are manual steps for Adam that can happen in parallel with the code changes but must be complete before final testing (WU-6).

This plan is now ready for Forge.
