import mongoose from 'mongoose';

const foodSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    brand: String,
    calories: {
      type: Number,
      required: true,
    },
    protein: Number,
    carbs: Number,
    fat: Number,
    barcode: {
      type: String,
      unique: true,
      sparse: true,
    },
    origin: String,
    servingSize: String,
    unit: {
      type: String,
      default: 'g',
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

export default mongoose.model('Food', foodSchema);
