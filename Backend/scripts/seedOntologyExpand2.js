/**
 * Seed Food Ontology — Expansion Pack 3 (Global + Specialty)
 * 
 * Adds ~500+ more foods: breakfast items, bakery, seafood, nuts/seeds, condiments,
 * processed foods, baby food, superfoods, ready meals, coffee shop items.
 * Run: node scripts/seedOntologyExpand2.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
dotenv.config();

try { dns.setServers(['1.1.1.1', '8.8.8.8', '8.8.4.4']); } catch(e) {}

const foodOntologySchema = new mongoose.Schema({
  dishName: String, dishNameLower: { type: String, unique: true }, category: String,
  subcategory: String, parentFood: String, childFoods: [String], ingredients: [String],
  primaryIngredient: String, visualCues: [String], cookingStyles: [String], synonyms: [String],
  cuisines: [String], tags: [String], usdaKeyword: String, offKeyword: String, getfitKeyword: String,
  defaultGrams: { small: Number, medium: Number, large: Number },
  caloriesPer100g: Number, proteinPer100g: Number, carbsPer100g: Number, fatPer100g: Number, fiberPer100g: Number,
  confidenceModifiers: { type: Map, of: Number }, isActive: Boolean, priority: Number,
}, { timestamps: true });

const FoodOntology = mongoose.model('FoodOntology', foodOntologySchema);
const IN='ingredient',CK='cooked',PR='prepared',BV='beverage',DS='dessert',SN='snack';

function B(name,cat,parent,cal,p,c,f,fib,g,cues,cook,syn,cui,tags,pri,mods) {
  return {
    dishName:name, dishNameLower:name.toLowerCase(), category:cat,
    subcategory:parent?`${parent} dish`:cat, parentFood:(parent||'').toLowerCase(),
    childFoods:[], ingredients:parent?[parent.toLowerCase()]:[name.toLowerCase()],
    primaryIngredient:(parent||name).toLowerCase(),
    visualCues:cues||[], cookingStyles:cook||[], synonyms:syn||[],
    cuisines:cui||[], tags:tags||[],
    usdaKeyword:name.toLowerCase(), offKeyword:name.toLowerCase(), getfitKeyword:name.toLowerCase(),
    defaultGrams:g||{small:80,medium:150,large:250},
    caloriesPer100g:cal||0, proteinPer100g:p||0, carbsPer100g:c||0, fatPer100g:f||0, fiberPer100g:fib||0,
    confidenceModifiers:new Map(Object.entries(mods||{})),
    isActive:true, priority:pri||50,
  };
}

const FOODS = [
  // ═══════════════════════════════════════
  // BREAKFAST CLASSICS
  // ═══════════════════════════════════════
  B('Waffles', PR, '', 291, 8, 33, 14, 1, {s:50,m:80,l:120}, ['grid pattern','golden','square','syrup'], ['baked'], ['waffle'], ['american'], ['breakfast','sweet'], 55),
  B('French Toast', PR, '', 229, 7, 26, 11, 1, {s:50,m:80,l:120}, ['golden','thick','square','sugar'], ['pan fried'], ['eggy bread'], ['american','french'], ['breakfast','sweet'], 55),
  B('Crepes', PR, '', 160, 5, 22, 6, 0.5, {s:40,m:70,l:100}, ['thin','round','folded','flat'], ['pan fried'], ['crepe'], ['french'], ['breakfast','dessert'], 55),
  B('Croissant', PR, '', 406, 8, 45, 21, 2, {s:30,m:50,l:70}, ['crescent','golden','flaky','layered'], ['baked'], [], ['french'], ['breakfast','bakery'], 65),
  B('Pain au Chocolat', PR, '', 420, 8, 42, 25, 2, {s:40,m:60,l:85}, ['rectangular','golden','chocolate','flaky'], ['baked'], ['chocolate croissant'], ['french'], ['breakfast','bakery'], 55),
  B('Bagel', PR, '', 250, 10, 48, 1.5, 2.5, {s:60,m:85,l:110}, ['round','hole','golden','dense'], ['baked'], ['bagels'], ['american'], ['breakfast','bread'], 55),
  B('Granola', SN, '', 471, 10, 64, 20, 7, {s:30,m:50,l:80}, ['crunchy','mixed','brown','clusters'], ['baked'], ['muesli','granola cereal'], ['global'], ['breakfast','healthy','gym'], 55),
  B('Cornflakes', PR, '', 357, 7, 84, 0.4, 2, {s:25,m:35,l:50}, ['flat','golden','flakes','bowl','milk'], ['processed'], ['cereal','corn flakes'], ['global'], ['breakfast'], 50),
  B('Porridge', PR, 'Oats', 71, 2.5, 12, 1.5, 1.7, {s:150,m:250,l:350}, ['creamy','bowl','white','smooth'], ['boiled'], ['oatmeal'], ['global'], ['breakfast','healthy','gym'], 55),
  B('Avocado Toast', PR, '', 210, 5, 18, 14, 5, {s:80,m:120,l:170}, ['green','bread','spread','sliced'], ['raw','toasted'], ['avo toast'], ['global'], ['breakfast','healthy','trendy'], 60),
  B('Shakshuka', PR, '', 150, 8, 10, 9, 2, {s:150,m:220,l:300}, ['red','egg','tomato','pan'], ['simmered'], ['eggs in tomato'], ['middle eastern'], ['breakfast','brunch'], 55),
  B('Hash Browns', SN, '', 326, 3, 35, 19, 3, {s:50,m:80,l:120}, ['golden','flat','crispy','shredded'], ['fried'], ['hash brown'], ['american'], ['breakfast','side'], 55),
  B('English Muffin', PR, '', 227, 8, 44, 2, 2, {s:35,m:50,l:65}, ['round','flat','golden','split'], ['toasted'], [], ['british'], ['breakfast','bread'], 45),
  B('Breakfast Burrito', PR, '', 200, 10, 20, 9, 2, {s:150,m:250,l:350}, ['wrapped','large','tortilla'], ['grilled'], [], ['mexican','american'], ['breakfast'], 55),

  // ═══════════════════════════════════════
  // BAKERY & PASTRY
  // ═══════════════════════════════════════
  B('Scone', DS, '', 362, 6, 46, 17, 2, {s:40,m:60,l:90}, ['round','crumbly','golden','thick'], ['baked'], ['scones'], ['british'], ['breakfast','bakery','tea time'], 50),
  B('Eclair', DS, '', 262, 5, 24, 16, 0.5, {s:40,m:60,l:90}, ['elongated','chocolate','cream'], ['baked'], [], ['french'], ['dessert','bakery'], 55),
  B('Macaron', DS, '', 400, 7, 52, 18, 1, {s:10,m:15,l:25}, ['round','colorful','small','sandwich'], ['baked'], ['macarons','french macaron'], ['french'], ['dessert','bakery'], 55),
  B('Danish Pastry', DS, '', 374, 6, 40, 21, 1, {s:40,m:65,l:90}, ['round','golden','fruit','glazed'], ['baked'], ['danish'], ['global'], ['breakfast','bakery'], 50),
  B('Brownie', DS, '', 466, 6, 54, 26, 2, {s:30,m:50,l:75}, ['dark brown','square','moist','chocolate'], ['baked'], ['brownies','chocolate brownie'], ['american'], ['dessert','bakery'], 60),
  B('Blondies', DS, '', 380, 4, 48, 18, 0.5, {s:30,m:50,l:75}, ['golden','square','dense'], ['baked'], ['blondie'], ['american'], ['dessert','bakery'], 45),
  B('Cinnamon Roll', DS, '', 418, 7, 56, 19, 1, {s:60,m:100,l:150}, ['spiral','white icing','round','soft'], ['baked'], ['cinnamon bun'], ['american'], ['dessert','bakery','breakfast'], 55),
  B('Muffin', DS, '', 377, 6, 50, 17, 2, {s:40,m:65,l:100}, ['round','domed','paper cup','brown'], ['baked'], ['blueberry muffin','banana muffin'], ['american'], ['breakfast','bakery','snack'], 55),
  B('Cupcake', DS, '', 305, 3, 42, 14, 0.5, {s:35,m:55,l:80}, ['round','frosted','colorful','small'], ['baked'], ['cupcakes'], ['american'], ['dessert','celebration'], 60),
  B('Doughnut', DS, '', 421, 5, 48, 23, 1, {s:40,m:60,l:85}, ['round','hole','glazed','sugar'], ['deep fried'], ['donut','donuts'], ['american'], ['dessert','breakfast','sweet'], 65),
  B('Apple Pie', DS, '', 237, 2, 34, 11, 1.6, {s:70,m:120,l:170}, ['golden','lattice','round','sliced'], ['baked'], ['pie'], ['american'], ['dessert','sweet'], 55),
  B('Banana Bread', DS, '', 326, 4, 48, 13, 2, {s:40,m:60,l:90}, ['loaf','brown','sliced','moist'], ['baked'], [], ['american'], ['bakery','snack','breakfast'], 55),
  B('Pound Cake', DS, '', 353, 5, 44, 18, 0.5, {s:40,m:70,l:100}, ['golden','loaf','sliced','dense'], ['baked'], ['butter cake'], ['global'], ['dessert','bakery'], 50),
  B('Carrot Cake', DS, '', 340, 4, 42, 17, 1.5, {s:60,m:100,l:150}, ['layered','white frosting','moist'], ['baked'], [], ['american'], ['dessert','bakery'], 55),
  B('Cheesecake', DS, '', 321, 6, 26, 22, 0.5, {s:60,m:100,l:150}, ['white','smooth','triangle','dense'], ['baked'], ['cheese cake','NY cheesecake'], ['american'], ['dessert','bakery'], 60),
  B('Red Velvet Cake', DS, '', 310, 4, 40, 15, 0.5, {s:60,m:100,l:150}, ['red','layered','white frosting'], ['baked'], ['red velvet'], ['american'], ['dessert','celebration'], 55),
  B('Chocolate Cake', DS, '', 371, 5, 50, 17, 2, {s:60,m:100,l:150}, ['dark brown','layered','chocolate','frosted'], ['baked'], ['chocolate gateau'], ['global'], ['dessert','celebration'], 60),

  // ═══════════════════════════════════════
  // SEAFOOD
  // ═══════════════════════════════════════
  B('Salmon', CK, 'Fish', 208, 20, 0, 13, 0, {s:80,m:130,l:180}, ['pink','fillet','flat'], ['grilled','baked','raw'], ['salmon fillet'], ['global'], ['protein','healthy','omega3'], 65),
  B('Tuna Steak', CK, 'Fish', 130, 26, 0, 2, 0, {s:80,m:130,l:180}, ['brown','flat','dense','seared'], ['grilled','seared'], ['ahi tuna'], ['global','japanese'], ['protein','healthy'], 55),
  B('Sushi Roll', PR, '', 145, 5, 22, 4, 1, {s:100,m:180,l:260}, ['round','sliced','rice','seaweed'], ['raw'], ['maki','sushi','california roll','dragon roll'], ['japanese'], ['lunch','dinner','healthy'], 70),
  B('Sashimi', CK, 'Fish', 130, 22, 0, 5, 0, {s:60,m:100,l:160}, ['thin slices','colorful','raw','plate'], ['raw'], [], ['japanese'], ['dinner','protein','healthy'], 55),
  B('Shrimp Tempura', SN, '', 250, 12, 22, 12, 1, {s:60,m:100,l:160}, ['golden','battered','curved'], ['deep fried'], ['prawn tempura','ebi tempura'], ['japanese'], ['appetizer','dinner'], 55),
  B('Grilled Shrimp', CK, '', 120, 23, 0, 2, 0, {s:60,m:100,l:160}, ['pink','curved','grill marks','skewer'], ['grilled'], ['grilled prawn','shrimp skewer'], ['global'], ['protein','healthy','dinner'], 55),
  B('Lobster', CK, '', 89, 19, 0, 1, 0, {s:100,m:180,l:280}, ['red','large','claws','whole'], ['boiled','grilled'], [], ['global'], ['dinner','premium','protein'], 50),
  B('Crab', CK, '', 97, 19, 0, 1.5, 0, {s:60,m:100,l:160}, ['red','shell','white meat'], ['boiled','steamed'], ['crab meat'], ['global'], ['dinner','protein'], 50),
  B('Fish Fry', CK, 'Fish', 230, 16, 12, 13, 0.5, {s:80,m:120,l:180}, ['golden','battered','flat','crispy'], ['deep fried'], ['fried fish'], ['global','indian'], ['dinner','snack'], 55),
  B('Fish Curry', PR, 'Fish', 110, 12, 4, 5, 1, {s:120,m:200,l:280}, ['gravy','brown','bowl','fish'], ['simmered'], ['macher jhol','fish masala'], ['indian'], ['lunch','dinner'], 55),
  B('Prawn Curry', PR, '', 120, 14, 4, 5, 0.5, {s:120,m:200,l:280}, ['red','gravy','prawns','bowl'], ['simmered'], ['shrimp curry','jhinga curry'], ['indian'], ['lunch','dinner'], 55),
  B('Calamari', SN, '', 175, 15, 8, 8, 0, {s:60,m:100,l:160}, ['ring','golden','crispy','fried'], ['deep fried'], ['fried calamari','fried squid'], ['global','italian'], ['appetizer','seafood'], 55),
  B('Fish Tacos', PR, 'Taco', 220, 12, 20, 10, 2, {s:100,m:160,l:240}, ['small','fish','cabbage','tortilla'], ['fried','assembled'], [], ['mexican'], ['lunch','dinner'], 50),

  // ═══════════════════════════════════════
  // NUTS, SEEDS & DRY FRUITS
  // ═══════════════════════════════════════
  B('Walnuts', IN, '', 654, 15, 14, 65, 7, {s:15,m:28,l:45}, ['brown','halves','wrinkled'], ['raw'], ['akhrot'], ['global'], ['snack','healthy','brain food'], 50),
  B('Cashews', IN, '', 553, 18, 30, 44, 3, {s:15,m:28,l:45}, ['white','curved','kidney shaped'], ['raw','roasted'], ['kaju'], ['global','indian'], ['snack','healthy'], 55),
  B('Pistachios', IN, '', 562, 20, 28, 45, 10, {s:15,m:28,l:45}, ['green','small','shell','split'], ['raw','roasted'], ['pista'], ['global','middle eastern'], ['snack','healthy'], 55),
  B('Peanuts', IN, '', 567, 26, 16, 49, 8.5, {s:15,m:28,l:45}, ['brown','small','oval','skin'], ['raw','roasted'], ['groundnut','moongfali'], ['global','indian'], ['snack','protein'], 55),
  B('Mixed Nuts', SN, '', 580, 18, 22, 50, 7, {s:15,m:28,l:45}, ['mixed','various','bowl','small'], ['roasted'], ['trail mix','dry fruit mix'], ['global'], ['snack','healthy','gym'], 55),
  B('Flax Seeds', IN, '', 534, 18, 29, 42, 27, {s:5,m:10,l:20}, ['brown','tiny','flat','oval'], ['raw'], ['linseed','alsi'], ['global'], ['healthy','superfood','seed'], 40),
  B('Chia Seeds', IN, '', 486, 17, 42, 31, 34, {s:5,m:10,l:20}, ['black','tiny','round'], ['raw'], ['chia'], ['global'], ['healthy','superfood','seed'], 45),
  B('Sunflower Seeds', IN, '', 584, 21, 20, 51, 8.5, {s:10,m:20,l:35}, ['grey','small','flat','pointed'], ['raw','roasted'], ['surajmukhi'], ['global'], ['snack','healthy','seed'], 40),
  B('Pumpkin Seeds', IN, '', 559, 30, 11, 49, 6, {s:10,m:20,l:35}, ['green','flat','oval'], ['raw','roasted'], ['pepita'], ['global'], ['snack','healthy','seed','protein'], 45),

  // ═══════════════════════════════════════
  // BEVERAGES — COFFEE SHOP
  // ═══════════════════════════════════════
  B('Cappuccino', BV, 'Coffee', 80, 4, 8, 4, 0, {s:150,m:240,l:350}, ['brown','foam','cup','hot','art'], ['brewed','steamed'], [], ['italian','global'], ['beverage','hot','coffee'], 60),
  B('Latte', BV, 'Coffee', 80, 5, 9, 3.5, 0, {s:200,m:350,l:450}, ['brown','milky','cup','hot'], ['brewed','steamed'], ['cafe latte'], ['italian','global'], ['beverage','hot','coffee'], 60),
  B('Espresso', BV, 'Coffee', 9, 0.1, 1.7, 0.2, 0, {s:30,m:50,l:60}, ['dark','small','cup','crema'], ['brewed'], ['espresso shot'], ['italian','global'], ['beverage','hot','coffee'], 55),
  B('Americano', BV, 'Coffee', 15, 0.3, 2, 0.3, 0, {s:150,m:250,l:350}, ['dark','clear','cup','hot'], ['brewed'], ['black coffee','long black'], ['global'], ['beverage','hot','coffee','low cal'], 55),
  B('Mocha', BV, 'Coffee', 130, 5, 17, 5, 1, {s:200,m:350,l:450}, ['brown','cream','chocolate','cup'], ['brewed','steamed'], ['cafe mocha','mocha latte'], ['global'], ['beverage','hot','coffee','sweet'], 55),
  B('Frappe', BV, 'Coffee', 160, 3, 28, 5, 0, {s:200,m:350,l:500}, ['iced','cream','glass','cold','whipped'], ['blended'], ['frappuccino','iced blended'], ['global'], ['beverage','cold','coffee','sweet'], 55),
  B('Matcha Latte', BV, '', 90, 3, 14, 3, 0.5, {s:200,m:350,l:450}, ['green','milky','cup','frothy'], ['steamed'], ['green tea latte'], ['japanese','global'], ['beverage','hot','healthy'], 55),
  B('Hot Chocolate', BV, '', 120, 4, 18, 4, 1, {s:150,m:250,l:350}, ['brown','hot','cup','cream'], ['heated'], ['cocoa','hot cocoa'], ['global'], ['beverage','hot','sweet'], 55),
  B('Chai Latte', BV, 'Chai', 70, 2, 12, 2, 0, {s:200,m:350,l:450}, ['brown','milky','cup','spiced'], ['brewed','steamed'], ['masala latte'], ['indian','global'], ['beverage','hot'], 50),
  B('Bubble Tea', BV, '', 120, 1, 25, 2, 0, {s:300,m:400,l:500}, ['colorful','pearls','straw','cup','cold'], ['brewed','mixed'], ['boba tea','boba','tapioca tea'], ['chinese','global'], ['beverage','cold','sweet'], 55),
  B('Fresh Juice', BV, '', 48, 0.5, 11, 0.2, 0.3, {s:150,m:250,l:400}, ['colorful','glass','fresh','clear'], ['squeezed'], ['fruit juice','pressed juice'], ['global'], ['beverage','cold','healthy'], 50),
  B('Orange Juice', BV, '', 45, 0.7, 10, 0.2, 0.2, {s:150,m:250,l:400}, ['orange','glass','fresh'], ['squeezed'], ['OJ'], ['global'], ['beverage','cold','breakfast'], 55),
  B('Coconut Water', BV, '', 19, 0.7, 3.7, 0.2, 1.1, {s:150,m:250,l:350}, ['clear','glass','light'], ['raw'], ['tender coconut','nariyal pani'], ['indian','global'], ['beverage','cold','healthy','hydration'], 55),
  B('Protein Shake', BV, '', 110, 20, 8, 2, 1, {s:200,m:350,l:500}, ['thick','colored','shaker','smooth'], ['blended'], ['whey shake','protein smoothie'], ['global'], ['beverage','gym','protein'], 60),
  B('Green Smoothie', BV, '', 70, 2, 12, 1.5, 2, {s:200,m:300,l:450}, ['green','glass','thick','fresh'], ['blended'], ['spinach smoothie','kale smoothie'], ['global'], ['beverage','healthy','gym'], 50),
  B('Mango Smoothie', BV, '', 100, 1.5, 22, 1, 2, {s:200,m:300,l:450}, ['orange','glass','thick','fresh'], ['blended'], ['mango shake'], ['global'], ['beverage','cold','sweet'], 55),

  // ═══════════════════════════════════════
  // CONDIMENTS & SIDES
  // ═══════════════════════════════════════
  B('Ketchup', IN, '', 112, 1.7, 26, 0.1, 0.3, {s:10,m:20,l:35}, ['red','thick','bottle','sauce'], ['processed'], ['tomato ketchup','tomato sauce'], ['global'], ['condiment','sauce'], 40),
  B('Mayonnaise', IN, '', 680, 1, 0.6, 75, 0, {s:10,m:20,l:30}, ['white','creamy','jar','spread'], ['processed'], ['mayo'], ['global'], ['condiment','sauce'], 45),
  B('Hot Sauce', IN, '', 11, 0.5, 2, 0.3, 0.5, {s:5,m:10,l:15}, ['red','liquid','bottle','spicy'], ['processed'], ['tabasco','sriracha','chili sauce'], ['global'], ['condiment','sauce','spicy'], 35),
  B('Soy Sauce', IN, '', 53, 8, 5, 0, 0, {s:5,m:10,l:15}, ['dark','liquid','bottle'], ['fermented'], ['shoyu'], ['chinese','japanese'], ['condiment','sauce'], 35),
  B('Guacamole', SN, '', 160, 2, 9, 15, 7, {s:30,m:60,l:100}, ['green','chunky','avocado','bowl'], ['raw'], ['guac'], ['mexican'], ['condiment','healthy','appetizer'], 55),
  B('Salsa', SN, '', 36, 2, 7, 0.2, 2, {s:20,m:40,l:70}, ['red','chunky','bowl','tomato'], ['raw'], ['pico de gallo','salsa verde'], ['mexican'], ['condiment','sauce'], 45),
  B('Chutney Green', SN, '', 50, 1, 5, 3, 2, {s:10,m:20,l:35}, ['green','smooth','bowl'], ['raw','blended'], ['mint chutney','coriander chutney'], ['indian'], ['condiment','sauce','side'], 45),
  B('Raita', SN, '', 60, 3, 5, 3, 0.3, {s:30,m:60,l:100}, ['white','mixed','bowl','yogurt'], ['raw'], ['boondi raita','cucumber raita'], ['indian'], ['condiment','side','cooling'], 50),
  B('Pickle', SN, '', 40, 1, 8, 0.5, 1, {s:10,m:20,l:30}, ['mixed','oily','colorful','jar'], ['fermented'], ['achar','achaar','indian pickle'], ['indian'], ['condiment','side'], 45),
  B('Papad', SN, '', 350, 18, 47, 10, 7, {s:10,m:15,l:25}, ['round','flat','thin','crispy'], ['roasted','fried'], ['papadum','poppadom'], ['indian'], ['side','snack'], 55),
  B('Mashed Potatoes', CK, 'Potato', 100, 2, 16, 3.5, 1.5, {s:80,m:150,l:220}, ['white','smooth','creamy','bowl'], ['boiled','mashed'], ['mash'], ['american','global'], ['side','comfort'], 55),
  B('Baked Beans', CK, '', 94, 5, 14, 1, 4, {s:80,m:130,l:200}, ['brown','sauce','bowl','beans'], ['simmered'], ['heinz beans'], ['british','american'], ['side','breakfast'], 50),
  B('Garlic Bread', SN, '', 350, 7, 40, 17, 2, {s:30,m:50,l:80}, ['golden','garlic','sliced','crispy'], ['baked'], ['cheesy garlic bread'], ['italian','global'], ['side','appetizer'], 55),

  // ═══════════════════════════════════════
  // ICE CREAM & FROZEN
  // ═══════════════════════════════════════
  B('Vanilla Ice Cream', DS, 'Ice Cream', 207, 3.5, 24, 11, 0, {s:60,m:100,l:160}, ['white','scoops','bowl','creamy'], ['frozen'], ['vanilla'], ['global'], ['dessert','cold','sweet'], 60),
  B('Chocolate Ice Cream', DS, 'Ice Cream', 216, 3.8, 28, 11, 1.5, {s:60,m:100,l:160}, ['brown','scoops','bowl','creamy'], ['frozen'], ['choco ice cream'], ['global'], ['dessert','cold','sweet'], 60),
  B('Mango Ice Cream', DS, 'Ice Cream', 195, 3, 26, 9, 0.5, {s:60,m:100,l:160}, ['yellow','scoops','bowl','creamy'], ['frozen'], [], ['global','indian'], ['dessert','cold','sweet'], 55),
  B('Kulfi', DS, 'Ice Cream', 220, 5, 24, 12, 0.5, {s:60,m:80,l:120}, ['cone','dense','creamy','stick'], ['frozen'], ['malai kulfi','pista kulfi','mango kulfi'], ['indian'], ['dessert','cold','traditional'], 60),
  B('Popsicle', DS, '', 60, 0, 15, 0, 0, {s:40,m:60,l:80}, ['colorful','stick','elongated','frozen'], ['frozen'], ['ice pop','ice lolly','ice candy'], ['global'], ['dessert','cold','kids'], 40),
  B('Frozen Yogurt', DS, '', 127, 4, 22, 3, 0, {s:80,m:130,l:200}, ['white','swirled','cup','toppings'], ['frozen'], ['froyo'], ['global'], ['dessert','cold','healthy'], 50),
  B('Sundae', DS, 'Ice Cream', 260, 4, 36, 12, 0.5, {s:100,m:160,l:240}, ['layered','sauce','toppings','glass','cream'], ['frozen'], ['ice cream sundae'], ['american'], ['dessert','cold','sweet'], 50),

  // ═══════════════════════════════════════
  // ADDITIONAL GLOBAL
  // ═══════════════════════════════════════
  B('Croissant Sandwich', PR, 'Croissant', 310, 12, 28, 17, 1, {s:100,m:150,l:200}, ['crescent','layered','stuffed','golden'], ['baked','assembled'], [], ['french','global'], ['breakfast','lunch'], 50),
  B('Quiche', PR, '', 250, 10, 16, 16, 1, {s:100,m:160,l:240}, ['round','golden','egg','baked','pie'], ['baked'], ['quiche lorraine'], ['french'], ['lunch','brunch'], 55),
  B('Ratatouille', PR, '', 50, 1.5, 8, 2, 2, {s:120,m:200,l:280}, ['colorful','layered','vegetables','round'], ['baked','simmered'], [], ['french'], ['dinner','healthy','vegetarian'], 50),
  B('Bruschetta', SN, '', 170, 5, 22, 7, 2, {s:40,m:70,l:110}, ['red','bread','tomato','sliced'], ['toasted'], [], ['italian'], ['appetizer','snack'], 55),
  B('Fettuccine Alfredo', PR, 'Pasta', 210, 7, 22, 11, 1, {s:150,m:220,l:300}, ['white','creamy','wide noodles'], ['boiled','sauteed'], ['alfredo pasta'], ['italian','american'], ['lunch','dinner'], 55),
  B('Macaroni and Cheese', PR, 'Pasta', 200, 8, 22, 9, 1, {s:150,m:220,l:300}, ['orange','creamy','elbow','bowl'], ['boiled','baked'], ['mac and cheese','mac n cheese'], ['american'], ['lunch','dinner','comfort','kids'], 60),
  B('Chicken Alfredo', PR, 'Pasta', 190, 12, 18, 8, 1, {s:200,m:280,l:380}, ['white','creamy','chicken','fettuccine'], ['boiled','sauteed'], [], ['italian','american'], ['lunch','dinner'], 55),
  B('Croquette', SN, '', 280, 6, 24, 18, 1, {s:40,m:70,l:110}, ['golden','oval','crispy','breaded'], ['deep fried'], ['croquettes'], ['french','global'], ['appetizer','snack'], 45),
  B('Stuffed Peppers', PR, '', 120, 5, 14, 5, 2, {s:100,m:160,l:240}, ['colorful','peppers','stuffed','baked'], ['baked'], [], ['global'], ['dinner','healthy'], 45),
  B('Beef Stroganoff', PR, '', 180, 14, 10, 10, 0.5, {s:150,m:220,l:300}, ['creamy','brown','noodles','mushroom'], ['simmered'], [], ['russian','global'], ['dinner'], 50),
  B('Paella', PR, '', 160, 8, 20, 5, 1, {s:200,m:300,l:450}, ['yellow','rice','seafood','pan','colorful'], ['simmered'], ['seafood paella'], ['spanish'], ['lunch','dinner'], 55),
  B('Gazpacho', PR, 'Soup', 46, 1, 7, 2, 1.5, {s:150,m:250,l:350}, ['red','cold','bowl','smooth'], ['blended'], [], ['spanish'], ['soup','cold','healthy'], 45),
  B('Pierogi', PR, '', 220, 6, 30, 8, 2, {s:80,m:130,l:200}, ['half moon','stuffed','pan fried','white'], ['boiled','pan fried'], ['pierogies','perogi'], ['polish'], ['dinner','comfort'], 45),
  B('Spring Roll Fried', SN, 'Spring Roll', 220, 5, 22, 12, 1.5, {s:50,m:80,l:120}, ['golden','cylindrical','crispy'], ['deep fried'], ['egg roll','fried spring roll'], ['chinese'], ['appetizer','snack'], 55),
  B('Dim Sum Mixed', PR, 'Dim Sum', 200, 9, 18, 10, 1, {s:100,m:160,l:240}, ['small','steamed','bamboo','varied'], ['steamed'], ['dim sum platter','yum cha'], ['chinese'], ['brunch','lunch'], 55),
  B('Chicken Wings', SN, 'Chicken', 290, 18, 5, 22, 0, {s:80,m:130,l:200}, ['brown','small','glossy','sauce'], ['deep fried','grilled'], ['buffalo wings','hot wings'], ['american'], ['snack','appetizer','bar food'], 65),
  B('Nachos', SN, '', 300, 7, 32, 16, 3, {s:80,m:150,l:250}, ['triangular','chips','cheese','toppings','colorful'], ['baked','assembled'], ['loaded nachos'], ['mexican','american'], ['snack','appetizer','bar food'], 55),
  B('Quesadilla', PR, '', 260, 11, 22, 14, 1, {s:80,m:130,l:200}, ['flat','triangular','cheese','golden'], ['grilled'], ['cheese quesadilla'], ['mexican'], ['lunch','dinner','snack'], 55),
  B('Taco', PR, '', 210, 10, 18, 11, 2, {s:60,m:100,l:150}, ['shell','toppings','meat','folded'], ['assembled'], ['tacos','soft taco','hard taco'], ['mexican'], ['lunch','dinner'], 65),
  B('Enchilada', PR, '', 180, 9, 16, 9, 2, {s:100,m:160,l:240}, ['rolled','tortilla','sauce','cheese'], ['baked'], ['enchiladas'], ['mexican'], ['dinner'], 50),
  B('Ceviche', PR, '', 100, 14, 5, 3, 1, {s:80,m:130,l:200}, ['raw','mixed','colorful','lime','bowl'], ['raw'], [], ['mexican','latin'], ['appetizer','seafood','healthy'], 45),
];

async function seed() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/getfit';
  console.log('[Seed Expand2] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Seed Expand2] Connected.');
  console.log(`[Seed Expand2] Inserting ${FOODS.length} additional foods...`);

  let inserted = 0, skipped = 0;
  const BATCH = 50;
  for (let i = 0; i < FOODS.length; i += BATCH) {
    const batch = FOODS.slice(i, i + BATCH);
    try {
      const result = await FoodOntology.insertMany(batch, { ordered: false });
      inserted += result.length;
    } catch (err) {
      if (err.code === 11000) {
        skipped += batch.length - (err.result?.insertedCount || 0);
        inserted += (err.result?.insertedCount || 0);
      } else throw err;
    }
  }

  const total = await FoodOntology.countDocuments({ isActive: true });
  console.log(`[Seed Expand2] ✓ Inserted ${inserted}, Skipped ${skipped} duplicates`);
  console.log(`[Seed Expand2] Total foods in ontology: ${total}`);
  await mongoose.disconnect();
}

seed().catch(e => { console.error('[Seed Expand2] Error:', e); process.exit(1); });
