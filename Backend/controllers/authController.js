import jwt from 'jsonwebtoken';
import twilio from 'twilio';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import User from '../models/user.js';
import Otp from '../models/otp.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const SEND_LIMIT_WINDOW_MS = 60 * 1000;
const VERIFY_LIMIT_WINDOW_MS = 60 * 1000;
const SEND_LIMIT_MAX = 3;
const VERIFY_LIMIT_MAX = 6;

const sendOtpRateMap = new Map();
const verifyOtpRateMap = new Map();
const sendEmailOtpRateMap = new Map();
const verifyEmailOtpRateMap = new Map();

function getTwilioConfig() {
  const sid = process.env.TWILIO_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE;
  const client = sid && authToken ? twilio(sid, authToken) : null;
  return { client, fromPhone };
}

function getEmailConfig() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  const transporter = smtpHost && smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      })
    : null;

  return { transporter, smtpFrom };
}

function normalizePhone(phoneRaw) {
  if (typeof phoneRaw !== 'string') return '';
  const trimmed = phoneRaw.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('+')) {
    const sanitized = `+${trimmed.slice(1).replace(/\D/g, '')}`;
    return sanitized;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }
  return '';
}

function isValidIndianPhone(phone) {
  return /^\+91\d{10}$/.test(phone);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanupRateMap(map, now) {
  for (const [key, data] of map.entries()) {
    if (data.resetAt <= now) {
      map.delete(key);
    }
  }
}

function isRateLimited(map, key, limit, windowMs) {
  const now = Date.now();
  cleanupRateMap(map, now);

  const data = map.get(key);
  if (!data || data.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (data.count >= limit) {
    return true;
  }

  data.count += 1;
  return false;
}

function signToken(userId) {
  const jwtSecret = process.env.JWT_SECRET?.toString().trim().replace(/^['"]|['"]$/g, '');
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d').toString().trim();

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign({ id: userId }, jwtSecret, { expiresIn });
}

export async function sendOtp(req, res) {
  try {
    const { client: twilioClient, fromPhone: twilioPhone } = getTwilioConfig();
    const normalizedPhone = normalizePhone(req.body?.phone);
    if (!normalizedPhone || !isValidIndianPhone(normalizedPhone)) {
      return res.status(400).json({ message: 'Please provide a valid Indian phone number' });
    }

    const rateKey = `send:${normalizedPhone}:${req.ip || 'unknown'}`;
    if (isRateLimited(sendOtpRateMap, rateKey, SEND_LIMIT_MAX, SEND_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many OTP requests. Please wait and try again.' });
    }

    const otp = createOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await Otp.deleteMany({ target: normalizedPhone, channel: 'phone' });
    await Otp.create({ target: normalizedPhone, channel: 'phone', otp, expiresAt });

    if (!twilioClient || !twilioPhone) {
      console.warn('Twilio is not configured. OTP SMS was not sent.');
      return res.status(500).json({ message: 'OTP provider is not configured' });
    }

    await twilioClient.messages.create({
      body: `Your GetFit OTP is ${otp}. It expires in 5 minutes.`,
      from: twilioPhone,
      to: normalizedPhone,
    });

    return res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send OTP' });
  }
}

export async function verifyOtp(req, res) {
  try {
    const normalizedPhone = normalizePhone(req.body?.phone);
    const otpRaw = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!normalizedPhone || !isValidIndianPhone(normalizedPhone)) {
      return res.status(400).json({ message: 'Please provide a valid Indian phone number' });
    }

    if (!/^\d{6}$/.test(otpRaw)) {
      return res.status(400).json({ message: 'OTP must be 6 digits' });
    }

    const rateKey = `verify:${normalizedPhone}:${req.ip || 'unknown'}`;
    if (isRateLimited(verifyOtpRateMap, rateKey, VERIFY_LIMIT_MAX, VERIFY_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many verification attempts. Please wait and try again.' });
    }

    const otpDoc = await Otp.findOne({ target: normalizedPhone, channel: 'phone' }).sort({ createdAt: -1 });
    if (!otpDoc) {
      return res.status(400).json({ message: 'OTP not found. Please request a new OTP.' });
    }

    if (otpDoc.expiresAt.getTime() < Date.now()) {
      await Otp.deleteMany({ target: normalizedPhone, channel: 'phone' });
      return res.status(400).json({ message: 'OTP expired. Please request a new OTP.' });
    }

    if (otpDoc.otp !== otpRaw) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    await Otp.deleteMany({ target: normalizedPhone, channel: 'phone' });

    let user = await User.findOne({ phone: normalizedPhone });
    if (!user) {
      user = await User.create({ phone: normalizedPhone, role: 'user', authProvider: 'phone' });
    }

    const token = signToken(user._id);

    return res.json({
      message: 'OTP verified successfully',
      token,
      user: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to verify OTP' });
  }
}

export async function sendEmailOtp(req, res) {
  try {
    const { transporter: emailTransporter, smtpFrom } = getEmailConfig();
    const email = normalizeEmail(req.body?.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    const rateKey = `send-email:${email}:${req.ip || 'unknown'}`;
    if (isRateLimited(sendEmailOtpRateMap, rateKey, SEND_LIMIT_MAX, SEND_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many OTP requests. Please wait and try again.' });
    }

    if (!emailTransporter || !smtpFrom) {
      return res.status(500).json({ message: 'Email provider is not configured' });
    }

    const otp = createOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await Otp.deleteMany({ target: email, channel: 'email' });
    await Otp.create({ target: email, channel: 'email', otp, expiresAt });

    await emailTransporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'Your GetFit OTP',
      text: `Your GetFit OTP is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your GetFit OTP is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
    });

    return res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send OTP' });
  }
}

export async function verifyEmailOtp(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const otpRaw = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    if (!/^\d{6}$/.test(otpRaw)) {
      return res.status(400).json({ message: 'OTP must be 6 digits' });
    }

    const rateKey = `verify-email:${email}:${req.ip || 'unknown'}`;
    if (isRateLimited(verifyEmailOtpRateMap, rateKey, VERIFY_LIMIT_MAX, VERIFY_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many verification attempts. Please wait and try again.' });
    }

    const otpDoc = await Otp.findOne({ target: email, channel: 'email' }).sort({ createdAt: -1 });
    if (!otpDoc) {
      return res.status(400).json({ message: 'OTP not found. Please request a new OTP.' });
    }

    if (otpDoc.expiresAt.getTime() < Date.now()) {
      await Otp.deleteMany({ target: email, channel: 'email' });
      return res.status(400).json({ message: 'OTP expired. Please request a new OTP.' });
    }

    if (otpDoc.otp !== otpRaw) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    await Otp.deleteMany({ target: email, channel: 'email' });

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ email, role: 'user', authProvider: 'email' });
    }

    const token = signToken(user._id);

    return res.json({
      message: 'OTP verified successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to verify OTP' });
  }
}

export async function emailPasswordAuth(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    let user = await User.findOne({ email });

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await User.create({
        email,
        name,
        password: hashedPassword,
        role: 'user',
        authProvider: 'email_password',
      });
    } else {
      if (!user.password) {
        return res.status(400).json({
          message: 'This email is already linked to a different sign-in method.',
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
    }

    const token = signToken(user._id);

    return res.json({
      message: 'Email authentication successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Email authentication failed' });
  }
}



// =============================
// GET CURRENT USER
// =============================
export async function me(req, res) {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}


// =============================
// UPDATE PROFILE
// =============================
export async function updateProfile(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { name, height, weight, goal, targetWeight, goalTimelineWeeks, activityPreference, dietPreference, activityLevel, moveTarget, moveCurrent, steps, stepDistanceKm, avatar } = req.body;

    const update = { };
    if (name !== undefined) update.name = name;
    if (height !== undefined) update.height = height;
    if (weight !== undefined) update.weight = weight;
    if (goal !== undefined) update.goal = goal;
    if (targetWeight !== undefined) update.targetWeight = targetWeight;
    if (goalTimelineWeeks !== undefined) update.goalTimelineWeeks = goalTimelineWeeks;
    if (activityPreference !== undefined) update.activityPreference = activityPreference;
    if (dietPreference !== undefined) update.dietPreference = dietPreference;
    if (activityLevel !== undefined) update.activityLevel = activityLevel;
    if (moveTarget !== undefined) update.moveTarget = moveTarget;
    if (moveCurrent !== undefined) update.moveCurrent = moveCurrent;
    if (steps !== undefined) update.steps = steps;
    if (stepDistanceKm !== undefined) update.stepDistanceKm = stepDistanceKm;
    if (avatar !== undefined) update.avatar = avatar;

    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Profile updated', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

// =============================
// FORGOT PASSWORD
// =============================
export async function forgotPassword(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(user._id, { password: hashedPassword });

    return res.json({ message: 'Password reset successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Password reset failed' });
  }
}

// =============================
// SEND PROFILE EMAIL OTP (auth required)
// =============================
export async function sendProfileEmailOtp(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { transporter: emailTransporter, smtpFrom } = getEmailConfig();
    const email = normalizeEmail(req.body?.email);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    // Check if email is already taken by another user
    const existing = await User.findOne({ email, _id: { $ne: userId } });
    if (existing) {
      return res.status(409).json({ message: 'This email is already linked to another account' });
    }

    const rateKey = `profile-email:${userId}:${req.ip || 'unknown'}`;
    if (isRateLimited(sendEmailOtpRateMap, rateKey, SEND_LIMIT_MAX, SEND_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many OTP requests. Please wait and try again.' });
    }

    if (!emailTransporter || !smtpFrom) {
      return res.status(500).json({ message: 'Email provider is not configured' });
    }

    const otp = createOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await Otp.deleteMany({ target: email, channel: 'email' });
    await Otp.create({ target: email, channel: 'email', otp, expiresAt });

    await emailTransporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'Verify your GetFit email',
      text: `Your GetFit verification code is ${otp}. It expires in 5 minutes.`,
      html: `<p>Your GetFit verification code is <strong>${otp}</strong>. It expires in 5 minutes.</p>`,
    });

    return res.json({ message: 'Verification code sent successfully' });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to send verification code' });
  }
}

// =============================
// VERIFY PROFILE EMAIL OTP (auth required)
// =============================
export async function verifyProfileEmailOtp(req, res) {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const email = normalizeEmail(req.body?.email);
    const otpRaw = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: 'Please provide a valid email address' });
    }

    if (!/^\d{6}$/.test(otpRaw)) {
      return res.status(400).json({ message: 'OTP must be 6 digits' });
    }

    const rateKey = `profile-verify-email:${userId}:${req.ip || 'unknown'}`;
    if (isRateLimited(verifyEmailOtpRateMap, rateKey, VERIFY_LIMIT_MAX, VERIFY_LIMIT_WINDOW_MS)) {
      return res.status(429).json({ message: 'Too many verification attempts. Please wait and try again.' });
    }

    const otpDoc = await Otp.findOne({ target: email, channel: 'email' }).sort({ createdAt: -1 });
    if (!otpDoc) {
      return res.status(400).json({ message: 'OTP not found. Please request a new code.' });
    }

    if (otpDoc.expiresAt.getTime() < Date.now()) {
      await Otp.deleteMany({ target: email, channel: 'email' });
      return res.status(400).json({ message: 'OTP expired. Please request a new code.' });
    }

    if (otpDoc.otp !== otpRaw) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    await Otp.deleteMany({ target: email, channel: 'email' });

    // Save verified email to user
    const user = await User.findByIdAndUpdate(
      userId,
      { email, emailVerified: true },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({ message: 'Email verified successfully', user });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to verify email' });
  }
}

