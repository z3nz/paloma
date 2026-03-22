# Verifesto Studios — Intake Form Draft (v3)

> **Design context:** This form lives on verifesto.com as part of the storybook experience. Filling out the form feels like turning pages — each section is a new page in the client's story with Verifesto Studios. The tone is warm, calming, confident, and inviting.

---

## Storybook Cover (Landing / Homepage)

This is the very first thing the client sees. It is NOT a form page — it's the storybook cover that draws them in before the pages begin.

**Content:**
- Verifesto Studios logo (centered, prominent)
- "Verifesto Studios" text

**Design note:** This is the book landing in front of the client. The animation shows the storybook arriving, and then it opens/flows into Page 1. Clean, simple, impactful — just the brand. No form fields, no text walls. The logo and name do the talking.

---

## Page 1 — Welcome

**Heading:**
> Every great project starts with a story. Let's hear yours.

**Who We Are:**
> Verifesto Studios is a creative development studio that turns bold visions into reality. We build with purpose, integrity, and heart — partnering with you every step of the way. Your story matters to us, and we're here to help you tell it.

**Design note:** This is the first page after the storybook opens. The quote and description live together — the quote hooks them, the description builds confidence and trust. Should feel like the opening page of a story, inviting the reader to keep turning.

---

## Page 2 — Contact Information

**Heading:**
> Let's get to know each other.

**Fields (4 total — keep it quick, under 30 seconds to complete):**

1. **Full Name**
   - Type: Text input
   - Required: Yes
   - Label: "Full Name"
   - Placeholder: "First and Last Name"
   - Validation: Minimum 2 characters

2. **Email**
   - Type: Email input
   - Required: Yes
   - Label: "Email"
   - Placeholder: "you@example.com"
   - Validation: Standard email format (must contain @ and domain)

3. **Phone Number**
   - Type: Phone/tel input
   - Required: No
   - Label: "Phone (optional)"
   - Placeholder: "(555) 555-5555"
   - Validation: Standard phone format if provided, but don't block submission if format varies

4. **Company or Organization**
   - Type: Text input
   - Required: No
   - Label: "Company or Organization (if applicable)"
   - Placeholder: "Your company name, or leave blank if individual"
   - Note: This covers both business clients and individual clients — the "if applicable" wording ensures individuals don't feel like they're missing something

**Design note:** Clean layout, generous spacing. No clutter. The page should feel inviting, not like a government form. After completing, the client turns to the next page.

---

## Page 3 — Your Vision

**Heading:**
> Tell us about your vision.

**Subtext:**
> In a few sentences, share what you're envisioning. What's the project? What excites you about it? There are no wrong answers — we just want to hear what inspires you.

**Field:**

1. **Project Description**
   - Type: Open text box (multi-line textarea)
   - Required: Yes
   - Label: None needed (the heading and subtext serve as the label)
   - Placeholder: "What's your project about? What inspires you? What would success look like?"
   - Size: Large enough to write comfortably — at least 5-6 visible lines
   - No word limit — let the client write as much or as little as they want

**Why open-ended:** This reveals how serious and passionate the client is about their project. Their words tell us who they are and how invested they are in making their vision real.

**--- NDA Section (below the text box, same page) ---**

**Small heading or visual divider:**
> Your ideas are safe with us.

2. **Mutual NDA Checkbox**
   - Type: Checkbox
   - Required: No
   - Label: "I'd like both parties to sign a mutual NDA to protect our conversation."
   - Default: Unchecked

**Tooltip** (appears on hover/tap over "mutual NDA" or a small ℹ️ icon next to it):
> A mutual NDA means both sides — you and Verifesto Studios — agree to keep everything we discuss confidential. It protects your ideas and our process equally. It's a sign of mutual respect and trust.

**Tooltip implementation:** On desktop, the tooltip appears on hover. On mobile, it appears on tap. The ℹ️ icon should be subtle but noticeable — clients who know what an NDA is can skip it, and those who don't can learn in one tap.

**Navigation:** A "Next" or forward arrow button to proceed to the review page.

---

## Page 4 — Review & Submit

**Heading:**
> Let's make sure everything looks right.

**Subtext:**
> Take a moment to review what you've shared. You can go back and edit anything before submitting.

**Content:** Display a clean summary of everything the client entered:

- **Name:** [Full Name]
- **Email:** [Email]
- **Phone:** [Phone Number, or "Not provided"]
- **Company:** [Company name, or "Not provided"]
- **Project Vision:** [Full text of their project description]
- **Mutual NDA:** [Yes / No]

**Edit functionality:** Each section should have an "Edit" link or pencil icon that takes the client back to the relevant page to make changes. After editing, they return to this review page.

**Submit button:**
> Submit — Let's Begin Our Story

**Design note:** This is a full page. The review gives the client confidence that everything is correct before they commit. The submit button language reinforces the storybook theme. Once they click submit, the storybook "closes" or transitions into a confirmation message:

**After submission (brief confirmation on same page or transition):**
> Your story has begun. Thank you for sharing your vision with us. We'll be in touch within [X business days] to schedule your free consultation. We can't wait to hear more.

**What happens next:**
1. We review your submission
2. We reach out to schedule a free consultation call
3. If a time doesn't work for you, we'll offer multiple options
4. Your journey with Verifesto Studios begins

---

## Technical Notes for Adam

- **Storybook cover** = landing/homepage animation (logo + name only), then opens into Page 1
- **3 form pages + 1 review/submit page** (4 total pages after the cover)
- **Storybook page-turn animation** between each page
- **Review page (Page 4):** Pulls all inputted data and displays it cleanly. "Edit" links navigate back to the relevant page without losing data. Submit button on this page only.
- **Tooltip implementation:** CSS hover tooltip or ℹ️ icon next to "mutual NDA" — must work on mobile (tap to reveal)
- **Form state persistence:** Client data should persist as they navigate between pages (no losing work if they go back to edit)
- **Post-submission:** Trigger a confirmation email to the client + notification to the Verifesto team
- **Mobile responsive:** Storybook concept needs to work beautifully on mobile
- **Accessibility:** All fields properly labeled, tooltip content accessible via screen readers, edit links clearly labeled
- **Data:** Submissions stored/emailed so the team can review and schedule the call

---

## Tone Guide

The entire form should feel like:
- **Calming** — no pressure, no corporate coldness
- **Trusting** — "your ideas are safe here"
- **Confident** — we know what we're doing, and we're excited to help
- **Symbolic** — this is the beginning of a story, not just a transaction
- **Kind** — warmth in every word, no jargon, no intimidation

What makes Verifesto different: We stand on our talent, values, beliefs, and strength while showing kindness. The storybook concept reflects this — every client's project is a story worth telling, and we're honored to help write it.
