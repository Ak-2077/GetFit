import mongoose from 'mongoose';

const foodOntologySchema = new mongoose.Schema({
  // ═══ IDENTITY ═══
  dishName: { type: String, required: true, index: true },
  dishNameLower: { type: String, required: true, unique: true, index: true },
  category: {
    type: String,
    enum: ['ingredient', 'cooked', 'prepared', 'beverage', 'dessert', 'snack'],
    required: true, index: true,
  },
  subcategory: { type: String, default: '' }, // "egg dish", "rice dish"

  // ═══ ONTOLOGY TREE ═══
  parentFood: { type: String, default: '', index: true }, // "egg" for "omelet"
  childFoods: [{ type: String }], // ["cheese omelet", "masala omelet"]
  ingredients: [{ type: String }], // ["egg", "butter", "oil"]
  primaryIngredient: { type: String, default: '', index: true },

  // ═══ VISUAL RECOGNITION ═══
  visualCues: [{ type: String }], // ["folded", "golden", "flat"]
  cookingStyles: [{ type: String }], // ["pan fried", "folded"]
  synonyms: [{ type: String }], // ["omelette", "omlet"]

  // ═══ CUISINE & TAGS ═══
  cuisines: [{ type: String }], // ["indian", "american"]
  tags: [{ type: String }], // ["breakfast", "protein", "quick", "gym"]

  // ═══ SEARCH KEYWORDS ═══
  usdaKeyword: { type: String, default: '' },
  offKeyword: { type: String, default: '' },
  getfitKeyword: { type: String, default: '' },

  // ═══ PORTION DEFAULTS ═══
  defaultGrams: {
    small: { type: Number, default: 80 },
    medium: { type: Number, default: 150 },
    large: { type: Number, default: 250 },
  },

  // ═══ NUTRITION REFERENCE (per 100g) ═══
  caloriesPer100g: { type: Number, default: 0 },
  proteinPer100g: { type: Number, default: 0 },
  carbsPer100g: { type: Number, default: 0 },
  fatPer100g: { type: Number, default: 0 },
  fiberPer100g: { type: Number, default: 0 },

  // ═══ CONFIDENCE MODIFIERS ═══
  // Map of visual cue → confidence boost/penalty
  // e.g. { "folded": 0.15, "golden": 0.10, "flat": -0.05 }
  confidenceModifiers: { type: Map, of: Number, default: {} },

  // ═══ META ═══
  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 50 }, // 1-100, higher = preferred in ties
}, { timestamps: true });

// Compound indexes for fast ontology queries
foodOntologySchema.index({ parentFood: 1, isActive: 1 });
foodOntologySchema.index({ 'ingredients': 1 });
foodOntologySchema.index({ 'tags': 1 });
foodOntologySchema.index({ 'cuisines': 1 });
foodOntologySchema.index({ 'synonyms': 1 });
foodOntologySchema.index({ category: 1, isActive: 1 });

// Text index for search
foodOntologySchema.index({
  dishName: 'text',
  synonyms: 'text',
  tags: 'text',
  ingredients: 'text',
});

const FoodOntology = mongoose.model('FoodOntology', foodOntologySchema);
export default FoodOntology;
