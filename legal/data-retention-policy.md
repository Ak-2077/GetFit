# Data Retention Policy

**Last Updated:** June 26, 2026

This Data Retention Policy explains how long **GetFit** (operated by KeyZen) retains your personal data and the criteria used to determine retention periods.

---

## 1. Retention Schedule

| Data Category | Retention Period | Justification |
|---|---|---|
| **Account data** (name, email, phone, auth IDs) | Until account deletion | Required to maintain your account |
| **Health profile** (height, weight, age, gender, BMI, body type) | Until account deletion | Required for ongoing fitness calculations |
| **Fitness targets** (calorie goals, protein targets) | Until account deletion | Required for daily tracking features |
| **Food logs** (meals, calories, macros) | Until account deletion | Required for nutrition history and streaks |
| **Burn logs** (exercise calorie burns) | Until account deletion | Required for calorie tracking |
| **Nutrition streaks** | Until account deletion | Required for streak feature |
| **Food memory** (frequent/recent foods) | Until account deletion | Improves food logging experience |
| **AI chat sessions** (conversation history) | Until you delete the session or account | Required for conversational continuity |
| **AI memories** (extracted facts) | Until you delete them or your account; L3 memories expire in 24-72 hours; L4 memories expire at session end | Required for personalized AI coaching |
| **AI user state** (energy, fatigue, etc.) | Until account deletion | Required for adaptive coaching |
| **AI learning profile** | Until account deletion | Required for communication personalization |
| **Profile photo** | Until you change it or delete your account | Profile display |
| **Subscription records** | **7 years after subscription ends** | Financial record-keeping and tax compliance (Indian tax law) |
| **Payment transaction IDs** (Razorpay, Apple) | **7 years after transaction** | Financial audit trail and dispute resolution |
| **OTP codes** | **5 minutes** (auto-expire) | One-time authentication only |
| **Server access logs** (IP addresses) | **30 days** (rolling) | Security monitoring and abuse prevention |
| **Crash reports** (Firebase Crashlytics) | Per Firebase retention policy (~90 days) | Bug identification and resolution |
| **Error reports** (Sentry) | Per Sentry retention policy (~90 days) | Error tracking |
| **Analytics data** (Firebase Analytics) | Per Firebase retention policy (~14 months) | Service improvement |
| **Video analysis records** | Until account deletion | Exercise form analysis history |

---

## 2. Retention Principles

### 2.1 Purpose Limitation
Data is retained only as long as it serves the purpose for which it was collected. When data is no longer needed, it is deleted or anonymized.

### 2.2 Legal Obligations
Certain data (particularly financial and subscription records) must be retained for a minimum period to comply with Indian tax and financial regulations.

### 2.3 User-Initiated Deletion
You can delete specific data at any time:
- **Individual AI memories** — Delete through AI Memories section in the App
- **AI chat sessions** — Delete individual conversations
- **Entire account** — Delete through Settings → Delete Account (removes all data)

### 2.4 Automated Expiration
- OTP codes expire automatically after 5 minutes
- AI Level 3 memories (short-term context) decay within 24-72 hours
- AI Level 4 memories (session-scoped) are destroyed when the chat session ends
- AI memory relevance scores decay over time through our truth decay algorithm

---

## 3. Data After Account Deletion

When you delete your account:

| Data | Action |
|---|---|
| Account profile | **Permanently deleted** |
| Food logs, burn logs | **Permanently deleted** |
| AI memories and chat sessions | **Permanently deleted** |
| AI user state and learning profile | **Permanently deleted** |
| Nutrition streaks | **Permanently deleted** |
| Food memory | **Permanently deleted** |
| Notifications | **Permanently deleted** |
| Video analysis records | **Permanently deleted** |
| Subscription records | **Retained for 7 years** (legal requirement) |
| Anonymous analytics data | **Retained** (cannot be linked back to you) |

---

## 4. Data Backup and Recovery

- Database backups are managed by MongoDB Atlas with automated backup policies
- After account deletion, your data may persist in encrypted database backups for up to **30 days** before being permanently purged
- We cannot recover your data after account deletion is processed

---

## 5. Contact

For questions about data retention:

- **Email:** [CONTACT_EMAIL]
- **Company:** KeyZen

---

*This Data Retention Policy is effective as of June 26, 2026.*
