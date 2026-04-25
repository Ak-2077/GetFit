import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Food from '../models/food.js';

dotenv.config();

const removeDuplicates = async () => {
  const stats = {
    totalBefore: 0,
    duplicatesByBarcode: 0,
    duplicatesByNameBrand: 0,
    totalRemoved: 0,
    totalAfter: 0,
  };

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    stats.totalBefore = await Food.countDocuments();
    console.log(`Total foods before cleanup: ${stats.totalBefore}\n`);

    // 1. Remove duplicates by barcode (keep oldest)
    console.log('🔍 Finding duplicates by barcode...');
    
    const barcodeAggregation = await Food.aggregate([
      {
        $match: {
          barcode: { $exists: true, $ne: '', $ne: null }
        }
      },
      {
        $group: {
          _id: '$barcode',
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    console.log(`Found ${barcodeAggregation.length} duplicate barcode groups\n`);

    for (const group of barcodeAggregation) {
      // Sort by createdAt and keep the oldest
      const sorted = group.docs.sort((a, b) => {
        const dateA = a.createdAt || new Date(0);
        const dateB = b.createdAt || new Date(0);
        return dateA - dateB;
      });

      // Remove all except the first (oldest)
      const toRemove = sorted.slice(1).map(doc => doc._id);
      
      if (toRemove.length > 0) {
        const result = await Food.deleteMany({ _id: { $in: toRemove } });
        stats.duplicatesByBarcode += result.deletedCount || 0;
        console.log(`  Removed ${result.deletedCount} duplicates for barcode: ${group._id}`);
      }
    }

    console.log(`\n✅ Removed ${stats.duplicatesByBarcode} duplicate foods by barcode\n`);

    // 2. Remove duplicates by name + brand + source (keep oldest)
    console.log('🔍 Finding duplicates by name + brand + source...');
    
    const nameAggregation = await Food.aggregate([
      {
        $match: {
          name: { $exists: true, $ne: '' }
        }
      },
      {
        $group: {
          _id: {
            name: '$name',
            brand: '$brand',
            source: '$source'
          },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt' } }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);

    console.log(`Found ${nameAggregation.length} duplicate name+brand+source groups\n`);

    for (const group of nameAggregation) {
      // Sort by createdAt and keep the oldest
      const sorted = group.docs.sort((a, b) => {
        const dateA = a.createdAt || new Date(0);
        const dateB = b.createdAt || new Date(0);
        return dateA - dateB;
      });

      // Remove all except the first (oldest)
      const toRemove = sorted.slice(1).map(doc => doc._id);
      
      if (toRemove.length > 0) {
        const result = await Food.deleteMany({ _id: { $in: toRemove } });
        stats.duplicatesByNameBrand += result.deletedCount || 0;
        console.log(`  Removed ${result.deletedCount} duplicates for: ${group._id.name} (${group._id.brand})`);
      }
    }

    console.log(`\n✅ Removed ${stats.duplicatesByNameBrand} duplicate foods by name+brand+source\n`);

    stats.totalRemoved = stats.duplicatesByBarcode + stats.duplicatesByNameBrand;
    stats.totalAfter = await Food.countDocuments();

    console.log('═══════════════════════════════════════');
    console.log('📊 CLEANUP SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`Total foods before:           ${stats.totalBefore}`);
    console.log(`Removed by barcode:           ${stats.duplicatesByBarcode}`);
    console.log(`Removed by name+brand+source: ${stats.duplicatesByNameBrand}`);
    console.log(`Total removed:                ${stats.totalRemoved}`);
    console.log(`Total foods after:            ${stats.totalAfter}`);
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error removing duplicates:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

removeDuplicates();
