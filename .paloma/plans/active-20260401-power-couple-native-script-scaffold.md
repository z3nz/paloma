# Power Couple App — Active Implementation Plan

> Status: Scaffolding Complete → Ready to Polish | Date: 2026-04-01

---

## 🎯 What We're Building

**PowerCouple App** — A relationship growth and organization app for couples

### **Three Pillars:** Organization, Connection, Fun
### **Theme of "3":** Always 3 choices (bite-sized, not overwhelming)
### **The "3rd Being" Concept:** Couple as one unified entity working together
### **Honesty First:** Will end relationships not meant to be together

### **Core Features:**
- **Individual Profiles** → Merging into shared "3rd being" experience
- **Connection Tab:** Daily check-ins, energy levels, hard conversations, stress detection (opt-in)
- **Organization Tab:** 3-priority task system, weather-based recommendations, weekly voting
- **Fun Tab:** Gratitude practice, animated guide, emotional communication layer

---

## 🛠️ Tech Stack (FINAL)

### **Frontend: NativeScript + Vue 3**
- Single codebase for iOS/Android
- CSS animations for beautiful UI
- Native performance
- **Dependencies:** `@nativescript/vue`, `@nativescript/tailwind`

### **Backend: Python + Django + DRF + PostgreSQL**
- Rapid scaffolding
- Django Channels for WebSocket
- AI/ML ready (stress detection, task timing)

### **Deployment: Railway + NativeScript**
- Backend on Railway (standard Verifesto)
- NativeScript app stores (both iOS & Android)

---

## 📁 Project Structure

```
PowerCouple/
├── frontend/              # NativeScript + Vue 3
│   ├── src/
│   │   ├── App.vue
│   │   ├── pages/
│   │   │   ├── ConnectionPage.vue
│   │   │   ├── OrganizationPage.vue
│   │   │   └── FunPage.vue
│   │   └── components/
│   ├── package.json
│   └── tailwind.config.js
├── backend/               # Django + DRF
│   ├── backend_project/
│   │   ├── settings.py
│   │   └── urls.py
│   ├── requirements.txt
│   └── .env.example
└── .paloma/
    ├── plans/
    │   ├── power-couple-tech-stack.md
    │   └── power-couple-roadmap.md
    └── README.md
```

---

## ✅ Current State

**Location:** `/Users/adam/Projects/PowerCouple`

**Completed:**
- [x] Repository created at GitHub: `Verifesto-Studios/PowerCouple`
- [x] Django backend skeleton (settings.py, requirements.txt)
- [x] Frontend directory structure (pages, components)
- [x] Basic .env.example files

**Needs Fixing:**
- [ ] Frontend Vue syntax (web → NativeScript components)
- [ ] TailwindCSS configuration for NativeScript
- [ ] Django CORS middleware order
- [ ] Package.json dependencies

---

## 🚀 Immediate Next Steps

### **Session 1: Polish Scaffold**
1. Fix `frontend/src/App.vue` — Use NativeScript `<tab-view>`, `<tab-pane>` components
2. Add `@nativescript/vue` and `@nativescript/tailwind` to `frontend/package.json`
3. Fix Django CORS middleware order in `backend/settings.py`
4. Configure Tailwind for NativeScript

### **Session 2: Core Components**
5. Create 3-priority task system components
6. Build daily check-in UI (energy/conversation levels)
7. Create gratitude checkbox component
8. Set up Django REST endpoints for tasks and check-ins

### **Session 3: Foundation Features**
9. Implement task creation/edit interface
10. Build weekly voting UI
11. Create hard conversations notification component
12. Test local development flow

---

## 🎨 Design System Notes

### **Three Priority Levels:**
- 🟢 **Green:** Light work (<1 hour, simple tasks)
- 🔵 **Blue:** Moderate work (few hours)
- 🟣 **Purple:** Hard/meaningful work (mental stimulation, hard conversations)

### **UI Principles:**
- **3 choices always** — never 2, never more
- **Helpful nudges** — not annoying pop-ups
- **Snapchat-style chat boxes** — cute animations
- **Animated guide figure** — pops up when idle (not during active interaction)
- **Gratitude checkbox** — daily morning reminder

---

## 📋 Reference

- **Full conversation:** Session 498 carry-forward document
- **Feature extraction:** "PowerCouple App — Feature List" (Paloma's breakdown)
- **Paloma's thoughts:** See carry-forward-498 for design analysis

---

## 🧭 Ready to Continue

**Paloma's stance:** Scaffold foundation complete. Awaiting your signal to:
1. Fix NativeScript-specific issues
2. Polish dependencies
3. Build first functional components

**Ready when you are to "go" or "continue".**

---

*Active plan for PowerCouple App — NativeScript + Django implementation*
