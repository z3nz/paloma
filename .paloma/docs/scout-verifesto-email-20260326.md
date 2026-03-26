# Scout Report: Verifesto Inquiry Email Notifications

**Date:** 2026-03-26
**Scope:** Researching and recommending a solution for sending email notifications from the Verifesto Django backend on Railway.

---

## 1. Executive Summary

The Verifesto backend needs to send two types of emails upon a new inquiry submission:
1.  A notification email to `kelsey@verifesto.com` and `adam@verifesto.com`.
2.  A confirmation email to the client who submitted the form.

My primary recommendation is to use **Resend** as the email service provider, integrated via the **`django-anymail`** library.

This approach is recommended because Railway blocks standard SMTP traffic on non-pro plans, making API-based solutions necessary. Resend is highly recommended by the Railway community, offers a generous free tier (3,000 emails/month) sufficient for this project's low volume, and `django-anymail` provides a flexible, maintainable integration that decouples the application from a specific provider.

---

## 2. Research Findings

### 2.1. Email Service Provider (ESP)

- **Railway Constraints:** My research indicates that Railway blocks outbound SMTP traffic on common ports for free/hobby-tier plans to prevent spam. This makes using Django's standard SMTP backend with services like Gmail unreliable. The consensus from the Railway community is to use a transactional email API.

- **Recommended Provider: Resend**
    - **Free Tier:** 3,000 emails per month, with a daily limit of 100. This is more than sufficient for the projected volume of 1-10 inquiries per week.
    - **Community Trust:** Resend is frequently and positively recommended by other developers on Railway's help forums.
    - **Developer Experience:** It is known for its modern, clean API and excellent documentation.

- **Alternative Providers:**
    - **Mailgun:** Offers a free tier, but community sentiment leans more strongly toward Resend.
    - **SendGrid:** The free tier has been reduced, making it less attractive.
    - **Postmark:** Excellent deliverability but generally more expensive and likely overkill for this stage.

### 2.2. Django Integration: `django-anymail`

Instead of using a provider-specific SDK directly, I recommend using `django-anymail`.

- **Flexibility:** It acts as a wrapper that allows you to use Django's built-in `send_mail` function, while `anymail` handles the translation to the provider's API (in this case, Resend). If you ever want to switch providers, you only need to change configuration in `settings.py`, not the application code.
- **Simplicity:** It keeps the email-sending logic in `views.py` clean and standard.

### 2.3. Email Content & Requirements

- **Internal Notification (to Adam & Kelsey):**
    - **Content:** Should contain all fields from the `Inquiry` model: `full_name`, `email`, `phone`, `company`, `vision`, `nda_requested`, and `created_at`.
    - **Reply-To:** The `Reply-To` header of this email **must** be set to the client's email address. This allows Kelsey or Adam to reply directly to the client from their inbox. Django's `send_mail` function supports this via the `reply_to` parameter.
    - **Format:** HTML is recommended for professional formatting. Django's template system (`render_to_string`) should be used to create the email body.

- **External Confirmation (to Client):**
    - **Requirement Confirmed:** The `verifesto-beginning-phase-internal-playbook.md` confirms an instant confirmation email to the client is required.
    - **Content & Tone:** The email should thank the client for their submission and set expectations for the next steps. The playbook specifies a "professional, natural, calming" tone. For the MVP, a simple acknowledgment is sufficient. Future iterations can include the scheduling link mentioned in the playbook.

### 2.4. DNS Records for `verifesto.com`

To ensure emails are delivered reliably and not marked as spam, DNS records must be configured for `verifesto.com` in Cloudflare.

- **From Address:** A sender like `hello@verifesto.com` or `studio@verifesto.com` should be used.
- **SPF & DKIM:** After setting up an account and verifying the domain with Resend, Resend will provide the specific values for `SPF` and `DKIM` records. These `TXT` records must be added to the Cloudflare DNS settings for `verifesto.com`.

---

## 3. Implementation Recommendations for Chart/Forge

### 3.1. Dependencies

Add the following packages to `backend/requirements.txt`:

```
django-anymail
resend
```

### 3.2. Django Settings (`backend/config/settings.py`)

Add `anymail` to `INSTALLED_APPS` and configure the `EMAIL_BACKEND` and `ANYMAIL` settings. The API key should be stored as an environment variable in Railway.

```python
# In INSTALLED_APPS
'anymail',
...

# At the end of the file
EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"
ANYMAIL = {
    "RESEND_API_KEY": os.environ.get("RESEND_API_KEY"),
}
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "hello@verifesto.com")
```

### 3.3. View Logic (`backend/intake/views.py`)

Modify `submit_inquiry` to dispatch emails after successfully saving the inquiry.

```python
# at the top
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.conf import settings

# inside submit_inquiry view, after serializer.save()
if serializer.is_valid():
    inquiry = serializer.save()

    # --- Send emails ---
    try:
        # 1. Internal Notification to Admins
        admin_subject = f"New Verifesto Inquiry: {inquiry.full_name}"
        admin_html_message = render_to_string('emails/admin_notification.html', {'inquiry': inquiry})
        admin_plain_message = strip_tags(admin_html_message) # Fallback
        
        send_mail(
            subject=admin_subject,
            message=admin_plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=['kelsey@verifesto.com', 'adam@verifesto.com'],
            html_message=admin_html_message,
            reply_to=[inquiry.email], # CRITICAL: Allows direct reply to client
            fail_silently=False,
        )

        # 2. Confirmation to Client
        client_subject = "Your Story Has Begun | Verifesto Studios"
        client_html_message = render_to_string('emails/client_confirmation.html', {'inquiry': inquiry})
        client_plain_message = strip_tags(client_html_message)

        send_mail(
            subject=client_subject,
            message=client_plain_message,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[inquiry.email],
            html_message=client_html_message,
            fail_silently=False,
        )
    except Exception as e:
        # Optional: Add logging here for email sending failures
        print(f"Error sending inquiry emails: {e}")

    return Response(serializer.data, status=status.HTTP_201_CREATED)
```

### 3.4. Email Templates

Create a new directory `backend/intake/templates/emails/` with two files:
- `admin_notification.html`: A template that iterates through the `inquiry` object's fields to display all submitted data.
- `client_confirmation.html`: The user-facing confirmation email template.

This structure allows for clear, maintainable, and professionally formatted HTML emails.
