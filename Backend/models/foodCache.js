import mongoose from 'mongoose';

const foodCacheSchema = new mongoose.Schema(
  {
    barcode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
    },
    brand: {
      type: String,
      default: '',
    },
    calories: {
      type: Number,
      default: 0,
    },
    protein: {
      type: Number,
      default: 0,
    },
    carbs: {
      type: Number,
      default: 0,
    },
    fat: {
      type: Number,
      default: 0,
    },
    fiber: {
      type: Number,
      default: 0,
    },
    sugar: {
      type: Number,
      default: 0,
    },
    sodium: {
      type: Number,
      default: 0,
    },
    servingSize: {
      type: String,
      default: '100g',
    },
    servingUnit: {
      type: String,
      default: 'g',
    },
    ingredients: {
      type: String,
      default: '',
    },
    image: {
      type: String,
      default: '',
    },
    origin: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      default: 'general',
    },
    type: {
      type: String,
      enum: ['food', 'supplement'],
      default: 'food',
    },
    source: {
      type: String,
      enum: ['openfoodfacts', 'usda', 'user'],
      default: 'openfoodfacts',
    },
    searchCount: {
      type: Number,
      default: 1,
    },
    lastSearchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// TTL index: auto-delete documents 30 days after last update
foodCacheSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Text index for search
foodCacheSchema.index({ productName: 'text', brand: 'text' });

export default mongoose.model('FoodCache', foodCacheSchema);
