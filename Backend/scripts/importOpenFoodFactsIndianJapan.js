import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Food from '../models/food.js';

dotenv.config();

const DEFAULT_CATEGORIES = [
  'rice',
  'noodles',
  'soups',
  'snacks',
  'frozen-foods',
  'beverages',
  'sauces',
  'spreads',
  'breakfast-cereals',
  'biscuits',
  'yogurts',
  'protein-bars',
];

const pageSize = Math.max(20, Math.min(200, Number(process.env.OFF_PAGE_SIZE || 100)));
const pagesPerCategory = Math.max(1, Number(process.env.OFF_IMPORT_PAGES || 60));
const delayMs = Math.max(0, Number(process.env.OFF_REQUEST_DELAY_MS || 120));
const targetCount = Math.max(1, Number(process.env.OFF_TARGET_COUNT || 1000));

const categories = (process.env.OFF_CATEGORIES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const selectedCategories = categories.length ? categories : DEFAULT_CATEGORIES;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toSafeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
};

const inferUnit = (servingSize, productName) => {
  const sizeText = String(servingSize || '').toLowerCase();
  const nameText = String(productName || '').toLowerCase();

  if (/(ml|milliliter|millilitre|liter|litre|fl\s?oz)/.test(sizeText)) return 'ml';
  if (/(g|gram|grams|kg)/.test(sizeText)) return 'g';
  if (/(juice|drink|soda|cola|water|beverage|milk|coffee|tea)/.test(nameText)) return 'ml';
  return 'g';
};

const isIndianOrJapanese = (product) => {
  const countriesTags = Array.isArray(product?.countries_tags) ? product.countries_tags.map(String) : [];
  const countriesText = String(product?.countries || '').toLowerCase();

  const fromTags = countriesTags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized.includes('india') || normalized.includes('japan');
  });

  const fromText = countriesText.includes('india') || countriesText.includes('japan');

  return fromTags || fromText;
};

const toFoodDoc = (product) => {
  const barcode = String(product?.code || '').trim();
  const name = (product?.product_name_en || product?.product_name || '').trim();

  if (!barcode || !name) return null;
  if (!isIndianOrJapanese(product)) return null;

  const servingSize = (product?.serving_size || '100g').trim();
  const nutriments = product?.nutriments || {};

  return {
    barcode,
    name,
    brand: String(product?.brands || 'Unknown Brand')
      .split(',')[0]
      .trim(),
    calories: toSafeNumber(nutriments['energy-kcal_100g'] ?? nutriments['energy-kcal'] ?? nutriments['energy-kcal_value']),
    protein: toSafeNumber(nutriments.proteins_100g ?? nutriments.proteins),
    carbs: toSafeNumber(nutriments.carbohydrates_100g ?? nutriments.carbohydrates),
    fat: toSafeNumber(nutriments.fat_100g ?? nutriments.fat),
    servingSize,
    unit: inferUnit(servingSize, name),
    source: 'openfoodfacts',
  };
};

const fetchCategoryPage = async (category, page) => {
  const params = new URLSearchParams({
    action: 'process',
    json: '1',
    page_size: String(pageSize),
    page: String(page),
    tagtype_0: 'categories',
    tag_contains_0: 'contains',
    tag_0: category,
  });

  const url = `https://world.openfoodfacts.org/cgi/search.pl?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OFF request failed (${response.status}) for ${category} page ${page}`);
  }

  const data = await response.json();
  return Array.isArray(data?.products) ? data.products : [];
};

const importIndianJapaneseFoods = async () => {
  const stats = {
    fetchedProducts: 0,
    validProducts: 0,
    inserted: 0,
    updated: 0,
    categoriesProcessed: 0,
  };

  let importedCount = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('Starting OpenFoodFacts import (India/Japan only)...');
    console.log(`Target foods: ${targetCount}`);
    console.log(`Categories: ${selectedCategories.length}`);
    console.log(`Pages/category: ${pagesPerCategory}`);
    console.log(`Page size: ${pageSize}`);

    for (const category of selectedCategories) {
      if (importedCount >= targetCount) break;

      console.log(`\nCategory: ${category}`);

      for (let page = 1; page <= pagesPerCategory; page += 1) {
        if (importedCount >= targetCount) break;

        let products = [];
        try {
          products = await fetchCategoryPage(category, page);
        } catch (error) {
          console.warn(`  ⚠ ${error.message}`);
          continue;
        }

        if (!products.length) {
          console.log(`  - page ${page}: no products (stop category)`);
          break;
        }

        stats.fetchedProducts += products.length;

        const docs = products
          .map(toFoodDoc)
          .filter(Boolean)
          .slice(0, targetCount - importedCount);

        if (!docs.length) {
          console.log(`  - page ${page}: fetched ${products.length}, matching 0`);
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }

        stats.validProducts += docs.length;

        const operations = docs.map((doc) => ({
          updateOne: {
            filter: { barcode: doc.barcode },
            update: { $set: doc },
            upsert: true,
          },
        }));

        const bulkResult = await Food.bulkWrite(operations, { ordered: false });

        const upserted = bulkResult.upsertedCount || 0;
        const updated = bulkResult.modifiedCount || 0;

        importedCount += docs.length;
        stats.inserted += upserted;
        stats.updated += updated;

        console.log(`  - page ${page}: fetched ${products.length}, matching ${docs.length}, upserted ${upserted}, updated ${updated}`);
        console.log(`  - progress: ${importedCount}/${targetCount}`);

        if (delayMs > 0) await sleep(delayMs);
      }

      stats.categoriesProcessed += 1;
    }

    const totalOpenFoodFacts = await Food.countDocuments({ source: 'openfoodfacts' });

    console.log('\n✅ OpenFoodFacts India/Japan import complete');
    console.log(`Categories processed: ${stats.categoriesProcessed}`);
    console.log(`Fetched products: ${stats.fetchedProducts}`);
    console.log(`Valid mapped products: ${stats.validProducts}`);
    console.log(`Requested target: ${targetCount}`);
    console.log(`Imported this run: ${importedCount}`);
    console.log(`Inserted: ${stats.inserted}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(`Total openfoodfacts in DB: ${totalOpenFoodFacts}`);

    if (importedCount < targetCount) {
      console.warn(`⚠ Could not reach ${targetCount}. Try increasing OFF_IMPORT_PAGES or OFF_CATEGORIES.`);
    }
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

importIndianJapaneseFoods();
