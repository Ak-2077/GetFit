# AI Usage Policy

**Last Updated:** June 26, 2026

This AI Usage Policy describes how artificial intelligence is used within the **GetFit** mobile application operated by KeyZen.

---

## 1. AI Features in GetFit

GetFit incorporates the following AI-powered features:

### 1.1 AI Trainer Chatbot (Kyro Pro+ Feature)
- A conversational AI fitness and nutrition coach available to Kyro Pro+ subscribers
- Provides personalized workout advice, nutrition guidance, motivation, and answers to fitness-related questions
- Adapts its communication style and recommendations based on your profile, conversation history, and stored memories

### 1.2 AI Diet Plan Generator (Kyro Pro Feature)
- Generates personalized diet plans based on your health profile, fitness goals, dietary preferences, allergies, health conditions, cuisine preferences, cooking time, and budget
- Calculates appropriate calorie targets and macro distributions

### 1.3 AI Food Recognition
- Identifies food items from photos captured by your device camera
- Estimates nutritional content (calories, protein, carbs, fat) of identified foods
- Supports identification of multiple food items in a single image

### 1.4 AI Video Form Analysis
- Analyzes exercise form from user-submitted videos
- Detects exercise type, counts repetitions, and provides a form score
- Offers feedback on form improvement

### 1.5 AI Memory System
- The AI Trainer extracts and stores factual information from your conversations (e.g., "has a knee injury," "prefers morning workouts," "is vegetarian")
- Memories are categorized by type: injury, goal, preference, body stats, experience, limitation, achievement, routine, nutrition, progress
- Memories have a hierarchical system:
  - **Level 1 (Core Identity):** Very slow decay — allergies, chronic injuries, fundamental preferences
  - **Level 2 (Long-term Evolving):** Medium decay — weight, routines, progress
  - **Level 3 (Short-term Context):** Fast decay (24-72 hours) — temporary states like soreness, travel
  - **Level 4 (Session):** Destroyed when the chat session ends

### 1.6 Adaptive Coaching
- The AI maintains a "User State" that tracks inferred metrics such as energy, recovery, fatigue, motivation, adherence, injury risk, burnout risk, and plateau risk
- These metrics are used to adjust AI coaching recommendations (e.g., suggesting deload periods when fatigue is high, simplifying plans when adherence is low)
- The AI may predict behavioral patterns such as likely plan abandonment, motivation drops, or readiness for progression

---

## 2. AI Technology

- GetFit uses a **custom self-hosted AI model** for all AI features
- The AI service processes your data in real-time and does **not** share your data with third-party AI providers (e.g., OpenAI, Google, Anthropic)
- Food recognition uses computer vision models to identify food items from images
- The AI model is hosted on infrastructure controlled by KeyZen

---

## 3. Data Used by AI

The AI features use the following data to provide personalized responses:

| Data Type | How Used |
|---|---|
| Your profile (name, age, gender, weight, height, goal, diet preference) | Personalizing recommendations |
| Your subscription tier | Determining available AI features |
| Chat messages you send | Generating relevant responses |
| AI-extracted memories | Providing context-aware coaching |
| Food images (camera captures) | Identifying food items |
| Exercise videos (user-submitted) | Analyzing exercise form |
| User state signals (workout logs, meal logs, feedback) | Adapting coaching intensity and tone |

---

## 4. Your Control Over AI Data

You have full control over your AI data:

- **View memories:** See all facts the AI has stored about you
- **Delete individual memories:** Remove specific facts you don't want the AI to remember
- **Confirm memories:** Verify AI-extracted facts for higher accuracy
- **Reset all memories:** Clear your entire AI memory profile
- **Export memories:** Download all AI memories associated with your account
- **Delete chat sessions:** Remove conversation history
- **Delete account:** Removes all AI data permanently

---

## 5. AI Limitations and Disclaimers

> **⚠️ IMPORTANT: The AI is NOT a medical professional, licensed dietitian, certified personal trainer, or healthcare provider.**

### 5.1 No Medical Advice
- AI responses are for informational and educational purposes only
- AI-generated diet plans, calorie recommendations, and fitness advice are **estimates** based on general formulas and may not be appropriate for your specific medical conditions
- Always consult a qualified healthcare professional before making significant changes to your diet or exercise routine

### 5.2 Accuracy Limitations
- AI food recognition may **misidentify foods** or provide **inaccurate nutritional estimates**
- AI diet plans may not account for all medical conditions, medication interactions, or individual nutritional needs
- AI exercise form analysis may **miss critical form errors** that could lead to injury
- AI memory extraction may **misinterpret or misremember** facts from conversations

### 5.3 Not a Substitute for Professional Services
The AI Trainer is not a substitute for:
- A licensed physician or medical professional
- A registered dietitian or nutritionist
- A certified personal trainer or exercise physiologist
- A licensed mental health professional

### 5.4 User Responsibility
You are solely responsible for:
- Verifying the accuracy of AI-generated information before acting on it
- Disclosing relevant health conditions and allergies when interacting with the AI
- Discontinuing any AI-recommended plan that causes adverse effects
- Seeking professional advice for serious health, nutrition, or fitness concerns

---

## 6. AI Training and Data Usage

- Your conversations and data **may be used to improve the AI model's accuracy** for your own personalized experience
- We do **not** use your personal data to train AI models that are shared with or used by other users
- AI model improvements are focused on system-level quality, not individual user data exposure
- You can opt out of AI data retention by deleting your AI memories and chat history

---

## 7. AI Safety

We implement the following safety measures:

- **Memory validation:** AI-extracted memories are validated before storage to prevent erroneous facts
- **Memory quarantine:** Uncertain or emotionally-driven facts are quarantined and require verification
- **Contradiction detection:** The AI resolves conflicting memories to maintain accuracy
- **Truth decay:** Memory confidence scores decay over time if not reinforced, ensuring outdated information fades
- **Rate limiting:** AI endpoints are protected against abuse
- **Content filtering:** The AI is designed to refuse requests for harmful, abusive, or medically dangerous advice

---

## 8. Changes to AI Features

We may update, modify, or discontinue AI features at any time. We will notify users of material changes through the App.

---

## 9. Contact

For questions about our AI features or this policy:

- **Email:** [CONTACT_EMAIL]
- **Company:** KeyZen

---

*This AI Usage Policy is effective as of June 26, 2026.*
