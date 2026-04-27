import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dns from 'node:dns';
import dotenv from 'dotenv';
import Food from '../models/food.js';

dotenv.config();

const DATASET_FILE = process.env.SUPPLEMENTS_DATASET || 'supplements_dataset_v2.csv';
const DATASET_PATH = path.resolve(process.cwd(), 'scripts', DATASET_FILE);

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
    console.warn(`Using fallback DNS servers: ${fallbackServers.join(', ')}`);
  } catch (error) {
    console.warn('Failed to apply fallback DNS servers:', error.message);
  }
};

const splitCsvLine = (line) => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const normalizeBarcode = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/e\+?/i.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return String(Math.round(numeric));
  }

  return raw.replace(/[^0-9]/g, '');
};

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const inferFoodType = (category, name) => {
  const text = `${category || ''} ${name || ''}`.toLowerCase();
  return /(protein|supplement|creatine|bcaa|gainer|vitamin|pre\s?workout|omega)/.test(text) ? 'supplement' : 'food';
};

const extractSearchKeywords = (record) => {
  const joined = [record.name, record.brand, record.category, record.type].join(' ').toLowerCase();
  return Array.from(new Set(joined.split(/[^a-z0-9]+/).filter((token) => token.length >= 2))).slice(0, 50);
};

const parseDataset = (rawText) => {
  const lines = rawText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  const records = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row = {};

    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? '';
    });

    records.push(row);
  }

  return records;
};

const toFoodDoc = (row) => {
  const name = String(row.name || '').trim();
  if (!name) return null;

  const brand = String(row.brand || '').trim();
  const category = String(row.category || 'general').trim().toLowerCase();
  const barcode = normalizeBarcode(row.barcode);
  const servingSize = String(row.serving_size || row.servingSize || '').trim();
  const servingUnit = String(row.unit || 'g').trim().toLowerCase() || 'g';
  const type = inferFoodType(category, name);

  const foodDoc = {
    name,
    brand,
    barcode: barcode || undefined,
    servingSize,
    servingUnit,
    unit: servingUnit,
    calories: toSafeNumber(row.calories),
    protein: toSafeNumber(row.protein),
    carbs: toSafeNumber(row.carbs),
    fat: toSafeNumber(row.fat),
    fiber: toSafeNumber(row.fiber),
    sugar: toSafeNumber(row.sugar),
    category,
    type,
    source: 'custom',
    origin: String(row.origin || '').trim(),
  };

  foodDoc.searchKeywords = extractSearchKeywords(foodDoc);

  return foodDoc;
};

const ensureIndexes = async () => {
  try {
    await Food.collection.dropIndex('barcode_1');
  } catch (error) {
    if (error.codeName !== 'IndexNotFound') {
      console.warn('Could not drop old barcode index:', error.message);
    }
  }

  await Food.syncIndexes();
};

const run = async () => {
  try {
    if (!fs.existsSync(DATASET_PATH)) {
      throw new Error(`Dataset file not found: ${DATASET_PATH}`);
    }

    ensureResolvableDns();
    await mongoose.connect(process.env.MONGO_URI);
    await ensureIndexes();

    const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
    const rows = parseDataset(raw);
    const docs = rows.map(toFoodDoc).filter(Boolean);

    if (!docs.length) {
      console.log('No valid records found in dataset.');
      process.exit(0);
    }

    const operations = docs.map((doc) => {
      const hasBarcode = typeof doc.barcode === 'string' && doc.barcode.length > 0;
      const filter = hasBarcode
        ? { name: doc.name, brand: doc.brand, barcode: doc.barcode }
        : { name: doc.name, brand: doc.brand, category: doc.category, source: doc.source };

      return {
        updateOne: {
          filter,
          update: { $set: doc },
          upsert: true,
        },
      };
    });

    const result = await Food.bulkWrite(operations, { ordered: false });
    const total = await Food.countDocuments();

    console.log('Supplements dataset import complete');
    console.log(`Rows parsed: ${rows.length}`);
    console.log(`Rows valid: ${docs.length}`);
    console.log(`Upserted: ${result.upsertedCount || 0}`);
    console.log(`Updated: ${result.modifiedCount || 0}`);
    console.log(`Total foods in DB: ${total}`);

    process.exit(0);
  } catch (error) {
    console.error('Import failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

run();
