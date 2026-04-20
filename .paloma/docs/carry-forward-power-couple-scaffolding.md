# Carry Forward — Power Couple App Scaffolding

> **Session:** 499 | **Date:** 2026-04-01T19:15:00.000Z
> **Previous Session:** 498 (conversation with Kelsey about PowerCouple app)
> **Status:** Scaffold Complete & Polished → Ready for Implementation

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
- **Dependencies:** `@nativescript/vue`, `@nativescript/tailwind` ✓

### **Backend: Python + Django + DRF + PostgreSQL**
- Rapid scaffolding
- Django Channels for WebSocket
- AI/ML ready (stress detection, task timing)
- **Middleware:** CORS correctly ordered ✓

### **Deployment: Railway + NativeScript**
- Backend on Railway (standard Verifesto)
- NativeScript app stores (both iOS & Android)

---

## ✅ Current State (ACTUAL)

**Location:** `/Users/adam/Projects/PowerCouple`

### **COMPLETED (Well Polished):**
- [x] Repository structure created
- [x] Django backend skeleton with proper CORS middleware order
- [x] NativeScript App.vue with `<TabView>`, `<TabViewItem>` components
- [x] Package.json with `@nativescript/vue`, `@nativescript/tailwind`
- [x] Three core page files: ConnectionPage, OrganizationPage, FunPage
- [x] Django apps: profiles, tasks, checkins with serializers/views
- [x] .env.example files for frontend and backend
- [x] Documentation: README.md, .paloma/plans files

### **NEEDS CONTENT:**
- [ ] Page content implementation (currently placeholders)
- [ ] Task priority bars (green/blue/purple)
- [ ] Daily check-in UI components
- [ ] Gratitude checkbox component
- [ ] Animation system for "cute guide figure"
- [ ] WebSocket setup for real-time features
- [ ] Apple Watch support (deferred to roadmap)

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

## 📋 Next Immediate Actions

### **Session: Start Core Features**
1. Implement ConnectionPage content with daily check-ins
2. Create 3-priority task components for OrganizationPage
3. Build gratitude checkbox for FunPage
4. Set up WebSocket for real-time chat features
5. Test local development flow

---

## 🧭 Ready to Continue

**Paloma's stance:** Scaffold foundation **complete and polished**. Awaiting your signal to begin implementing core features.

**Ready when you are to say** "go" **or** "start implementing."

---

*Carry forward created for future sessions. Continue where we left off.*
