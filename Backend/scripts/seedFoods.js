import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Food from '../models/food.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

const sampleFoods = [
  {
    name: 'Chicken Breast',
    brand: "Tyson's",
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    barcode: '5901234123457',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Banana',
    brand: 'Fresh Produce',
    calories: 89,
    protein: 1.1,
    carbs: 23,
    fat: 0.3,
    barcode: '4011711710095',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Oats',
    brand: 'Quaker',
    calories: 389,
    protein: 16.9,
    carbs: 66.3,
    fat: 6.9,
    barcode: '43000100222',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Salmon',
    brand: 'Wild Caught',
    calories: 208,
    protein: 20,
    carbs: 0,
    fat: 13,
    barcode: '5012345678901',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Egg',
    brand: 'Farm Fresh',
    calories: 155,
    protein: 13,
    carbs: 1.1,
    fat: 11,
    barcode: '8412345612340',
    servingSize: '1 large (50g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Almonds',
    brand: 'Blue Diamond',
    calories: 579,
    protein: 21,
    carbs: 22,
    fat: 50,
    barcode: '074652014084',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Brown Rice',
    brand: 'Uncle Ben\'s',
    calories: 367,
    protein: 8,
    carbs: 77,
    fat: 3,
    barcode: '035200024937',
    servingSize: '100g (cooked ~150g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Broccoli',
    brand: 'Fresh Produce',
    calories: 34,
    protein: 2.8,
    carbs: 7,
    fat: 0.4,
    barcode: '4012345678900',
    servingSize: '100g',
    source: 'openfoodfacts',
  },
  {
    name: 'Milk (Whole)',
    brand: 'Organic Valley',
    calories: 61,
    protein: 3.2,
    carbs: 4.8,
    fat: 3.3,
    barcode: '049822100204',
    servingSize: '1 cup (240ml)',
    source: 'openfoodfacts',
  },
  {
    name: 'Peanut Butter (Creamy)',
    brand: 'Skippy',
    calories: 596,
    protein: 25,
    carbs: 18,
    fat: 52,
    barcode: '8901662024521',
    servingSize: '2 tbsp (32g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Peanut Butter',
    brand: 'Jif',
    calories: 588,
    protein: 25,
    carbs: 20,
    fat: 50,
    barcode: '051500776108',
    servingSize: '2 tbsp (32g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Peanut Butter Crunchy',
    brand: 'DiSano',
    calories: 200,
    protein: 8,
    carbs: 6,
    fat: 16,
    barcode: '8906047529530',
    servingSize: '32g',
    source: 'openfoodfacts',
  },
  {
    name: 'Whey Protein Powder',
    brand: 'Generic Nutrition',
    calories: 120,
    protein: 24,
    carbs: 3,
    fat: 2,
    barcode: '8901234567890',
    servingSize: '1 scoop (30g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Whey Protein Powder',
    brand: 'MuscleTech Nitro-Tech',
    calories: 130,
    protein: 24,
    carbs: 4,
    fat: 2.5,
    barcode: '0785034813405',
    servingSize: '1 scoop (33g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Mass Gainer',
    brand: 'Generic Nutrition',
    calories: 500,
    protein: 25,
    carbs: 85,
    fat: 5,
    barcode: '8901234567891',
    servingSize: '2 scoops (150g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Creatine Monohydrate',
    brand: 'Generic Nutrition',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    barcode: '8901234567892',
    servingSize: '5g',
    source: 'openfoodfacts',
  },
  {
    name: 'BCAA',
    brand: 'Generic Nutrition',
    calories: 10,
    protein: 0,
    carbs: 0,
    fat: 0,
    barcode: '8901234567893',
    servingSize: '1 scoop (7g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Omega 3 Fish Oil',
    brand: 'Generic Nutrition',
    calories: 10,
    protein: 0,
    carbs: 0,
    fat: 1,
    barcode: '8901234567894',
    servingSize: '1 softgel (1g)',
    source: 'openfoodfacts',
  },
  {
    name: 'Multivitamin',
    brand: 'Generic Nutrition',
    calories: 5,
    protein: 0,
    carbs: 1,
    fat: 0,
    barcode: '8901234567895',
    servingSize: '1 tablet',
    source: 'openfoodfacts',
  },
];

const seedFoods = async () => {
  try {
    const operations = sampleFoods.map((food) => {
      const normalizedBarcode = typeof food.barcode === 'string' ? food.barcode.trim() : '';

      const filter = normalizedBarcode
        ? { barcode: normalizedBarcode }
        : {
            name: food.name,
            brand: food.brand,
            source: food.source,
          };

      return {
        updateOne: {
          filter,
          update: { $set: food },
          upsert: true,
        },
      };
    });

    const result = await Food.bulkWrite(operations, { ordered: false });

    const totalFoods = await Food.countDocuments();
    const insertedCount = result.upsertedCount || 0;
    const modifiedCount = result.modifiedCount || 0;

    console.log(`✅ Seed sync complete`);
    console.log(`  - Upserted: ${insertedCount}`);
    console.log(`  - Updated: ${modifiedCount}`);
    console.log(`  - Total foods in DB: ${totalFoods}`);

    sampleFoods.forEach((food) => {
      console.log(`  - ${food.name} (Barcode: ${food.barcode || 'N/A'})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding foods:', error.message);
    process.exit(1);
  }
};

connectDB().then(() => {
  seedFoods();
});
