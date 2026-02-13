# Fadden Pest Control — Demo UI Prototype

> **Goal:** High-fidelity UI demo showing the core scheduling → service ticket flow. No backend.
> **Client:** Matt Fadden (Fadden Pest Control)
> **Stack:** Vue 3 + Vite + Tailwind CSS (UI only, mock data)
> **Created:** 2026-02-13

---

## Context

Matt Fadden is Verifesto Studios' first client. He runs a pest control business in Maine and needs an internal app to replace his entirely paper-based workflow. Three previous vendors failed to build what he needs.

**His core pain:** Handwritten service tickets, paper scheduling, manual annual reporting. He's paying someone just to fill out paperwork.

**What success looks like:** "Schedule → Service Ticket → Records" — all digital, all automated.

## Demo Purpose

Show Matt a clickable, high-fidelity UI prototype that demonstrates we understand his problems and can solve them. This is NOT a working app — it's a visual proof of concept with mock data.

**Demo should make Matt say:** "YES, this is exactly what I've been trying to get built."

## Demo Scope

### Included (Priority Order)

1. **Schedule View (Monthly)**
   - Calendar grid showing the month
   - Days show customer counts / appointment indicators
   - Click a day to see day detail

2. **Day View**
   - 2-hour time windows (configurable: odds 7-9, 9-11 or evens 8-10, 10-12)
   - Up to 3 customers per window
   - Customer cards showing: name, address, service type, service frequency
   - "Arrive" button to start service ticket flow
   - Phone icon to quick-text customer ("Coming tomorrow, 7-9")

3. **Service Ticket Form**
   - Pre-populated: date, customer info, service type (from schedule)
   - Auto-captured: time in (mock), wind speed + temp (mock weather data)
   - Target pest selection (carpenter ant, pavement ant, roach, etc.)
   - Product selection (filtered by target pest)
   - Treatment code (crack & crevice, bait, spray, etc.)
   - Equipment used (bait gun, sprayer, etc.)
   - Amount used (numeric input + units)
   - Areas inspected/treated (multi-select: kitchen, bathroom, basement, etc.)
   - Service type badge: Initial / Regular / Extra
   - "Complete" button

4. **Completed Ticket Preview**
   - Clean, printable format matching Matt's paper ticket layout
   - All fields populated from the form
   - "Email to Customer" button (mock)
   - "Print" button (mock)

5. **Customer List**
   - Searchable table/list of all customers
   - Shows: name, address, phone, service frequency, last service date
   - Click to see customer detail / service history

6. **Dashboard (simple)**
   - Services this month: count
   - Products used: summary table
   - Upcoming schedule: next 3 days

### Deferred (Later Phases)

- Real PDF generation / thermal printer support
- Actual SMS/email sending
- Weather API integration (real data)
- Annual report generation
- Authentication / user roles
- Sales call scheduling (Uncle Ed's workflow)
- Real database / backend
- Extra service (non-chargeable) scheduling

## Mock Data

### Customers (8-10)
Mix of residential customers in Maine towns (Auburn, Portland, Berwick, New York County). Include service frequency (bi-monthly, quarterly), address, phone.

### Products
Based on transcript mentions:
- Avion Roach Gel Bait
- Ant Gel
- (We need Matt's full product list — use placeholders for now)

### Treatment Codes
- Crack and Crevice
- Bait Application
- Spray Treatment
- Exclusion
- (Expand when we get full list from Matt)

### Target Pests
- Carpenter Ant
- Pavement Ant
- Roach
- Mouse/Rodent
- Bed Bug
- Squirrel
- Other (write-in)

### Areas
- Kitchen, Bathroom, Basement, Bedroom, Living Room, Attic, Garage, Exterior, Medical (for jail/facility), Other (write-in)

### Technicians
- Matt Fadden (owner)
- Uncle Ed (sales + service)
- Kathy (future technician)

## Tech Details

### Project Location
```
paloma/projects/fadden-demo/
```

### Scaffold
```bash
npm create vite@latest fadden-demo -- --template vue
cd fadden-demo
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install lucide-vue-next date-fns
```

### Structure
```
fadden-demo/
├── src/
│   ├── components/
│   │   ├── schedule/
│   │   │   ├── MonthView.vue
│   │   │   ├── DayView.vue
│   │   │   └── CustomerCard.vue
│   │   ├── ticket/
│   │   │   ├── ServiceTicketForm.vue
│   │   │   ├── TicketPreview.vue
│   │   │   └── PestSelector.vue
│   │   ├── customers/
│   │   │   ├── CustomerList.vue
│   │   │   └── CustomerDetail.vue
│   │   ├── dashboard/
│   │   │   └── DashboardView.vue
│   │   └── layout/
│   │       ├── AppShell.vue
│   │       └── NavTabs.vue
│   ├── composables/
│   │   ├── useSchedule.js
│   │   ├── useCustomers.js
│   │   ├── useServiceTicket.js
│   │   └── useProducts.js
│   ├── data/
│   │   ├── customers.js
│   │   ├── products.js
│   │   ├── treatments.js
│   │   └── areas.js
│   ├── App.vue
│   ├── main.js
│   └── style.css
├── index.html
├── vite.config.js
└── package.json
```

### Design Direction
- Clean, professional, not flashy
- Mobile-first (techs use this on phones in the field)
- Desktop admin view for scheduling (Matt manages from laptop)
- Color scheme: professional blues/grays, green for success states
- Large touch targets for field use
- Minimal clicks to complete a service ticket

## Deployment
- Cloudflare Pages (free, instant)
- Give Matt a real URL to click around in

---

*This plan will be updated as we build. Features may shift based on Adam's priorities during implementation.*
