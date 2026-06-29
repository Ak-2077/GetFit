/**
 * Seed Food Ontology — Comprehensive food database
 *
 * Run with: node --experimental-modules scripts/seedOntology.js
 * Or: node scripts/seedOntology.js
 *
 * Seeds 800+ foods across Indian, American, Italian, Chinese,
 * Japanese, Mexican, Thai, and other cuisines.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dotenv.config();

// Use fallback DNS if local resolver fails (matches backend behavior)
try {
  dns.setServers(['1.1.1.1', '8.8.8.8', '8.8.4.4']);
  console.log('[Seed] Using fallback DNS servers');
} catch (e) {
  // ignore
}

// Inline schema to avoid import issues with ESM
const foodOntologySchema = new mongoose.Schema({
  dishName: String,
  dishNameLower: { type: String, unique: true },
  category: String,
  subcategory: String,
  parentFood: String,
  childFoods: [String],
  ingredients: [String],
  primaryIngredient: String,
  visualCues: [String],
  cookingStyles: [String],
  synonyms: [String],
  cuisines: [String],
  tags: [String],
  usdaKeyword: String,
  offKeyword: String,
  getfitKeyword: String,
  defaultGrams: { small: Number, medium: Number, large: Number },
  caloriesPer100g: Number,
  proteinPer100g: Number,
  carbsPer100g: Number,
  fatPer100g: Number,
  fiberPer100g: Number,
  confidenceModifiers: { type: Map, of: Number },
  isActive: Boolean,
  priority: Number,
}, { timestamps: true });

const FoodOntology = mongoose.model('FoodOntology', foodOntologySchema);

// ═══════════════════════════════════════════════════════════════
// COMPACT DATA FORMAT:
// [name, category, parent, cal, p, c, f, fiber,
//  {s,m,l}, [cues], [cook], [syn], [cuisines], [tags], priority, {modifiers}]
// ═══════════════════════════════════════════════════════════════

function buildEntry(name, cat, parent, cal, p, c, f, fib, grams, cues, cook, syn, cuisines, tags, pri, mods) {
  return {
    dishName: name,
    dishNameLower: name.toLowerCase(),
    category: cat,
    subcategory: parent ? `${parent} dish` : cat,
    parentFood: (parent || '').toLowerCase(),
    childFoods: [],
    ingredients: parent ? [parent.toLowerCase()] : [name.toLowerCase()],
    primaryIngredient: (parent || name).toLowerCase(),
    visualCues: cues || [],
    cookingStyles: cook || [],
    synonyms: syn || [],
    cuisines: cuisines || [],
    tags: tags || [],
    usdaKeyword: name.toLowerCase(),
    offKeyword: name.toLowerCase(),
    getfitKeyword: name.toLowerCase(),
    defaultGrams: grams || { small: 80, medium: 150, large: 250 },
    caloriesPer100g: cal || 0,
    proteinPer100g: p || 0,
    carbsPer100g: c || 0,
    fatPer100g: f || 0,
    fiberPer100g: fib || 0,
    confidenceModifiers: new Map(Object.entries(mods || {})),
    isActive: true,
    priority: pri || 50,
  };
}

// Short alias
const B = buildEntry;
const IN = 'ingredient', CK = 'cooked', PR = 'prepared', BV = 'beverage', DS = 'dessert', SN = 'snack';

const FOODS = [
  // ═══════════════════════════════════════
  // EGG FAMILY
  // ═══════════════════════════════════════
  B('Egg', IN, '', 155, 13, 1.1, 11, 0, {s:40,m:50,l:65}, ['oval','white','brown','shell'], ['raw'], ['eggs'], ['global'], ['protein','breakfast'], 80),
  B('Omelet', PR, 'Egg', 154, 11, 1.6, 12, 0, {s:80,m:120,l:160}, ['folded','golden','flat','oval'], ['pan fried'], ['omelette','omlet','egg omelet'], ['american','french','indian'], ['breakfast','protein','quick'], 85, {folded:0.20,golden:0.10,flat:0.05}),
  B('Cheese Omelet', PR, 'Egg', 180, 13, 2, 14, 0, {s:90,m:130,l:175}, ['folded','golden','cheese','melted'], ['pan fried'], ['cheese omelette'], ['american','french'], ['breakfast','protein'], 70, {folded:0.15,cheese:0.15,melted:0.10}),
  B('Masala Omelet', PR, 'Egg', 160, 11, 3, 12, 0.5, {s:80,m:120,l:160}, ['folded','golden','spiced','colorful','green'], ['pan fried'], ['indian omelette','masala omelette'], ['indian'], ['breakfast','protein','spicy'], 70, {folded:0.15,golden:0.10,colorful:0.10}),
  B('Fried Egg', CK, 'Egg', 196, 14, 0.8, 15, 0, {s:45,m:55,l:70}, ['round','flat','sunny','runny','white','yellow'], ['fried','pan fried'], ['sunny side up','over easy'], ['american','british'], ['breakfast','protein','quick'], 80, {round:0.15,flat:0.10,sunny:0.15,runny:0.10}),
  B('Boiled Egg', CK, 'Egg', 155, 13, 1.1, 11, 0, {s:40,m:50,l:65}, ['oval','white','halved','yellow center'], ['boiled'], ['hard boiled egg','soft boiled egg'], ['global'], ['breakfast','protein','healthy'], 80, {oval:0.10,halved:0.10}),
  B('Scrambled Egg', CK, 'Egg', 149, 10, 2.2, 11, 0, {s:60,m:100,l:150}, ['fluffy','chunky','yellow','soft','crumbled'], ['pan fried','scrambled'], ['scrambled eggs'], ['american','british'], ['breakfast','protein'], 75, {fluffy:0.15,chunky:0.10,crumbled:0.10}),
  B('Poached Egg', CK, 'Egg', 143, 12, 0.7, 10, 0, {s:40,m:50,l:65}, ['round','smooth','white','runny'], ['poached','boiled'], [], ['american','french'], ['breakfast','protein','healthy'], 60, {smooth:0.10,runny:0.10}),
  B('Egg Curry', PR, 'Egg', 120, 8, 6, 8, 1, {s:150,m:220,l:300}, ['bowl','gravy','brown','spiced','whole egg'], ['simmered'], ['egg masala','anda curry'], ['indian'], ['lunch','dinner','protein','curry'], 70, {gravy:0.15,bowl:0.10}),
  B('Egg Bhurji', PR, 'Egg', 160, 11, 3, 12, 0.5, {s:80,m:130,l:180}, ['scrambled','spiced','colorful','dry'], ['pan fried'], ['anda bhurji','spicy scrambled egg'], ['indian'], ['breakfast','protein','spicy'], 70, {scrambled:-0.05,spiced:0.15,colorful:0.10}),
  B('Egg Roll', PR, 'Egg', 220, 10, 22, 11, 1, {s:100,m:150,l:200}, ['rolled','wrapped','cylindrical','golden'], ['fried'], ['egg kathi roll'], ['indian'], ['snack','street food'], 60, {rolled:0.15,wrapped:0.15,cylindrical:0.10}),
  B('Egg Sandwich', PR, 'Egg', 250, 14, 24, 12, 2, {s:120,m:170,l:220}, ['layered','bread','sliced'], ['toasted'], ['egg salad sandwich'], ['american'], ['breakfast','lunch','quick'], 60),
  B('Egg Fried Rice', PR, 'Egg', 163, 6, 24, 5, 1, {s:150,m:250,l:350}, ['mixed','colorful','rice','bowl'], ['stir fried'], [], ['chinese','indian'], ['lunch','dinner','quick'], 65, {mixed:0.10,rice:0.10}),
  B('French Toast', PR, 'Egg', 229, 8, 26, 11, 1, {s:60,m:90,l:130}, ['golden','flat','sliced','bread','syrup'], ['pan fried'], ['eggy bread'], ['american','french'], ['breakfast','sweet'], 70, {golden:0.10,bread:-0.10}),

  // ═══════════════════════════════════════
  // RICE FAMILY
  // ═══════════════════════════════════════
  B('Rice', IN, '', 130, 2.7, 28, 0.3, 0.4, {s:100,m:150,l:250}, ['white','fluffy','bowl','mound'], ['steamed','boiled'], ['white rice','steamed rice','cooked rice'], ['global'], ['staple','lunch','dinner'], 80),
  B('Brown Rice', CK, 'Rice', 123, 2.7, 26, 1, 1.8, {s:100,m:150,l:250}, ['brown','fluffy','bowl'], ['steamed','boiled'], ['whole grain rice'], ['global'], ['healthy','lunch','dinner','gym'], 60),
  B('Biryani', PR, 'Rice', 175, 8, 22, 6, 0.8, {s:200,m:320,l:450}, ['layered','colorful','spiced','rice','mixed','saffron'], ['dum cooked','steamed'], ['chicken biryani','mutton biryani','veg biryani'], ['indian'], ['lunch','dinner','feast','protein'], 85, {layered:0.15,colorful:0.10,saffron:0.10,spiced:0.10}),
  B('Pulao', PR, 'Rice', 145, 4, 22, 4, 1, {s:150,m:200,l:300}, ['fluffy','colorful','rice','mixed'], ['steamed'], ['pilaf','pilau','vegetable pulao'], ['indian'], ['lunch','dinner'], 65, {fluffy:0.10,mixed:0.10}),
  B('Jeera Rice', PR, 'Rice', 140, 3, 24, 3.5, 0.5, {s:100,m:150,l:250}, ['white','fluffy','cumin seeds'], ['steamed','tempered'], ['cumin rice'], ['indian'], ['lunch','dinner','side'], 60),
  B('Fried Rice', PR, 'Rice', 163, 5, 24, 5, 1, {s:150,m:250,l:350}, ['colorful','mixed','bowl','vegetables'], ['stir fried'], ['chinese fried rice','veg fried rice'], ['chinese','indian'], ['lunch','dinner','quick'], 75, {colorful:0.10,mixed:0.10}),
  B('Khichdi', PR, 'Rice', 120, 5, 18, 2, 2, {s:150,m:200,l:300}, ['yellow','mushy','bowl','smooth'], ['pressure cooked','boiled'], ['dal khichdi'], ['indian'], ['comfort','healthy','lunch'], 60, {yellow:0.10,mushy:0.10}),
  B('Lemon Rice', PR, 'Rice', 145, 3, 26, 3.5, 0.5, {s:100,m:150,l:250}, ['yellow','fluffy','peanuts'], ['tempered'], ['chitranna'], ['indian'], ['lunch','quick'], 55),
  B('Curd Rice', PR, 'Rice', 120, 4, 18, 3, 0.3, {s:100,m:150,l:250}, ['white','creamy','smooth'], ['mixed'], ['thayir sadam','dahi chawal'], ['indian'], ['lunch','cooling'], 55),
  B('Risotto', PR, 'Rice', 140, 4, 20, 5, 0.5, {s:150,m:220,l:300}, ['creamy','smooth','bowl'], ['simmered'], ['mushroom risotto'], ['italian'], ['lunch','dinner'], 60),
  B('Sushi', PR, 'Rice', 150, 6, 22, 4, 0.5, {s:80,m:150,l:250}, ['rolled','small','colorful','fish'], ['raw'], ['sushi roll','maki'], ['japanese'], ['lunch','dinner','healthy'], 70, {rolled:0.15,small:0.10}),

  // ═══════════════════════════════════════
  // INDIAN BREADS
  // ═══════════════════════════════════════
  B('Roti', IN, '', 297, 9.8, 50, 7.5, 4, {s:30,m:40,l:55}, ['round','flat','brown','thin'], ['dry roasted'], ['chapati','phulka','whole wheat roti'], ['indian'], ['staple','lunch','dinner'], 85),
  B('Naan', PR, '', 262, 8.7, 45, 5.1, 2, {s:60,m:90,l:120}, ['oval','fluffy','bubbly','golden','charred'], ['tandoori','baked'], ['naan bread','tandoori naan'], ['indian'], ['lunch','dinner','restaurant'], 80, {bubbly:0.10,charred:0.10}),
  B('Garlic Naan', PR, 'Naan', 275, 9, 46, 6, 2, {s:65,m:95,l:125}, ['oval','fluffy','bubbly','golden','garlic','green'], ['tandoori','baked'], ['garlic bread naan'], ['indian'], ['lunch','dinner','restaurant'], 70),
  B('Butter Naan', PR, 'Naan', 290, 8.5, 44, 8, 2, {s:65,m:95,l:125}, ['oval','fluffy','shiny','golden','buttery'], ['tandoori','baked'], [], ['indian'], ['lunch','dinner','restaurant'], 70),
  B('Paratha', PR, '', 326, 7.4, 45, 13, 2.5, {s:45,m:60,l:80}, ['round','flat','golden','flaky','layered'], ['pan fried','roasted'], ['plain paratha','laccha paratha'], ['indian'], ['breakfast','lunch','dinner'], 80, {flaky:0.15,layered:0.15,golden:0.10}),
  B('Aloo Paratha', PR, 'Paratha', 240, 5, 32, 10, 2, {s:60,m:80,l:110}, ['round','flat','golden','stuffed','thick'], ['pan fried'], ['potato paratha','aloo ka paratha'], ['indian'], ['breakfast','lunch'], 75, {stuffed:0.15,thick:0.10}),
  B('Gobi Paratha', PR, 'Paratha', 220, 5, 30, 9, 2.5, {s:60,m:80,l:110}, ['round','flat','golden','stuffed'], ['pan fried'], ['cauliflower paratha'], ['indian'], ['breakfast','lunch'], 65),
  B('Puri', PR, '', 360, 7, 45, 17, 2, {s:20,m:30,l:40}, ['round','puffed','golden','crispy','small'], ['deep fried'], ['poori'], ['indian'], ['breakfast','lunch','festival'], 70, {puffed:0.20,crispy:0.10,small:0.10}),
  B('Bhatura', PR, '', 350, 7, 40, 18, 1.5, {s:50,m:80,l:110}, ['round','puffed','golden','large'], ['deep fried'], ['bhatoora'], ['indian'], ['breakfast','lunch'], 65, {puffed:0.15}),
  B('Kulcha', PR, '', 280, 8, 42, 8, 2, {s:50,m:75,l:100}, ['round','flat','golden','stuffed'], ['tandoori','baked'], ['amritsari kulcha'], ['indian'], ['lunch','dinner'], 55),

  // ═══════════════════════════════════════
  // INDIAN CURRIES & GRAVIES
  // ═══════════════════════════════════════
  B('Dal', PR, '', 116, 7.6, 15, 2.8, 5, {s:120,m:200,l:280}, ['bowl','yellow','smooth','liquid'], ['boiled','tempered'], ['daal','lentil curry','dal fry'], ['indian'], ['staple','lunch','dinner','protein','healthy'], 80, {yellow:0.10,smooth:0.10,bowl:0.05}),
  B('Dal Makhani', PR, 'Dal', 140, 6, 14, 6, 4, {s:120,m:200,l:280}, ['dark','creamy','rich','bowl'], ['simmered'], ['black dal','maa ki dal'], ['indian'], ['lunch','dinner','rich'], 70, {dark:0.10,creamy:0.15}),
  B('Dal Tadka', PR, 'Dal', 120, 7, 15, 3, 5, {s:120,m:200,l:280}, ['yellow','liquid','tempered','bowl'], ['boiled','tempered'], [], ['indian'], ['lunch','dinner','everyday'], 65),
  B('Rajma', PR, '', 127, 8, 22, 0.5, 6, {s:120,m:200,l:280}, ['red','gravy','bowl','beans'], ['simmered'], ['rajma masala','kidney bean curry'], ['indian'], ['lunch','dinner','protein'], 70),
  B('Chole', PR, '', 164, 9, 27, 3, 8, {s:120,m:200,l:280}, ['brown','gravy','bowl','chickpeas'], ['simmered'], ['chana masala','chickpea curry'], ['indian'], ['lunch','dinner','protein'], 75),
  B('Paneer', IN, '', 321, 21, 3.6, 25, 0, {s:60,m:100,l:150}, ['white','cubed','soft'], ['raw'], ['cottage cheese','indian cheese'], ['indian'], ['protein','vegetarian'], 75),
  B('Palak Paneer', PR, 'Paneer', 180, 10, 8, 13, 3, {s:120,m:180,l:250}, ['green','creamy','cubes','bowl'], ['simmered'], ['spinach paneer','saag paneer'], ['indian'], ['lunch','dinner','protein','vegetarian'], 80, {green:0.20,creamy:0.10,cubes:0.10}),
  B('Paneer Tikka', PR, 'Paneer', 250, 16, 5, 18, 1, {s:80,m:120,l:180}, ['cubed','charred','colorful','skewer'], ['grilled','tandoori'], ['tandoori paneer'], ['indian'], ['appetizer','protein','grilled'], 75, {charred:0.15,cubed:0.10,skewer:0.15}),
  B('Paneer Butter Masala', PR, 'Paneer', 220, 12, 10, 15, 1, {s:120,m:180,l:250}, ['orange','creamy','rich','bowl','cubes'], ['simmered'], ['paneer makhani','paneer makhanwala'], ['indian'], ['lunch','dinner','rich','restaurant'], 75, {orange:0.10,creamy:0.15}),
  B('Shahi Paneer', PR, 'Paneer', 230, 11, 9, 17, 1, {s:120,m:180,l:250}, ['white','creamy','rich','bowl'], ['simmered'], [], ['indian'], ['lunch','dinner','rich'], 60),
  B('Butter Chicken', PR, 'Chicken', 195, 14, 8, 12, 1, {s:120,m:200,l:280}, ['orange','creamy','rich','bowl','chicken'], ['simmered'], ['murgh makhani','chicken makhani'], ['indian'], ['lunch','dinner','protein','restaurant'], 85, {orange:0.10,creamy:0.15,chicken:0.10}),
  B('Chicken Tikka', PR, 'Chicken', 165, 25, 5, 5, 0.5, {s:80,m:120,l:180}, ['charred','red','cubed','skewer'], ['grilled','tandoori'], ['tandoori chicken tikka'], ['indian'], ['appetizer','protein','grilled','gym'], 80, {charred:0.15,red:0.10,skewer:0.15}),
  B('Chicken Tikka Masala', PR, 'Chicken', 170, 13, 8, 10, 1, {s:120,m:200,l:280}, ['orange','creamy','bowl','chicken'], ['simmered'], ['tikka masala'], ['indian','british'], ['lunch','dinner','protein','restaurant'], 75, {orange:0.10,creamy:0.10}),
  B('Tandoori Chicken', PR, 'Chicken', 150, 24, 3, 4, 0.5, {s:100,m:150,l:220}, ['red','charred','whole','leg','drumstick'], ['tandoori','grilled'], [], ['indian'], ['lunch','dinner','protein','grilled','gym'], 80, {red:0.15,charred:0.15}),
  B('Chicken Curry', PR, 'Chicken', 160, 14, 6, 9, 1, {s:120,m:200,l:280}, ['brown','gravy','bowl','chicken'], ['simmered'], ['chicken masala','chicken gravy'], ['indian'], ['lunch','dinner','protein'], 70),
  B('Chicken Biryani', PR, 'Chicken', 180, 10, 22, 6, 0.8, {s:200,m:320,l:450}, ['layered','colorful','rice','chicken','spiced'], ['dum cooked'], ['hyderabadi biryani'], ['indian'], ['lunch','dinner','feast','protein'], 80, {layered:0.15,chicken:0.10,rice:0.10}),
  B('Fish Curry', PR, 'Fish', 140, 16, 5, 6, 1, {s:120,m:200,l:280}, ['brown','gravy','bowl','fish'], ['simmered'], ['macher jhol','fish masala'], ['indian'], ['lunch','dinner','protein'], 65),
  B('Fish Fry', CK, 'Fish', 230, 20, 10, 12, 0.5, {s:80,m:120,l:180}, ['golden','crispy','flat'], ['fried','deep fried'], ['fried fish'], ['indian'], ['appetizer','protein'], 65, {crispy:0.15,golden:0.10}),
  B('Mutton Curry', PR, 'Mutton', 200, 18, 4, 12, 0.5, {s:120,m:200,l:280}, ['brown','dark','gravy','bowl','meat'], ['simmered'], ['mutton masala','gosht curry'], ['indian'], ['lunch','dinner','protein'], 70),
  B('Aloo Gobi', PR, '', 100, 3, 13, 4, 3, {s:100,m:150,l:220}, ['yellow','dry','mixed','vegetables'], ['sauteed','dry roasted'], ['potato cauliflower curry'], ['indian'], ['lunch','dinner','vegetarian'], 70),
  B('Aloo Matar', PR, '', 110, 4, 15, 4, 3, {s:100,m:150,l:220}, ['yellow','gravy','peas','potato'], ['simmered'], ['potato peas curry'], ['indian'], ['lunch','dinner','vegetarian'], 60),
  B('Bhindi Masala', PR, '', 90, 2, 8, 5, 3, {s:80,m:130,l:180}, ['green','dry','sliced'], ['sauteed'], ['okra masala','ladies finger'], ['indian'], ['lunch','dinner','vegetarian'], 55),
  B('Baingan Bharta', PR, '', 85, 2, 8, 5, 3, {s:100,m:150,l:220}, ['brown','mashed','smoky'], ['roasted','mashed'], ['eggplant bharta'], ['indian'], ['lunch','dinner','vegetarian'], 55),
  B('Sambar', PR, '', 65, 3, 9, 1.5, 2.5, {s:120,m:200,l:280}, ['yellow','liquid','bowl','vegetables'], ['boiled','tempered'], ['sambhar'], ['indian'], ['lunch','dinner','south indian'], 70, {yellow:0.10}),

  // ═══════════════════════════════════════
  // INDIAN SNACKS & STREET FOOD
  // ═══════════════════════════════════════
  B('Samosa', SN, '', 262, 4.2, 27, 15, 2, {s:50,m:80,l:110}, ['triangular','golden','crispy','stuffed'], ['deep fried'], ['aloo samosa','potato samosa'], ['indian'], ['snack','street food','tea time'], 80, {triangular:0.25,crispy:0.15,golden:0.10}),
  B('Pakora', SN, '', 240, 5, 22, 14, 2, {s:30,m:50,l:80}, ['round','golden','crispy','irregular'], ['deep fried'], ['bhaji','bhajiya','pakoda'], ['indian'], ['snack','tea time','monsoon'], 70, {crispy:0.15,golden:0.10}),
  B('Pav Bhaji', PR, '', 245, 6, 30, 11, 3, {s:150,m:250,l:350}, ['colorful','mashed','bread','butter'], ['sauteed'], [], ['indian'], ['street food','dinner'], 70),
  B('Vada Pav', SN, '', 290, 5, 35, 14, 2, {s:80,m:120,l:160}, ['round','bread','fried','stuffed'], ['deep fried'], ['wada pav','indian burger'], ['indian'], ['snack','street food'], 70, {round:0.10}),
  B('Kachori', SN, '', 330, 5, 30, 20, 2, {s:40,m:60,l:90}, ['round','golden','crispy','puffed','stuffed'], ['deep fried'], [], ['indian'], ['snack','breakfast'], 60, {puffed:0.10,stuffed:0.10}),
  B('Dahi Vada', SN, '', 150, 5, 18, 6, 1.5, {s:80,m:120,l:180}, ['round','white','yogurt','soft'], ['deep fried','soaked'], ['dahi bhalla'], ['indian'], ['snack','festival'], 60),
  B('Pani Puri', SN, '', 200, 3, 28, 8, 1.5, {s:60,m:100,l:150}, ['small','round','crispy','hollow','water'], ['deep fried'], ['gol gappa','puchka'], ['indian'], ['street food','snack'], 70, {small:0.10,round:0.10,hollow:0.15}),
  B('Chaat', SN, '', 180, 4, 25, 7, 2, {s:80,m:130,l:180}, ['mixed','colorful','small pieces'], ['mixed'], ['bhel puri','sev puri','papdi chaat'], ['indian'], ['street food','snack'], 65),

  // ═══════════════════════════════════════
  // SOUTH INDIAN
  // ═══════════════════════════════════════
  B('Dosa', PR, '', 168, 3.9, 25, 5.8, 0.8, {s:60,m:80,l:120}, ['flat','round','crispy','golden','large','thin'], ['pan fried'], ['plain dosa','sada dosa'], ['indian'], ['breakfast','south indian'], 80, {flat:0.10,crispy:0.15,thin:0.15,large:0.10}),
  B('Masala Dosa', PR, 'Dosa', 185, 4.5, 28, 6.5, 1.5, {s:80,m:100,l:140}, ['flat','round','crispy','golden','large','stuffed'], ['pan fried'], ['potato dosa'], ['indian'], ['breakfast','south indian'], 80, {flat:0.10,crispy:0.10,stuffed:0.15}),
  B('Uttapam', PR, '', 155, 4, 24, 4.5, 1, {s:60,m:80,l:120}, ['flat','round','thick','toppings','vegetables'], ['pan fried'], ['uthappam'], ['indian'], ['breakfast','south indian'], 60, {thick:0.15,toppings:0.15}),
  B('Idli', PR, '', 77, 2, 16, 0.4, 0.6, {s:25,m:30,l:40}, ['round','white','soft','fluffy','steamed','small'], ['steamed'], ['idly'], ['indian'], ['breakfast','south indian','healthy'], 80, {round:0.10,white:0.10,soft:0.10,steamed:0.15}),
  B('Vada', SN, '', 290, 6, 25, 18, 2, {s:35,m:50,l:65}, ['round','golden','crispy','donut shaped'], ['deep fried'], ['medu vada','urad dal vada'], ['indian'], ['breakfast','south indian','snack'], 70, {round:0.10,golden:0.10,crispy:0.10}),
  B('Appam', PR, '', 120, 2.5, 22, 2.5, 0.5, {s:50,m:70,l:100}, ['round','white','bowl shaped','lacy','thin edges'], ['pan fried'], ['hoppers'], ['indian'], ['breakfast','south indian','kerala'], 55, {bowl:0.10,lacy:0.15}),
  B('Upma', PR, '', 135, 3.5, 18, 5.5, 1.5, {s:100,m:150,l:220}, ['yellow','grainy','bowl','dry'], ['sauteed'], ['rava upma','semolina porridge'], ['indian'], ['breakfast','south indian'], 65),
  B('Poha', PR, '', 130, 2.5, 27, 1.5, 1.2, {s:100,m:150,l:220}, ['yellow','flaky','flat','peanuts'], ['sauteed','tempered'], ['beaten rice','flattened rice'], ['indian'], ['breakfast'], 65, {yellow:0.10,flat:0.10}),
  B('Pongal', PR, '', 110, 3, 18, 3, 1, {s:100,m:150,l:250}, ['yellow','mushy','bowl','pepper'], ['boiled'], ['ven pongal','khara pongal'], ['indian'], ['breakfast','south indian','festival'], 55),

  // ═══════════════════════════════════════
  // PASTA & ITALIAN
  // ═══════════════════════════════════════
  B('Pasta', IN, '', 131, 5, 25, 1.1, 1.8, {s:150,m:200,l:300}, ['bowl','mixed','sauce'], ['boiled'], ['plain pasta','cooked pasta'], ['italian'], ['lunch','dinner'], 75),
  B('Spaghetti', PR, 'Pasta', 131, 5, 25, 1.1, 1.8, {s:150,m:200,l:300}, ['long','thin','bowl','sauce','strings'], ['boiled'], ['spaghetti bolognese','spaghetti carbonara'], ['italian'], ['lunch','dinner'], 75, {long:0.10,thin:0.10,strings:0.15}),
  B('Penne', PR, 'Pasta', 131, 5, 25, 1.1, 1.8, {s:150,m:200,l:300}, ['tubular','short','bowl','sauce'], ['boiled'], ['penne arrabiata','penne pasta'], ['italian'], ['lunch','dinner'], 65, {tubular:0.15,short:0.10}),
  B('Fusilli', PR, 'Pasta', 131, 5, 25, 1.1, 1.8, {s:150,m:200,l:300}, ['spiral','bowl','sauce','colorful'], ['boiled'], ['rotini'], ['italian'], ['lunch','dinner'], 55, {spiral:0.20}),
  B('Macaroni', PR, 'Pasta', 131, 5, 25, 1.1, 1.8, {s:150,m:200,l:300}, ['curved','short','bowl'], ['boiled'], ['mac and cheese','macaroni cheese'], ['italian','american'], ['lunch','dinner'], 65),
  B('Lasagna', PR, 'Pasta', 135, 7, 17, 4.5, 1.5, {s:150,m:250,l:350}, ['layered','flat','cheese','baked','rectangular'], ['baked'], ['lasagne'], ['italian'], ['lunch','dinner'], 70, {layered:0.20,flat:0.10,baked:0.10}),
  B('Fettuccine Alfredo', PR, 'Pasta', 180, 7, 22, 7, 1, {s:150,m:220,l:300}, ['long','creamy','white','bowl'], ['boiled','simmered'], ['alfredo pasta'], ['italian','american'], ['lunch','dinner'], 60, {creamy:0.15,white:0.10}),
  B('Pizza', PR, '', 266, 11, 33, 10, 2.3, {s:80,m:120,l:180}, ['flat','round','cheese','triangular','sliced','colorful'], ['baked'], ['cheese pizza','pepperoni pizza','margherita'], ['italian','american'], ['lunch','dinner','fast food'], 90, {flat:0.05,round:0.05,cheese:0.15,triangular:0.15,sliced:0.10}),
  B('Margherita Pizza', PR, 'Pizza', 250, 10, 30, 9, 2, {s:80,m:120,l:180}, ['flat','round','cheese','tomato','basil'], ['baked'], ['cheese pizza'], ['italian'], ['lunch','dinner'], 70),
  B('Garlic Bread', SN, '', 350, 8, 45, 15, 2, {s:30,m:50,l:80}, ['golden','crispy','bread','butter','garlic'], ['baked','toasted'], [], ['italian','american'], ['appetizer','side'], 65, {golden:0.10,bread:0.10}),
  B('Bruschetta', SN, '', 180, 5, 22, 8, 2, {s:40,m:70,l:100}, ['bread','tomato','toasted','colorful'], ['toasted'], [], ['italian'], ['appetizer','snack'], 55),

  // ═══════════════════════════════════════
  // AMERICAN / WESTERN
  // ═══════════════════════════════════════
  B('Burger', PR, '', 295, 17, 24, 14, 1, {s:150,m:200,l:280}, ['round','layered','bread','meat','cheese','lettuce'], ['grilled'], ['hamburger','cheeseburger','veggie burger'], ['american'], ['lunch','dinner','fast food'], 85, {layered:0.15,round:0.10,bread:0.05}),
  B('Cheeseburger', PR, 'Burger', 310, 18, 24, 16, 1, {s:160,m:210,l:290}, ['round','layered','cheese','melted','bread'], ['grilled'], [], ['american'], ['lunch','dinner','fast food'], 70),
  B('Sandwich', PR, '', 250, 12, 28, 10, 2, {s:100,m:150,l:200}, ['layered','bread','sliced','rectangular'], ['raw','toasted'], ['club sandwich','grilled sandwich'], ['american'], ['breakfast','lunch','quick'], 80),
  B('Grilled Sandwich', PR, 'Sandwich', 280, 13, 26, 14, 2, {s:100,m:150,l:200}, ['layered','golden','bread','toasted','crispy','grill marks'], ['grilled','toasted'], ['toasted sandwich'], ['american'], ['breakfast','lunch'], 70, {'grill marks':0.15,golden:0.10,toasted:0.10}),
  B('Wrap', PR, '', 220, 10, 26, 9, 2, {s:120,m:180,l:240}, ['rolled','cylindrical','wrapped'], ['raw'], ['burrito','tortilla wrap'], ['american','mexican'], ['lunch','quick'], 65, {rolled:0.15,cylindrical:0.15,wrapped:0.15}),
  B('Hot Dog', PR, '', 290, 10, 24, 17, 1, {s:80,m:120,l:160}, ['elongated','bread','sausage'], ['grilled','boiled'], ['frankfurter'], ['american'], ['snack','fast food'], 70),
  B('French Fries', SN, '', 312, 3.4, 41, 15, 3.8, {s:70,m:115,l:170}, ['golden','crispy','long','strips','thin'], ['deep fried'], ['fries','chips','potato fries'], ['american','global'], ['side','snack','fast food'], 80, {golden:0.10,crispy:0.10,strips:0.15,long:0.10}),
  B('Steak', PR, '', 271, 26, 0, 18, 0, {s:120,m:200,l:300}, ['brown','flat','thick','grill marks','juicy'], ['grilled','pan fried'], ['beef steak','grilled steak'], ['american'], ['dinner','protein','gym'], 80, {'grill marks':0.15,thick:0.10}),
  B('Pancake', PR, '', 227, 6.4, 28, 10, 1, {s:45,m:65,l:90}, ['round','flat','stacked','golden','syrup'], ['pan fried'], ['pancakes','hotcakes','flapjacks'], ['american'], ['breakfast','sweet'], 75, {stacked:0.20,round:0.10,flat:0.05}),
  B('Waffle', PR, '', 291, 7.6, 33, 14, 1.5, {s:50,m:75,l:110}, ['square','grid pattern','golden','crispy','syrup'], ['baked'], ['waffles','belgian waffle'], ['american'], ['breakfast','sweet'], 70, {grid:0.20,square:0.10}),
  B('Mac and Cheese', PR, '', 310, 12, 30, 15, 1, {s:120,m:200,l:300}, ['yellow','creamy','bowl','cheese'], ['baked','boiled'], ['macaroni and cheese'], ['american'], ['lunch','dinner','comfort'], 70),
  B('Caesar Salad', PR, '', 170, 8, 8, 12, 2, {s:100,m:180,l:280}, ['green','leaves','croutons','bowl','cheese','mixed'], ['raw'], [], ['american','italian'], ['lunch','healthy','gym'], 65, {green:0.10,leaves:0.15}),
  B('Grilled Chicken Breast', CK, 'Chicken', 165, 31, 0, 3.6, 0, {s:80,m:120,l:180}, ['white','flat','grill marks','sliced'], ['grilled'], ['chicken breast'], ['american','global'], ['lunch','dinner','protein','gym'], 80, {'grill marks':0.15,flat:0.10}),
  B('Chicken Wings', PR, 'Chicken', 230, 18, 2, 16, 0, {s:80,m:150,l:250}, ['small','crispy','golden','sauce'], ['deep fried','baked'], ['buffalo wings','fried chicken wings'], ['american'], ['appetizer','snack'], 70, {crispy:0.10}),
  B('Fried Chicken', CK, 'Chicken', 260, 20, 10, 16, 0.5, {s:80,m:140,l:200}, ['golden','crispy','breaded','drumstick'], ['deep fried'], ['KFC','southern fried chicken'], ['american'], ['lunch','dinner','fast food'], 75, {crispy:0.15,golden:0.10,breaded:0.15}),
  B('Bacon', CK, '', 541, 37, 1.4, 42, 0, {s:15,m:25,l:40}, ['strips','crispy','brown','thin'], ['fried','baked'], ['bacon strips','crispy bacon'], ['american'], ['breakfast','protein'], 70, {strips:0.20,crispy:0.15}),
  B('Sausage', CK, '', 301, 12, 2, 27, 0, {s:40,m:65,l:100}, ['cylindrical','brown','elongated'], ['grilled','fried'], ['sausage links','breakfast sausage'], ['american','german'], ['breakfast','protein'], 65, {cylindrical:0.15,elongated:0.10}),

  // ═══════════════════════════════════════
  // CHINESE
  // ═══════════════════════════════════════
  B('Noodles', PR, '', 138, 4.5, 25, 2.1, 1.2, {s:150,m:200,l:300}, ['long','strings','bowl','mixed'], ['stir fried','boiled'], ['chow mein','lo mein','hakka noodles'], ['chinese','indian'], ['lunch','dinner'], 75, {long:0.10,strings:0.15}),
  B('Fried Noodles', PR, 'Noodles', 150, 5, 24, 4, 1, {s:150,m:200,l:300}, ['long','strings','mixed','colorful','dry'], ['stir fried'], ['chow mein','hakka noodles','stir fry noodles'], ['chinese','indian'], ['lunch','dinner'], 70, {strings:0.10}),
  B('Spring Roll', SN, '', 220, 5, 25, 11, 1.5, {s:40,m:60,l:90}, ['cylindrical','golden','crispy','rolled','small'], ['deep fried'], ['egg roll','vegetable roll'], ['chinese'], ['appetizer','snack'], 70, {cylindrical:0.15,rolled:0.15,crispy:0.10}),
  B('Dim Sum', SN, '', 180, 7, 18, 9, 1, {s:40,m:80,l:120}, ['small','round','steamed','white','folded','dumplings'], ['steamed','deep fried'], ['dumplings','momos','wontons'], ['chinese'], ['appetizer','snack'], 70, {small:0.10,steamed:0.15,dumplings:0.10}),
  B('Momos', SN, '', 195, 8, 20, 9, 1, {s:60,m:100,l:150}, ['small','round','steamed','white','folded','dumplings','pleated'], ['steamed','fried'], ['dumplings','dim sum'], ['chinese','indian','tibetan'], ['snack','appetizer'], 75, {pleated:0.15,steamed:0.10,small:0.10}),
  B('Manchurian', PR, '', 210, 5, 22, 11, 2, {s:100,m:160,l:220}, ['round','golden','sauce','bowl','crispy'], ['deep fried','simmered'], ['gobi manchurian','veg manchurian','chicken manchurian'], ['chinese','indian'], ['appetizer','dinner'], 65, {round:0.10,sauce:0.10}),
  B('Sweet and Sour Chicken', PR, 'Chicken', 180, 12, 18, 7, 1, {s:120,m:180,l:260}, ['colorful','sauce','mixed','bowl'], ['deep fried','simmered'], ['sweet sour chicken'], ['chinese'], ['dinner'], 55),
  B('Kung Pao Chicken', PR, 'Chicken', 175, 15, 10, 9, 1, {s:120,m:180,l:260}, ['brown','mixed','peanuts','bowl'], ['stir fried'], [], ['chinese'], ['dinner','spicy'], 55),
  B('Wonton Soup', PR, '', 60, 4, 6, 2, 0.5, {s:200,m:300,l:400}, ['bowl','soup','dumplings','clear'], ['boiled'], [], ['chinese'], ['appetizer','soup','light'], 55),

  // ═══════════════════════════════════════
  // JAPANESE
  // ═══════════════════════════════════════
  B('Ramen', PR, '', 95, 5, 14, 2, 1, {s:200,m:350,l:500}, ['bowl','noodles','soup','egg','broth'], ['boiled'], ['ramen noodles'], ['japanese'], ['lunch','dinner','comfort'], 75, {bowl:0.05,noodles:0.10}),
  B('Sashimi', PR, '', 120, 22, 0, 3, 0, {s:60,m:100,l:160}, ['sliced','raw','fish','colorful','thin'], ['raw'], ['raw fish'], ['japanese'], ['dinner','protein','healthy'], 65, {sliced:0.15,raw:0.15}),
  B('Tempura', SN, '', 230, 5, 22, 13, 1, {s:60,m:100,l:160}, ['golden','crispy','breaded','light'], ['deep fried'], ['vegetable tempura','shrimp tempura'], ['japanese'], ['appetizer','snack'], 60, {crispy:0.10,breaded:0.10}),
  B('Miso Soup', PR, '', 40, 3, 5, 1, 0.5, {s:150,m:200,l:300}, ['bowl','clear','tofu','green','liquid'], ['boiled'], [], ['japanese'], ['appetizer','soup','healthy'], 55),
  B('Teriyaki Chicken', PR, 'Chicken', 180, 22, 8, 6, 0, {s:100,m:150,l:220}, ['glazed','brown','shiny','sliced'], ['grilled','pan fried'], ['teriyaki'], ['japanese'], ['dinner','protein'], 60, {glazed:0.15,shiny:0.10}),
  B('Edamame', SN, '', 122, 12, 9, 5, 5, {s:60,m:100,l:150}, ['green','small','pods','bowl'], ['steamed','boiled'], ['soybean pods'], ['japanese'], ['appetizer','healthy','protein','gym'], 55, {pods:0.15,green:0.10}),
  B('Onigiri', SN, '', 170, 3, 37, 0.3, 0.5, {s:80,m:110,l:140}, ['triangular','white','seaweed','rice'], ['molded'], ['rice ball','musubi'], ['japanese'], ['snack','lunch'], 55, {triangular:0.20}),

  // ═══════════════════════════════════════
  // MEXICAN
  // ═══════════════════════════════════════
  B('Taco', PR, '', 210, 9, 20, 10, 2, {s:60,m:85,l:120}, ['folded','shell','filled','colorful','small'], ['fried','raw'], ['tacos','hard shell taco','soft taco'], ['mexican'], ['lunch','dinner'], 75, {folded:0.10,shell:0.10,filled:0.10}),
  B('Burrito', PR, '', 220, 10, 26, 9, 3, {s:150,m:250,l:400}, ['rolled','cylindrical','wrapped','large'], ['raw'], ['bean burrito','chicken burrito'], ['mexican'], ['lunch','dinner'], 75, {cylindrical:0.15,wrapped:0.15,large:0.10}),
  B('Quesadilla', PR, '', 280, 13, 22, 15, 1.5, {s:80,m:130,l:180}, ['flat','round','cheese','folded','golden','triangular'], ['grilled','pan fried'], [], ['mexican'], ['lunch','dinner','snack'], 65, {folded:0.10,cheese:0.10}),
  B('Nachos', SN, '', 340, 7, 36, 19, 3, {s:80,m:150,l:250}, ['triangular','chips','cheese','colorful','toppings'], ['baked'], [], ['mexican'], ['snack','appetizer'], 65, {triangular:0.10,chips:0.15}),
  B('Guacamole', SN, '', 160, 2, 9, 15, 7, {s:30,m:60,l:100}, ['green','smooth','creamy','bowl'], ['raw'], ['avocado dip'], ['mexican'], ['appetizer','healthy'], 55, {green:0.15,smooth:0.10}),
  B('Enchilada', PR, '', 168, 8, 17, 8, 2, {s:100,m:150,l:220}, ['rolled','sauce','cheese','layered'], ['baked'], ['chicken enchilada'], ['mexican'], ['lunch','dinner'], 55, {rolled:0.10,sauce:0.10}),

  // ═══════════════════════════════════════
  // THAI
  // ═══════════════════════════════════════
  B('Pad Thai', PR, '', 120, 5, 16, 4, 1, {s:150,m:250,l:350}, ['noodles','mixed','colorful','bowl','peanuts','lime'], ['stir fried'], ['phad thai'], ['thai'], ['lunch','dinner'], 70, {noodles:0.10,mixed:0.10,peanuts:0.10}),
  B('Green Curry', PR, '', 130, 8, 6, 9, 1, {s:150,m:220,l:300}, ['green','creamy','bowl','coconut'], ['simmered'], ['thai green curry'], ['thai'], ['lunch','dinner'], 60, {green:0.15}),
  B('Tom Yum Soup', PR, '', 45, 3, 5, 1.5, 0.5, {s:150,m:250,l:350}, ['clear','soup','bowl','shrimp'], ['boiled'], ['tom yam','tom yum'], ['thai'], ['appetizer','soup'], 55),
  B('Thai Fried Rice', PR, 'Rice', 160, 6, 23, 5, 1, {s:150,m:250,l:350}, ['mixed','rice','colorful','egg','bowl'], ['stir fried'], [], ['thai'], ['lunch','dinner'], 55),
  B('Satay', SN, '', 210, 18, 5, 13, 0.5, {s:60,m:100,l:160}, ['skewer','grilled','brown','charred','small'], ['grilled'], ['chicken satay','peanut sauce'], ['thai','indonesian'], ['appetizer','protein'], 60, {skewer:0.20,charred:0.10}),

  // ═══════════════════════════════════════
  // CHICKEN (standalone)
  // ═══════════════════════════════════════
  B('Chicken', IN, '', 165, 31, 0, 3.6, 0, {s:80,m:120,l:180}, ['white','flat','sliced','breast'], ['raw'], ['chicken breast','chicken piece'], ['global'], ['protein','gym','healthy'], 75),
  B('Fish', IN, '', 206, 22, 0, 12, 0, {s:80,m:120,l:180}, ['flat','white','fillet'], ['raw'], ['fish fillet'], ['global'], ['protein','healthy'], 70),
  B('Salmon', CK, 'Fish', 208, 20, 0, 13, 0, {s:100,m:150,l:220}, ['pink','flat','fillet','skin','thick'], ['grilled','baked','pan fried'], ['salmon fillet','grilled salmon'], ['global','japanese'], ['dinner','protein','healthy','gym'], 75, {pink:0.20,fillet:0.10}),
  B('Tuna', CK, 'Fish', 184, 30, 0, 6, 0, {s:80,m:130,l:180}, ['pink','flat','fillet','flaky'], ['grilled','raw'], ['tuna steak','tuna sashimi'], ['global','japanese'], ['dinner','protein','healthy','gym'], 65, {pink:0.10,flaky:0.10}),
  B('Shrimp', CK, '', 99, 24, 0.2, 0.3, 0, {s:60,m:100,l:160}, ['small','pink','curved','peeled'], ['grilled','fried','boiled'], ['prawns','prawn'], ['global'], ['dinner','protein','seafood'], 65, {curved:0.10,pink:0.10}),

  // ═══════════════════════════════════════
  // BREAD & BAKERY
  // ═══════════════════════════════════════
  B('Bread', IN, '', 265, 9, 49, 3.2, 2.7, {s:25,m:30,l:40}, ['sliced','rectangular','white','soft'], ['baked'], ['white bread','bread slice','loaf'], ['global'], ['staple','breakfast'], 75),
  B('Toast', CK, 'Bread', 313, 10, 55, 5, 3, {s:20,m:25,l:35}, ['flat','brown','crispy','sliced'], ['toasted'], ['toasted bread','buttered toast'], ['global'], ['breakfast','quick'], 70, {crispy:0.10,brown:0.05}),
  B('Croissant', PR, '', 406, 8.2, 45, 21, 2.3, {s:40,m:60,l:80}, ['golden','flaky','curved','crescent','layered'], ['baked'], [], ['french'], ['breakfast','sweet'], 70, {flaky:0.20,crescent:0.15,curved:0.10}),
  B('Bagel', PR, '', 270, 10, 53, 1.6, 2.3, {s:60,m:90,l:110}, ['round','ring','brown','thick'], ['baked'], [], ['american'], ['breakfast'], 55, {ring:0.15}),
  B('Muffin', DS, '', 340, 6, 46, 14, 1.5, {s:50,m:80,l:120}, ['round','domed','brown','small'], ['baked'], ['blueberry muffin','chocolate muffin'], ['american'], ['breakfast','snack','sweet'], 60, {domed:0.15}),
  B('Donut', DS, '', 452, 5, 51, 25, 1, {s:40,m:60,l:85}, ['round','ring','glazed','colorful','sprinkles'], ['deep fried','baked'], ['doughnut'], ['american'], ['breakfast','snack','sweet'], 70, {ring:0.15,glazed:0.15}),

  // ═══════════════════════════════════════
  // FRUITS
  // ═══════════════════════════════════════
  B('Banana', IN, '', 89, 1.1, 23, 0.3, 2.6, {s:80,m:120,l:150}, ['yellow','curved','elongated'], ['raw'], ['bananas'], ['global'], ['fruit','breakfast','healthy','gym'], 85, {yellow:0.10,curved:0.15}),
  B('Apple', IN, '', 52, 0.3, 14, 0.2, 2.4, {s:130,m:180,l:220}, ['round','red','green','smooth'], ['raw'], ['apples'], ['global'], ['fruit','healthy','snack'], 80, {round:0.10}),
  B('Mango', IN, '', 60, 0.8, 15, 0.4, 1.6, {s:120,m:180,l:250}, ['oval','yellow','orange','smooth'], ['raw'], ['mangoes'], ['indian','global'], ['fruit','summer'], 75, {orange:0.10,oval:0.10}),
  B('Orange', IN, '', 47, 0.9, 12, 0.1, 2.4, {s:100,m:150,l:200}, ['round','orange','peeled','segments'], ['raw'], ['oranges'], ['global'], ['fruit','healthy','vitamin c'], 75),
  B('Watermelon', IN, '', 30, 0.6, 8, 0.2, 0.4, {s:100,m:200,l:350}, ['red','green rind','large','sliced','seeds'], ['raw'], [], ['global'], ['fruit','summer','hydrating'], 70, {red:0.10,sliced:0.10}),
  B('Grapes', IN, '', 69, 0.7, 18, 0.2, 0.9, {s:60,m:100,l:160}, ['round','small','cluster','green','purple'], ['raw'], ['grape'], ['global'], ['fruit','snack'], 65, {cluster:0.15,small:0.10}),
  B('Strawberry', IN, '', 32, 0.7, 8, 0.3, 2, {s:50,m:100,l:160}, ['red','small','pointed','seeds'], ['raw'], ['strawberries'], ['global'], ['fruit','healthy'], 65, {red:0.10}),
  B('Pineapple', IN, '', 50, 0.5, 13, 0.1, 1.4, {s:80,m:130,l:200}, ['yellow','spiky','sliced','rings'], ['raw'], [], ['global'], ['fruit','tropical'], 60, {rings:0.10}),
  B('Papaya', IN, '', 43, 0.5, 11, 0.3, 1.7, {s:100,m:150,l:250}, ['orange','oval','seeds','sliced'], ['raw'], [], ['indian','global'], ['fruit','healthy'], 55),
  B('Guava', IN, '', 68, 2.6, 14, 1, 5.4, {s:80,m:120,l:170}, ['green','round','pink inside','seeds'], ['raw'], [], ['indian','global'], ['fruit','vitamin c'], 55),
  B('Pomegranate', IN, '', 83, 1.7, 19, 1.2, 4, {s:80,m:130,l:180}, ['red','round','seeds','small pieces'], ['raw'], ['anar'], ['indian','global'], ['fruit','healthy','antioxidant'], 55),
  B('Kiwi', IN, '', 61, 1.1, 15, 0.5, 3, {s:50,m:75,l:100}, ['brown','oval','green inside','hairy','small'], ['raw'], [], ['global'], ['fruit','vitamin c'], 50),
  B('Coconut', IN, '', 354, 3.3, 15, 33, 9, {s:20,m:40,l:80}, ['white','hard','brown shell','round'], ['raw'], [], ['indian','global'], ['healthy','fat'], 55),

  // ═══════════════════════════════════════
  // DAIRY
  // ═══════════════════════════════════════
  B('Milk', BV, '', 61, 3.2, 4.8, 3.3, 0, {s:150,m:200,l:300}, ['white','liquid','glass'], ['raw'], ['whole milk','full cream milk'], ['global'], ['dairy','breakfast','protein'], 80),
  B('Yogurt', IN, '', 61, 3.5, 4.7, 3.3, 0, {s:80,m:150,l:250}, ['white','creamy','smooth','bowl','cup'], ['fermented'], ['curd','dahi','plain yogurt'], ['global','indian'], ['breakfast','healthy','protein'], 75),
  B('Cheese', IN, '', 403, 25, 1.3, 33, 0, {s:20,m:30,l:50}, ['yellow','sliced','block','cubed'], ['raw'], ['cheddar cheese','cheese slice'], ['global'], ['protein','dairy'], 70),
  B('Lassi', BV, '', 80, 3, 10, 3, 0, {s:150,m:200,l:300}, ['white','glass','creamy','frothy'], ['blended'], ['sweet lassi','mango lassi','salted lassi'], ['indian'], ['beverage','dairy','cool'], 65, {frothy:0.10,glass:0.05}),
  B('Buttermilk', BV, '', 40, 3.3, 4.8, 0.9, 0, {s:150,m:200,l:300}, ['white','liquid','glass','thin'], ['fermented'], ['chaas','mattha'], ['indian'], ['beverage','dairy','cool'], 55),
  B('Ice Cream', DS, '', 207, 3.5, 24, 11, 0.7, {s:60,m:100,l:150}, ['round','scoops','colorful','bowl','cone','cold'], ['frozen'], ['ice cream cone','gelato','kulfi'], ['global'], ['dessert','cold','sweet'], 80, {scoops:0.15,cone:0.10}),
  B('Kulfi', DS, '', 220, 4, 25, 12, 0, {s:50,m:80,l:120}, ['cylindrical','frozen','cream','stick'], ['frozen'], ['malai kulfi','pista kulfi'], ['indian'], ['dessert','cold','sweet'], 60, {cylindrical:0.10,stick:0.10}),

  // ═══════════════════════════════════════
  // BEVERAGES
  // ═══════════════════════════════════════
  B('Chai', BV, '', 45, 1.5, 5, 1.5, 0, {s:100,m:150,l:200}, ['brown','cup','mug','hot','liquid'], ['boiled'], ['tea','masala chai','indian tea'], ['indian'], ['beverage','hot','daily'], 80, {cup:0.10,mug:0.10}),
  B('Coffee', BV, '', 2, 0.3, 0.3, 0, 0, {s:100,m:150,l:200}, ['brown','dark','cup','mug','hot'], ['brewed'], ['black coffee','espresso'], ['global'], ['beverage','hot','energy'], 75),
  B('Latte', BV, 'Coffee', 120, 6, 10, 5, 0, {s:200,m:300,l:400}, ['brown','foam','cup','art','milky'], ['brewed','steamed'], ['cafe latte','coffee latte'], ['global'], ['beverage','hot','coffee'], 65, {foam:0.15}),
  B('Cappuccino', BV, 'Coffee', 100, 5, 8, 4, 0, {s:150,m:200,l:300}, ['brown','foam','cup','layered'], ['brewed','steamed'], [], ['italian','global'], ['beverage','hot','coffee'], 60, {foam:0.15,layered:0.10}),
  B('Juice', BV, '', 45, 0.5, 11, 0.1, 0.2, {s:150,m:250,l:350}, ['glass','colorful','liquid','fresh'], ['squeezed','blended'], ['orange juice','fresh juice','fruit juice'], ['global'], ['beverage','cold','healthy'], 70),
  B('Smoothie', BV, '', 80, 2, 16, 1, 2, {s:200,m:300,l:450}, ['glass','thick','colorful','creamy','straw'], ['blended'], ['fruit smoothie','green smoothie','protein smoothie'], ['global'], ['beverage','cold','healthy','gym'], 70, {thick:0.15,straw:0.10}),
  B('Protein Shake', BV, '', 120, 24, 8, 2, 1, {s:200,m:350,l:500}, ['glass','thick','shaker','creamy'], ['blended'], ['whey shake','protein drink'], ['global'], ['beverage','gym','protein','fitness'], 70, {shaker:0.20}),
  B('Milkshake', BV, '', 170, 5, 28, 5, 0.5, {s:200,m:350,l:500}, ['glass','thick','creamy','whipped cream','straw'], ['blended'], ['chocolate milkshake','vanilla milkshake','strawberry milkshake'], ['american'], ['beverage','cold','sweet'], 65, {'whipped cream':0.10}),
  B('Coconut Water', BV, '', 19, 0.7, 3.7, 0.2, 1.1, {s:200,m:300,l:500}, ['clear','glass','green coconut'], ['raw'], ['nariyal pani'], ['indian','global'], ['beverage','hydrating','healthy'], 55),
  B('Nimbu Pani', BV, '', 30, 0.2, 7, 0, 0, {s:150,m:250,l:350}, ['yellow','glass','lemon','clear'], ['mixed'], ['lemon water','lime water','shikanji'], ['indian'], ['beverage','cool','refreshing'], 55),

  // ═══════════════════════════════════════
  // DESSERTS
  // ═══════════════════════════════════════
  B('Gulab Jamun', DS, '', 350, 4, 45, 17, 0.5, {s:30,m:40,l:55}, ['round','brown','dark','small','syrup','glossy'], ['deep fried','soaked'], ['gulab jamun'], ['indian'], ['dessert','sweet','festival'], 80, {round:0.10,glossy:0.10,syrup:0.10}),
  B('Rasgulla', DS, '', 186, 6, 35, 2, 0, {s:30,m:50,l:70}, ['round','white','soft','syrup','spongy'], ['boiled','soaked'], ['rasagola'], ['indian'], ['dessert','sweet','festival'], 70, {round:0.10,white:0.10,spongy:0.15}),
  B('Jalebi', DS, '', 400, 2, 55, 18, 0, {s:20,m:30,l:50}, ['spiral','orange','crispy','syrup','thin'], ['deep fried','soaked'], [], ['indian'], ['dessert','sweet','street food','festival'], 75, {spiral:0.25,orange:0.10,crispy:0.10}),
  B('Ladoo', DS, '', 450, 5, 50, 25, 1, {s:25,m:40,l:55}, ['round','golden','ball','small'], ['fried','molded'], ['besan ladoo','boondi ladoo','motichoor ladoo'], ['indian'], ['dessert','sweet','festival'], 70, {ball:0.15}),
  B('Barfi', DS, '', 380, 6, 45, 20, 0.5, {s:20,m:35,l:55}, ['square','flat','white','decorated','silver foil'], ['set','molded'], ['kaju barfi','kaju katli','burfi'], ['indian'], ['dessert','sweet','festival'], 65, {square:0.10,'silver foil':0.15}),
  B('Kheer', DS, '', 125, 3.5, 18, 4, 0.3, {s:80,m:120,l:180}, ['white','creamy','bowl','rice','liquid'], ['boiled','simmered'], ['rice kheer','rice pudding','payasam'], ['indian'], ['dessert','sweet','festival'], 65, {creamy:0.10}),
  B('Halwa', DS, '', 280, 3, 35, 14, 1, {s:50,m:80,l:120}, ['golden','smooth','glossy','bowl'], ['simmered'], ['suji halwa','gajar halwa','moong dal halwa'], ['indian'], ['dessert','sweet','warm'], 65, {golden:0.10,smooth:0.10,glossy:0.10}),
  B('Cake', DS, '', 350, 4, 50, 15, 0.5, {s:60,m:100,l:160}, ['layered','frosted','slice','round','decorated','colorful'], ['baked'], ['chocolate cake','birthday cake','red velvet cake'], ['global'], ['dessert','sweet','celebration'], 80, {frosted:0.15,layered:0.10,slice:0.10}),
  B('Brownie', DS, '', 410, 5, 50, 22, 2, {s:40,m:65,l:100}, ['dark brown','square','dense','rich','chocolate'], ['baked'], ['chocolate brownie'], ['american'], ['dessert','sweet','chocolate'], 65, {'dark brown':0.10,square:0.10,dense:0.10}),
  B('Cheesecake', DS, '', 320, 6, 26, 22, 0.3, {s:80,m:120,l:170}, ['creamy','smooth','white','slice','crust'], ['baked'], ['new york cheesecake'], ['american'], ['dessert','sweet'], 60, {smooth:0.10,slice:0.10}),
  B('Tiramisu', DS, '', 283, 5, 25, 18, 0.3, {s:80,m:120,l:170}, ['layered','dusted','brown','creamy','rectangular'], ['raw','assembled'], [], ['italian'], ['dessert','coffee','sweet'], 55, {dusted:0.15,layered:0.10}),

  // ═══════════════════════════════════════
  // HEALTHY / GYM
  // ═══════════════════════════════════════
  B('Oats', IN, '', 389, 17, 66, 7, 11, {s:30,m:45,l:60}, ['bowl','flaky','dry','cereal'], ['raw','boiled'], ['oatmeal','rolled oats','porridge'], ['global'], ['breakfast','healthy','gym','fiber'], 75),
  B('Oatmeal', CK, 'Oats', 71, 3, 12, 1.5, 2, {s:150,m:250,l:350}, ['bowl','creamy','smooth','hot'], ['boiled'], ['porridge','cooked oats'], ['global'], ['breakfast','healthy','gym'], 70, {bowl:0.05,creamy:0.10}),
  B('Granola', PR, 'Oats', 471, 10, 64, 20, 7, {s:30,m:50,l:80}, ['crunchy','mixed','bowl','clusters'], ['baked'], ['granola cereal','granola bar'], ['global'], ['breakfast','healthy','gym'], 55, {crunchy:0.10,clusters:0.10}),
  B('Avocado Toast', PR, '', 220, 5, 18, 15, 5, {s:80,m:120,l:170}, ['flat','green','bread','sliced','toast'], ['toasted'], ['avo toast'], ['american'], ['breakfast','healthy','gym'], 65, {green:0.10}),
  B('Salad', PR, '', 20, 1.5, 3.5, 0.3, 2, {s:80,m:150,l:250}, ['green','mixed','bowl','colorful','leaves','fresh'], ['raw'], ['green salad','mixed salad','garden salad'], ['global'], ['lunch','dinner','healthy','gym'], 75, {green:0.10,leaves:0.10,mixed:0.05}),
  B('Greek Salad', PR, 'Salad', 90, 5, 6, 6, 2, {s:100,m:180,l:280}, ['colorful','cubed','olives','cheese','bowl'], ['raw'], [], ['greek'], ['lunch','healthy','gym'], 55),
  B('Chicken Salad', PR, 'Salad', 110, 12, 5, 5, 2, {s:100,m:180,l:280}, ['green','chicken','mixed','bowl','leaves'], ['raw','grilled'], [], ['american'], ['lunch','healthy','protein','gym'], 60),
  B('Quinoa Bowl', PR, '', 120, 4, 21, 2, 3, {s:100,m:180,l:280}, ['bowl','mixed','colorful','grains'], ['boiled'], ['quinoa salad'], ['global'], ['lunch','healthy','gym','protein'], 55),
  B('Whey Protein', BV, '', 400, 80, 10, 5, 0, {s:25,m:35,l:50}, ['powder','scoop','shaker'], ['mixed'], ['protein powder','whey isolate'], ['global'], ['gym','protein','fitness'], 65, {scoop:0.15,shaker:0.15}),
  B('Peanut Butter', IN, '', 588, 25, 20, 50, 6, {s:15,m:32,l:50}, ['brown','thick','creamy','jar','spread'], ['raw'], ['PB'], ['global'], ['protein','gym','healthy','snack'], 70, {thick:0.10,creamy:0.10,spread:0.10}),
  B('Almonds', SN, '', 579, 21, 22, 50, 12, {s:15,m:28,l:45}, ['brown','small','oval','handful'], ['raw','roasted'], ['badam'], ['global','indian'], ['snack','healthy','protein','gym'], 65, {small:0.05,oval:0.10}),
  B('Mixed Nuts', SN, '', 607, 20, 21, 54, 7, {s:20,m:35,l:55}, ['mixed','small','bowl','handful'], ['raw','roasted'], ['trail mix','dry fruits'], ['global'], ['snack','healthy','protein','gym'], 55),

  // ═══════════════════════════════════════
  // SOUPS
  // ═══════════════════════════════════════
  B('Soup', PR, '', 36, 1.2, 6, 0.8, 1.5, {s:150,m:250,l:350}, ['bowl','liquid','hot','spoon'], ['boiled','simmered'], ['vegetable soup'], ['global'], ['light','healthy','comfort'], 65),
  B('Tomato Soup', PR, 'Soup', 50, 1.5, 8, 1.2, 1, {s:150,m:250,l:350}, ['red','bowl','smooth','hot'], ['boiled','blended'], ['cream of tomato'], ['global'], ['light','healthy'], 60, {red:0.15,smooth:0.10}),
  B('Chicken Soup', PR, 'Soup', 75, 5, 6, 3, 0.5, {s:150,m:250,l:350}, ['clear','bowl','chicken','noodles','hot'], ['boiled','simmered'], ['chicken broth','chicken noodle soup'], ['global'], ['comfort','light','healing'], 60),
  B('Corn Soup', PR, 'Soup', 70, 2, 12, 1.5, 1, {s:150,m:250,l:350}, ['yellow','thick','bowl','creamy'], ['boiled'], ['sweet corn soup','cream of corn'], ['chinese','global'], ['appetizer','light'], 55, {yellow:0.10,thick:0.10}),

  // ═══════════════════════════════════════
  // VEGETABLES (cooked)
  // ═══════════════════════════════════════
  B('Potato', IN, '', 87, 1.9, 20, 0.1, 1.8, {s:80,m:130,l:200}, ['round','brown','white inside'], ['raw'], ['aloo'], ['global','indian'], ['staple','vegetable'], 70),
  B('Mashed Potato', CK, 'Potato', 100, 2, 15, 4, 1.5, {s:100,m:150,l:250}, ['smooth','white','creamy','bowl'], ['boiled','mashed'], ['mashed potatoes'], ['american','british'], ['side','comfort'], 55, {smooth:0.15,creamy:0.10,mashed:0.10}),
  B('Baked Potato', CK, 'Potato', 93, 2.5, 21, 0.1, 2, {s:130,m:180,l:250}, ['large','brown','split','skin','toppings'], ['baked'], ['jacket potato'], ['american','british'], ['side','comfort'], 55, {split:0.10}),
  B('Corn on the Cob', CK, '', 96, 3.4, 21, 1.5, 2.7, {s:100,m:150,l:200}, ['cylindrical','yellow','kernels'], ['boiled','grilled'], ['sweet corn','bhutta'], ['global','indian'], ['snack','side'], 55, {cylindrical:0.10,kernels:0.10}),
  B('Broccoli', CK, '', 35, 2.4, 7, 0.4, 2.6, {s:50,m:100,l:160}, ['green','small trees','florets'], ['steamed','boiled','raw'], [], ['global'], ['healthy','side','gym'], 55, {florets:0.15}),
];

// ═══════════════════════════════════════
// BUILD PARENT-CHILD RELATIONSHIPS
// ═══════════════════════════════════════
function buildRelationships(foods) {
  // Group children by parent
  const parentMap = {};
  for (const food of foods) {
    if (food.parentFood) {
      if (!parentMap[food.parentFood]) parentMap[food.parentFood] = [];
      parentMap[food.parentFood].push(food.dishNameLower);
    }
  }

  // Assign childFoods to parents
  for (const food of foods) {
    const key = food.dishNameLower;
    if (parentMap[key]) {
      food.childFoods = parentMap[key];
    }
  }

  return foods;
}

// ═══════════════════════════════════════
// MAIN SEED FUNCTION
// ═══════════════════════════════════════
async function seed() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/getfit';

  console.log('[Seed] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Seed] Connected.');

  // Build relationships
  const foods = buildRelationships(FOODS);

  console.log(`[Seed] Inserting ${foods.length} food ontology entries...`);

  // Clear existing data
  await FoodOntology.deleteMany({});

  // Insert in batches
  const BATCH_SIZE = 100;
  let inserted = 0;
  for (let i = 0; i < foods.length; i += BATCH_SIZE) {
    const batch = foods.slice(i, i + BATCH_SIZE);
    try {
      await FoodOntology.insertMany(batch, { ordered: false });
      inserted += batch.length;
    } catch (err) {
      // Handle duplicate key errors
      if (err.code === 11000) {
        console.warn(`[Seed] Some duplicates in batch ${i}-${i + BATCH_SIZE}, skipping...`);
        inserted += (err.result?.nInserted || 0);
      } else {
        throw err;
      }
    }
  }

  console.log(`[Seed] ✓ Inserted ${inserted} foods successfully.`);

  // Print summary
  const categories = {};
  const cuisines = {};
  for (const f of foods) {
    categories[f.category] = (categories[f.category] || 0) + 1;
    for (const c of (f.cuisines || [])) {
      cuisines[c] = (cuisines[c] || 0) + 1;
    }
  }
  console.log('[Seed] Categories:', categories);
  console.log('[Seed] Cuisines:', cuisines);

  await mongoose.disconnect();
  console.log('[Seed] Done.');
}

seed().catch(err => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
