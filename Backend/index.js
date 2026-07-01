import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// ── JWT_SECRET validation ────────────────────────────────────────────
// The server MUST NOT start without a strong JWT secret.
// • Minimum 64 characters to resist brute-force attacks.
// • Never log the secret value itself.
// • Never generate a new secret automatically — require explicit config.
//
// Required .env variable:
//   JWT_SECRET=<64+ character cryptographically secure random string>
//
// NOTE: Apple App Store Privacy Policy URLs are configured in
//       **App Store Connect**, NOT in Info.plist or app.json.
//       Google Play Privacy Policy URLs are configured in the
//       **Google Play Console**. Do NOT add a custom PrivacyPolicy
//       key to app.json — it is invalid and will be ignored.
// ─────────────────────────────────────────────────────────────────────
const KNOWN_PLACEHOLDERS = [
  'your_jwt_secret_key',
  'your-jwt-secret',
  'changeme',
  'secret',
  'jwt_secret',
  'your_secret_key',
];

const jwtSecret = process.env.JWT_SECRET?.trim();

if (!jwtSecret) {
  console.error('[FATAL] JWT_SECRET is not set in environment variables. Server cannot start.');
  process.exit(1);
}

if (KNOWN_PLACEHOLDERS.includes(jwtSecret.toLowerCase())) {
  console.error('[FATAL] JWT_SECRET is set to a known placeholder value. Replace it with a secure random string (minimum 64 characters).');
  process.exit(1);
}

if (jwtSecret.length < 64) {
  console.error(`[FATAL] JWT_SECRET is too short (${jwtSecret.length} chars). Minimum required: 64 characters.`);
  process.exit(1);
}

console.log('[SECURITY] JWT_SECRET validated successfully.');

connectDB();

const app = express();
app.use(cors());

// Apple App Store Server Notifications v2 — Apple posts JWS-signed JSON.
// Webhook route is registered BEFORE express.json() because we need
// the raw body for JWS signature verification.
import { appleWebhook } from './routes/paymentsRoute.js';
app.post(
  '/api/payments/apple/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  appleWebhook
);

app.use(express.json({ limit: '10mb' }));

// Request logger — helps debug routing issues
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

import authRoute from './routes/authRoutes.js';
import foodRoute from './routes/foodRoute.js';
import burnRoute from './routes/burnRoute.js';
import aiRoute from './routes/aiRoute.js';
import analysisRoute from './routes/analysisRoute.js';
import chunkUploadRoute from './routes/chunkUploadRoute.js';
import videoUploadRoute from './routes/videoUploadRoute.js';
import adminAnalyticsRoute from './routes/adminAnalyticsRoute.js';
import workoutRoute from './routes/workoutRoute.js';
import userRoute from './routes/userRoute.js';
import caloriesRoute from './routes/caloriesRoute.js';
import stepsRoute from './routes/stepsRoute.js';
import featureRoute from './routes/featureRoute.js';
import searchRoute from './routes/searchRoute.js';
import bmiRoute from './routes/bmiRoute.js';
import notificationRoute from './routes/notificationRoute.js';
import bmbRoute from './routes/bmbRoute.js';
import dietRoute from './routes/dietRoute.js';
import workoutPlanRoute from './routes/workoutPlanRoute.js';
import subscriptionRoute from './routes/subscriptionRoute.js';
import exerciseRoute from './routes/exerciseRoute.js';
import paymentsRoute from './routes/paymentsRoute.js';
import streakRoute from './routes/streakRoute.js';
import { startSubscriptionSweeper } from './services/subscriptionSweeper.js';

app.use('/api/auth', authRoute);
app.use('/api/food', foodRoute);
app.use('/api/foods', foodRoute);
app.use('/api/burn', burnRoute);
app.use('/api/calories', caloriesRoute);
app.use('/api/steps', stepsRoute);
// V2 additive: chunked upload mounted BEFORE the analysis route so its more
// specific base path resolves cleanly; changes no existing route (Req 33, 52.2).
app.use('/api/ai/analysis/upload', chunkUploadRoute);
// Runtime pipeline: temporary server storage for recorded videos (raw upload +
// internal fetch by the AI worker). Mounted before the general analysis route.
app.use('/api/ai/analysis/media', videoUploadRoute);
app.use('/api/ai/analysis', analysisRoute);
app.use('/api/ai', aiRoute);
app.use('/api/workout', workoutRoute);
app.use('/api/user', userRoute);
app.use('/api/features', featureRoute);
app.use('/api/search', searchRoute);
app.use('/api/bmi', bmiRoute);
app.use('/api/notifications', notificationRoute);
app.use('/api/bmb', bmbRoute);
app.use('/api/diet', dietRoute);
app.use('/api/workout-plan', workoutPlanRoute);
app.use('/api/subscription', subscriptionRoute);
app.use('/api/exercises', exerciseRoute);
app.use('/api/payments', paymentsRoute);
app.use('/api/streaks', streakRoute);
// V2 additive: admin analytics dashboard (aggregate-only, admin-gated) (Req 46).
app.use('/api/admin/analytics', adminAnalyticsRoute);

app.get("/", (req, res) => {
    res.send("Welcome to GetFit!");
});

// Serve legal documents dynamically as HTML
// Note: App Store Privacy Policy URLs are configured in App Store Connect, not Info.plist
// Note: Google Play Privacy Policy URLs are configured in the Google Play Console
app.get("/legal/:doc", (req, res) => {
    try {
        const docRoute = req.params.doc;
        
        // Map clean URLs to actual markdown filenames
        const routeMap = {
            'privacy-policy': 'privacy-policy',
            'terms-of-use': 'terms-and-conditions',
            'eula': 'eula',
            'account-deletion': 'account-deletion-policy',
            'refund-policy': 'refund-and-subscription-policy',
            'ai-disclaimer': 'ai-disclaimer',
            'medical-disclaimer': 'medical-fitness-disclaimer'
        };

        const fileName = routeMap[docRoute] || docRoute;
        const filePath = path.join(__dirname, '../legal', `${fileName}.md`);
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).send("Document not found");
        }
        
        const markdown = fs.readFileSync(filePath, 'utf8');
        const htmlContent = marked.parse(markdown);
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GetFit - Legal Document</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        .container {
            background: #fff;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        h1 { color: #1FA463; border-bottom: 2px solid #eee; padding-bottom: 10px; }
        h2 { color: #222; margin-top: 30px; }
        h3 { color: #444; }
        a { color: #1FA463; text-decoration: none; }
        a:hover { text-decoration: underline; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; display: block; max-width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; min-width: 120px; }
        th { background-color: #f2f2f2; }
        blockquote { border-left: 4px solid #1FA463; margin: 0; padding-left: 15px; color: #555; }
        @media (max-width: 600px) {
            body { padding: 10px; }
            .container { padding: 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        ${htmlContent}
    </div>
</body>
</html>`;
        
        res.send(html);
    } catch (error) {
        console.error("Error serving legal doc:", error);
        res.status(500).send("Server Error");
    }
});

// Global Error Handler
// Catches all async promise rejections and synchronous throws
// Prevents node crash and ensures JSON responses for API routes
app.use((err, req, res, next) => {
    console.error('[Global Error]', err.stack || err.message || err);
    
    // If headers are already sent, we must delegate to the default Express handler
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    res.status(statusCode).json({
        success: false,
        error: message,
    });
});

const port = process.env.PORT || 5000;

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
    // Background subscription expiry sweeper. Disabled when
    // SUBSCRIPTION_SWEEPER_ENABLED=false (e.g. on non-leader workers).
    startSubscriptionSweeper();
});