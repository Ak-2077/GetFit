import mongoose from 'mongoose';

const foodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    brand: String,
    category: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['food', 'supplement'],
      default: 'food',
      index: true,
    },
    calories: {
      type: Number,
      required: true,
    },
    protein: Number,
    carbs: Number,
    fat: Number,
    fiber: {
      type: Number,
      default: 0,
    },
    sugar: {
      type: Number,
      default: 0,
    },
    barcode: {
      type: String,
    },
    origin: String,
    servingSize: {
      type: String,
      default: '',
      trim: true,
    },
    servingUnit: {
      type: String,
      default: 'g',
    },
    // Keep legacy field for backward compatibility with existing code.
    unit: {
      type: String,
      default: 'g',
    },
    searchKeywords: {
      type: [String],
      default: [],
    },
    source: {
      type: String,
      enum: ['user', 'openfoodfacts', 'custom'],
      default: 'custom',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true,
    },
  },
  { timestamps: true }
);

foodSchema.index({ name: 'text', brand: 'text' });
foodSchema.index({ barcode: 1 }, { sparse: true });
foodSchema.index({ searchKeywords: 1 });

export default mongoose.model('Food', foodSchema);
