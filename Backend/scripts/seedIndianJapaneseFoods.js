import dotenv from 'dotenv';
import Food from '../models/food.js';
import connectDB from '../config/db.js';

dotenv.config();

const INDIAN_FOODS = [
  'Dal Tadka', 'Rajma Masala', 'Chole', 'Palak Paneer', 'Paneer Butter Masala',
  'Aloo Gobi', 'Baingan Bharta', 'Bhindi Masala', 'Vegetable Pulao', 'Jeera Rice',
  'Poha', 'Upma', 'Idli', 'Dosa', 'Sambar', 'Uttapam', 'Masala Khichdi',
  'Curd Rice', 'Lemon Rice', 'Chicken Curry', 'Butter Chicken', 'Tandoori Chicken',
  'Fish Curry', 'Egg Bhurji', 'Mutton Rogan Josh', 'Kadai Paneer', 'Methi Thepla',
  'Paratha', 'Roti', 'Missi Roti', 'Besan Chilla', 'Moong Dal Chilla', 'Pav Bhaji',
  'Bhel Puri', 'Sev Puri', 'Dhokla', 'Khandvi', 'Undhiyu', 'Avial', 'Thoran',
  'Lauki Sabzi', 'Tinda Masala', 'Matar Paneer', 'Paneer Bhurji', 'Masoor Dal',
  'Toor Dal', 'Kala Chana', 'Soya Chaap Curry', 'Vegetable Korma', 'Tomato Rasam'
];

const JAPANESE_FOODS = [
  'Sushi Rice Bowl', 'Salmon Sushi', 'Tuna Sushi', 'Maki Roll', 'Onigiri',
  'Chicken Teriyaki', 'Beef Teriyaki', 'Yakitori', 'Karaage', 'Tonkatsu',
  'Gyudon', 'Oyakodon', 'Katsudon', 'Miso Soup', 'Tofu Miso Soup', 'Ramen',
  'Shoyu Ramen', 'Miso Ramen', 'Udon', 'Soba', 'Tempura', 'Ebi Tempura',
  'Yasai Tempura', 'Okonomiyaki', 'Takoyaki', 'Yakisoba', 'Chahan', 'Omurice',
  'Natto Rice', 'Tamagoyaki', 'Edamame', 'Gyoza', 'Shabu Shabu', 'Sukiyaki',
  'Nikujaga', 'Hijiki Salad', 'Seaweed Salad', 'Kani Salad', 'Unagi Bowl',
  'Kaisen Don', 'Matcha Yogurt', 'Mochi', 'Daifuku', 'Kinpira Gobo',
  'Nasu Dengaku', 'Agedashi Tofu', 'Chawanmushi', 'Zaru Soba', 'Yudofu', 'Tsukemono'
];

const INDIAN_BRANDS = ['AiFit India Kitchen', 'Desi Meal Co.', 'Bharat Bites'];
const JAPANESE_BRANDS = ['AiFit Japan Kitchen', 'Nippon Meal Co.', 'Tokyo Bento Lab'];
const VARIANTS = ['Classic', 'Home Style', 'Lite', 'Protein Rich', 'Low Oil'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const randomFrom = (arr) => arr[randomInt(0, arr.length - 1)];

const parseArgs = () => {
  const args = process.argv.slice(2);
  const parsed = { count: 1000, dryRun: false };

  for (const arg of args) {
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg.startsWith('--count=')) {
      const raw = Number(arg.split('=')[1]);
      if (Number.isFinite(raw) && raw > 0) {
        parsed.count = Math.floor(raw);
      }
    }
  }

  return parsed;
};

const buildFood = (index) => {
  const cuisine = index % 2 === 0 ? 'Indian' : 'Japanese';
  const isIndian = cuisine === 'Indian';

  const baseName = isIndian ? randomFrom(INDIAN_FOODS) : randomFrom(JAPANESE_FOODS);
  const variant = randomFrom(VARIANTS);
  const brand = isIndian ? randomFrom(INDIAN_BRANDS) : randomFrom(JAPANESE_BRANDS);

  const calories = isIndian ? randomInt(110, 420) : randomInt(90, 390);
  const protein = isIndian ? randomInt(4, 28) : randomInt(5, 30);
  const carbs = isIndian ? randomInt(10, 60) : randomInt(8, 58);
  const fat = isIndian ? randomInt(2, 22) : randomInt(1, 20);

  const servingGram = randomFrom([80, 100, 120, 150, 180, 200]);

  return {
    name: `${baseName} (${cuisine}, ${variant})`,
    brand,
    calories,
    protein: clamp(protein, 0, 100),
    carbs: clamp(carbs, 0, 100),
    fat: clamp(fat, 0, 100),
    barcode: `AIFIT-IJ-${String(index + 1).padStart(6, '0')}`,
    servingSize: `${servingGram}g`,
    unit: 'g',
    source: 'custom',
  };
};

const main = async () => {
  const { count, dryRun } = parseArgs();
  const foods = Array.from({ length: count }, (_, index) => buildFood(index));

  if (dryRun) {
    const indianCount = foods.filter((food) => food.name.includes('(Indian,')).length;
    const japaneseCount = foods.filter((food) => food.name.includes('(Japanese,')).length;

    console.log(`Dry run successful. Generated ${foods.length} foods.`);
    console.log(`Indian foods: ${indianCount}`);
    console.log(`Japanese foods: ${japaneseCount}`);
    console.log('Sample records:', foods.slice(0, 5));
    process.exit(0);
  }

  await connectDB();

  try {
    const operations = foods.map((food) => ({
      updateOne: {
        filter: { barcode: food.barcode },
        update: { $set: food },
        upsert: true,
      },
    }));

    const result = await Food.bulkWrite(operations, { ordered: false });
    const totalFoods = await Food.countDocuments();

    console.log('✅ Indian/Japanese seed complete');
    console.log(`  - Requested: ${count}`);
    console.log(`  - Upserted: ${result.upsertedCount || 0}`);
    console.log(`  - Updated: ${result.modifiedCount || 0}`);
    console.log(`  - Total foods in DB: ${totalFoods}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding Indian/Japanese foods:', error.message);
    process.exit(1);
  }
};

main();
