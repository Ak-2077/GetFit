import path from 'node:path';
import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

const root = path.resolve(process.cwd());
const envCandidates = [
  path.join(root, '.env'),
  path.join(root, 'Backend', '.env'),
];

for (const envPath of envCandidates) {
  dotenv.config({ path: envPath, override: false });
  if (typeof process.env.MONGO_URI === 'string' && process.env.MONGO_URI.trim()) {
    break;
  }
}

const base = 'http://localhost:5000';

const ensureResolvableDns = () => {
  const currentServers = dns.getServers();
  const localhostOnly =
    currentServers.length === 0 ||
    currentServers.every((server) => server === '127.0.0.1' || server === '::1');

  if (!localhostOnly) return;

  const fallbackServers = (process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!fallbackServers.length) return;

  try {
    dns.setServers(fallbackServers);
  } catch {
    // best-effort only for smoke test connectivity
  }
};

const request = async (label, url, options = {}) => {
  const res = await fetch(url, options);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  console.log(`${label} -> ${res.status}`);
  return { status: res.status, body };
};

const main = async () => {
  ensureResolvableDns();
  await mongoose.connect(process.env.MONGO_URI);

  const user = await mongoose.connection.collection('users').findOne({});
  if (!user) {
    console.log('SMOKE_FAIL: no users found in DB');
    process.exit(2);
  }

  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const s1 = await request('GET /api/calories/today', `${base}/api/calories/today`, { headers });
  const s2 = await request('GET /api/calories/macros', `${base}/api/calories/macros`, { headers });
  const s3 = await request('GET /api/calories/weekly', `${base}/api/calories/weekly`, { headers });
  const s4 = await request('GET /api/calories/burn', `${base}/api/calories/burn`, { headers });
  const s5 = await request('GET /api/steps/today', `${base}/api/steps/today`, { headers });
  const search = await request('GET /api/foods/search?q=whey', `${base}/api/foods/search?q=whey&limit=5`, { headers });

  let foodId = null;
  let barcode = null;

  if (Array.isArray(search.body) && search.body.length > 0) {
    foodId = search.body[0]._id;
    barcode = search.body[0].barcode || null;
  }

  if (foodId) {
    await request('GET /api/foods/:id', `${base}/api/foods/${foodId}`, { headers });
    await request('POST /api/calories/log', `${base}/api/calories/log`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ foodId, servings: 1, mealType: 'snacks' }),
    });
    await request('GET /api/calories/today (after log)', `${base}/api/calories/today`, { headers });

    if (barcode) {
      await request('GET /api/foods/barcode/:code', `${base}/api/foods/barcode/${barcode}`, { headers });
    }
  } else {
    console.log('SMOKE_WARN: no food result for whey search');
  }

  const statuses = [s1, s2, s3, s4, s5, search].map((entry) => entry.status);
  const ok = statuses.every((code) => code >= 200 && code < 300);
  console.log(`SMOKE_SUMMARY: ${ok ? 'PASS' : 'PARTIAL'}`);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('SMOKE_FAIL:', error.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors during failure cleanup
  }
  process.exit(1);
});
