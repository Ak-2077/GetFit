import mongoose from 'mongoose';

const userLearningProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // ── Interaction Stats ──
    totalMessages: { type: Number, default: 0 },
    totalSessions: { type: Number, default: 0 },
    avgMessagesPerSession: { type: Number, default: 0 },

    // ── Response Style Dimensions (learned from feedback) ──
    preferredResponseLength: {
      type: String,
      enum: ["short", "medium", "detailed"],
      default: "medium",
    },
    shortResponseVotes: { type: Number, default: 0 },
    detailedResponseVotes: { type: Number, default: 0 },

    // Multi-dimensional style profile (0.0 = left, 1.0 = right)
    styleProfile: {
      verbosity: { type: Number, default: 0.5 },      // 0=concise, 1=detailed
      technicality: { type: Number, default: 0.5 },    // 0=casual, 1=technical
      motivation: { type: Number, default: 0.5 },      // 0=direct, 1=motivational
      explanationDepth: { type: Number, default: 0.5 }, // 0=just-answer, 1=explain-why
      emojiUse: { type: Number, default: 0.0 },         // 0=none, 1=frequent
    },

    // Positive patterns the user likes
    preferredPatterns: [
      {
        pattern: String,
        count: { type: Number, default: 1 },
      },
    ],

    // ── Topic Frequency (what user asks about most) ──
    topicFrequency: {
      type: Map,
      of: Number,
      default: {},
      // e.g., { "chest": 12, "shoulders": 8, "nutrition": 5, "injury": 3 }
    },

    // ── Feedback Stats ──
    totalFeedbacks: { type: Number, default: 0 },
    positiveFeedbacks: { type: Number, default: 0 },
    negativeFeedbacks: { type: Number, default: 0 },
    satisfactionRate: { type: Number, default: 0 }, // positive / total

    // ── Negative Feedback Patterns (what to avoid) ──
    dislikedPatterns: [
      {
        pattern: String, // e.g., "too long", "too vague", "wrong exercise"
        count: { type: Number, default: 1 },
      },
    ],

    // ── Conversation Summaries (compressed past sessions) ──
    sessionSummaries: [
      {
        sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "ChatSession" },
        summary: String,
        topics: [String],
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // ── Progress Tracking ──
    progressEntries: [
      {
        metric: String, // e.g., "bench_press_max", "body_weight", "squat_max"
        value: Number,
        unit: String,
        recordedAt: { type: Date, default: Date.now },
      },
    ],

    // ── Last Consolidation Run ──
    lastConsolidatedAt: { type: Date, default: null },
    lastDecayAppliedAt: { type: Date, default: null },

    // ── Analytics ──
    analytics: {
      memoryRetrievalHits: { type: Number, default: 0 },   // times memories were used
      memoryRetrievalMisses: { type: Number, default: 0 },  // times no relevant memory found
      totalTokensSaved: { type: Number, default: 0 },       // estimated tokens saved by compiler
      staleMemoriesRemoved: { type: Number, default: 0 },
      averageResponseSatisfaction: { type: Number, default: 0 },
      compiledContextUsageCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// ── Methods ──

// Record a new message interaction
userLearningProfileSchema.methods.recordInteraction = function (topics = []) {
  this.totalMessages += 1;

  // Update topic frequency
  for (const topic of topics) {
    const current = this.topicFrequency.get(topic) || 0;
    this.topicFrequency.set(topic, current + 1);
  }

  return this.save();
};

// Record feedback and update preference
userLearningProfileSchema.methods.recordFeedback = function (
  isPositive,
  responseLength,
  reason = null
) {
  this.totalFeedbacks += 1;
  if (isPositive) {
    this.positiveFeedbacks += 1;
    // Learn preferred response length from positive feedback
    if (responseLength === "short") this.shortResponseVotes += 1;
    if (responseLength === "detailed") this.detailedResponseVotes += 1;
  } else {
    this.negativeFeedbacks += 1;
    if (reason) {
      const existing = this.dislikedPatterns.find((p) => p.pattern === reason);
      if (existing) existing.count += 1;
      else this.dislikedPatterns.push({ pattern: reason, count: 1 });
    }
  }

  this.satisfactionRate =
    this.totalFeedbacks > 0 ? this.positiveFeedbacks / this.totalFeedbacks : 0;

  // Update preferred response length
  if (this.shortResponseVotes > this.detailedResponseVotes * 1.5) {
    this.preferredResponseLength = "short";
  } else if (this.detailedResponseVotes > this.shortResponseVotes * 1.5) {
    this.preferredResponseLength = "detailed";
  } else {
    this.preferredResponseLength = "medium";
  }

  return this.save();
};

// Add a session summary
userLearningProfileSchema.methods.addSessionSummary = function (
  sessionId,
  summary,
  topics
) {
  this.sessionSummaries.push({ sessionId, summary, topics });
  this.totalSessions += 1;
  if (this.totalMessages > 0 && this.totalSessions > 0) {
    this.avgMessagesPerSession = this.totalMessages / this.totalSessions;
  }
  // Keep only last 50 session summaries
  if (this.sessionSummaries.length > 50) {
    this.sessionSummaries = this.sessionSummaries.slice(-50);
  }
  return this.save();
};

// Get top topics
userLearningProfileSchema.methods.getTopTopics = function (limit = 5) {
  const entries = [...this.topicFrequency.entries()];
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, limit).map(([topic, count]) => ({ topic, count }));
};

// Build AI context string from learning profile
userLearningProfileSchema.methods.buildContextString = function () {
  const parts = [];

  // Response preference
  parts.push(`Preferred response style: ${this.preferredResponseLength}`);

  // Style dimensions
  if (this.styleProfile) {
    const sp = this.styleProfile;
    const styleParts = [];
    if (sp.verbosity < 0.3) styleParts.push("concise");
    else if (sp.verbosity > 0.7) styleParts.push("detailed");
    if (sp.technicality < 0.3) styleParts.push("casual");
    else if (sp.technicality > 0.7) styleParts.push("technical");
    if (sp.motivation < 0.3) styleParts.push("direct");
    else if (sp.motivation > 0.7) styleParts.push("motivational");
    if (styleParts.length > 0) {
      parts.push(`Style: ${styleParts.join(", ")}`);
    }
  }

  // Top topics
  const topTopics = this.getTopTopics(5);
  if (topTopics.length > 0) {
    parts.push(
      `Most asked topics: ${topTopics.map((t) => t.topic).join(", ")}`
    );
  }

  // Disliked patterns
  if (this.dislikedPatterns && this.dislikedPatterns.length > 0) {
    const avoid = this.dislikedPatterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((p) => p.pattern);
    parts.push(`User dislikes: ${avoid.join(", ")}`);
  }

  // Preferred patterns
  if (this.preferredPatterns && this.preferredPatterns.length > 0) {
    const likes = this.preferredPatterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((p) => p.pattern);
    parts.push(`User likes: ${likes.join(", ")}`);
  }

  // Recent session summaries (last 3)
  const recentSummaries = (this.sessionSummaries || []).slice(-3);
  if (recentSummaries.length > 0) {
    parts.push("Recent conversation topics:");
    for (const s of recentSummaries) {
      parts.push(`  - ${s.summary}`);
    }
  }

  return parts.join("\n");
};

const UserLearningProfile = mongoose.model("UserLearningProfile", userLearningProfileSchema);
export default UserLearningProfile;
