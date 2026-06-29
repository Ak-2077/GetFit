/**
 * Seed Food Ontology — Expansion Pack 2
 * 
 * Adds ~800 more foods across all cuisines.
 * Run: node scripts/seedOntologyExpand.js
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

function B(name,cat,parent,cal,p,c,f,fib,g,cues,cook,syn,cuisines,tags,pri,mods) {
  return {
    dishName:name, dishNameLower:name.toLowerCase(), category:cat,
    subcategory:parent?`${parent} dish`:cat, parentFood:(parent||'').toLowerCase(),
    childFoods:[], ingredients:parent?[parent.toLowerCase()]:[name.toLowerCase()],
    primaryIngredient:(parent||name).toLowerCase(),
    visualCues:cues||[], cookingStyles:cook||[], synonyms:syn||[],
    cuisines:cuisines||[], tags:tags||[],
    usdaKeyword:name.toLowerCase(), offKeyword:name.toLowerCase(), getfitKeyword:name.toLowerCase(),
    defaultGrams:g||{small:80,medium:150,large:250},
    caloriesPer100g:cal||0, proteinPer100g:p||0, carbsPer100g:c||0, fatPer100g:f||0, fiberPer100g:fib||0,
    confidenceModifiers:new Map(Object.entries(mods||{})),
    isActive:true, priority:pri||50,
  };
}

const FOODS = [
  // ═══════════════════════════════════════
  // EXPANDED INDIAN — CURRIES & GRAVIES
  // ═══════════════════════════════════════
  B('Kadhi', PR, '', 80, 3, 8, 4, 1, {s:120,m:200,l:280}, ['yellow','liquid','bowl','fritters'], ['simmered'], ['kadhi pakora','besan kadhi'], ['indian'], ['lunch','dinner'], 60),
  B('Kadai Paneer', PR, 'Paneer', 210, 12, 8, 15, 1, {s:120,m:180,l:250}, ['red','dry','peppers','cubed'], ['sauteed'], ['karahi paneer'], ['indian'], ['lunch','dinner','restaurant'], 65),
  B('Matar Paneer', PR, 'Paneer', 195, 10, 10, 13, 2, {s:120,m:180,l:250}, ['red','gravy','peas','cubes'], ['simmered'], ['paneer matar'], ['indian'], ['lunch','dinner'], 60),
  B('Kadai Chicken', PR, 'Chicken', 170, 16, 5, 10, 1, {s:120,m:200,l:280}, ['red','dry','peppers','chicken'], ['sauteed'], ['karahi chicken'], ['indian'], ['lunch','dinner','restaurant'], 65),
  B('Chicken Do Pyaza', PR, 'Chicken', 165, 15, 6, 9, 1, {s:120,m:200,l:280}, ['brown','onion','gravy'], ['simmered'], ['do pyaza'], ['indian'], ['lunch','dinner'], 55),
  B('Chicken Korma', PR, 'Chicken', 190, 13, 8, 12, 1, {s:120,m:200,l:280}, ['white','creamy','mild'], ['simmered'], ['korma'], ['indian'], ['lunch','dinner','mild'], 60),
  B('Rogan Josh', PR, 'Mutton', 190, 18, 4, 11, 1, {s:120,m:200,l:280}, ['red','dark','gravy','meat'], ['simmered'], ['kashmiri rogan josh'], ['indian'], ['lunch','dinner','kashmiri'], 65),
  B('Keema', PR, '', 210, 18, 3, 14, 0.5, {s:100,m:160,l:230}, ['brown','dry','minced'], ['sauteed'], ['kheema','mutton keema','chicken keema'], ['indian'], ['lunch','dinner','protein'], 60),
  B('Keema Pav', PR, 'Keema', 250, 16, 20, 12, 1, {s:150,m:220,l:300}, ['brown','bread','minced'], ['sauteed'], [], ['indian'], ['lunch','dinner','street food'], 55),
  B('Malai Kofta', PR, '', 250, 8, 15, 18, 1, {s:120,m:180,l:250}, ['white','creamy','round','gravy'], ['deep fried','simmered'], [], ['indian'], ['lunch','dinner','rich'], 60),
  B('Dum Aloo', PR, 'Potato', 160, 3, 18, 8, 2, {s:120,m:180,l:250}, ['brown','gravy','whole','potato'], ['simmered'], ['kashmiri dum aloo'], ['indian'], ['lunch','dinner'], 55),
  B('Aloo Tikki', SN, 'Potato', 200, 3, 25, 10, 2, {s:50,m:80,l:120}, ['round','flat','golden','crispy'], ['fried'], ['aloo cutlet','potato tikki'], ['indian'], ['snack','street food'], 65),
  B('Aloo Chaat', SN, 'Potato', 180, 3, 22, 9, 2, {s:80,m:130,l:180}, ['mixed','colorful','cubed'], ['fried','mixed'], [], ['indian'], ['snack','street food'], 55),
  B('Chole Bhature', PR, 'Chole', 350, 10, 40, 16, 6, {s:200,m:300,l:400}, ['puffed','golden','brown','plate'], ['deep fried','simmered'], ['chhole bhature'], ['indian'], ['breakfast','lunch'], 70),
  B('Pindi Chole', PR, 'Chole', 170, 9, 28, 3.5, 8, {s:120,m:200,l:280}, ['dark brown','dry','spiced'], ['simmered'], [], ['indian'], ['lunch','dinner'], 55),
  B('Paneer Tikka Masala', PR, 'Paneer', 230, 13, 10, 16, 1, {s:120,m:180,l:250}, ['orange','creamy','cubes','bowl'], ['grilled','simmered'], [], ['indian'], ['lunch','dinner','restaurant'], 65),
  B('Saag', PR, '', 110, 4, 7, 7, 3, {s:100,m:150,l:220}, ['green','smooth','bowl'], ['simmered'], ['sarson ka saag','palak'], ['indian'], ['lunch','dinner','healthy'], 55),
  B('Mixed Veg Curry', PR, '', 90, 3, 10, 4, 3, {s:120,m:180,l:250}, ['colorful','gravy','mixed','bowl'], ['simmered'], ['subzi','mix veg'], ['indian'], ['lunch','dinner','vegetarian'], 60),
  B('Tinda Masala', PR, '', 75, 2, 8, 4, 2, {s:100,m:150,l:220}, ['green','dry','round'], ['sauteed'], ['apple gourd curry'], ['indian'], ['lunch','dinner'], 45),
  B('Lauki', PR, '', 65, 1.5, 8, 3, 2, {s:100,m:150,l:220}, ['light green','smooth','bowl'], ['sauteed','simmered'], ['bottle gourd','ghiya'], ['indian'], ['lunch','dinner','healthy'], 45),
  B('Karela', PR, '', 80, 2, 7, 5, 3, {s:80,m:130,l:180}, ['green','sliced','bitter'], ['fried','sauteed'], ['bitter gourd','karela fry'], ['indian'], ['lunch','dinner','healthy'], 45),
  B('Arhar Dal', PR, 'Dal', 125, 8, 16, 3, 5, {s:120,m:200,l:280}, ['yellow','liquid','bowl'], ['boiled','tempered'], ['toor dal','pigeon pea dal'], ['indian'], ['lunch','dinner'], 55),
  B('Moong Dal', PR, 'Dal', 105, 7, 14, 2, 4, {s:120,m:200,l:280}, ['yellow','light','bowl'], ['boiled'], ['yellow dal'], ['indian'], ['lunch','dinner','light'], 55),
  B('Chana Dal', PR, 'Dal', 130, 8, 18, 3, 5, {s:120,m:200,l:280}, ['yellow','thick','bowl'], ['boiled','tempered'], ['bengal gram dal'], ['indian'], ['lunch','dinner'], 55),
  B('Masoor Dal', PR, 'Dal', 115, 9, 15, 2, 4, {s:120,m:200,l:280}, ['red','orange','bowl'], ['boiled'], ['red lentil dal'], ['indian'], ['lunch','dinner','quick'], 55),
  B('Urad Dal', PR, 'Dal', 140, 8, 15, 5, 4, {s:120,m:200,l:280}, ['dark','thick','bowl'], ['boiled','tempered'], ['black gram dal'], ['indian'], ['lunch','dinner'], 55),
  B('Rasam', PR, '', 30, 1, 5, 0.5, 1, {s:120,m:200,l:280}, ['red','thin','liquid','spicy'], ['boiled','tempered'], ['pepper rasam','tomato rasam'], ['indian'], ['lunch','dinner','south indian'], 55),
  B('Kootu', PR, '', 80, 4, 10, 3, 3, {s:120,m:180,l:250}, ['thick','yellow','mixed'], ['simmered'], ['dal kootu'], ['indian'], ['lunch','dinner','south indian'], 45),
  B('Aviyal', PR, '', 85, 2, 8, 5, 3, {s:100,m:150,l:220}, ['mixed','coconut','vegetables'], ['simmered'], [], ['indian'], ['lunch','dinner','south indian','kerala'], 50),
  B('Thoran', PR, '', 90, 3, 8, 5, 3, {s:80,m:120,l:180}, ['green','dry','shredded'], ['sauteed'], ['stir fry'], ['indian'], ['lunch','dinner','south indian','kerala'], 45),
  B('Pesarattu', PR, '', 145, 7, 20, 4, 3, {s:60,m:80,l:120}, ['green','flat','crispy'], ['pan fried'], ['moong dal dosa'], ['indian'], ['breakfast','south indian'], 50),
  B('Puttu', PR, '', 200, 3, 40, 3, 2, {s:80,m:120,l:180}, ['cylindrical','white','layered','coconut'], ['steamed'], [], ['indian'], ['breakfast','south indian','kerala'], 50),

  // ═══════════════════════════════════════
  // EXPANDED INDIAN — RICE DISHES
  // ═══════════════════════════════════════
  B('Veg Biryani', PR, 'Rice', 160, 4, 24, 5, 2, {s:200,m:320,l:450}, ['layered','colorful','rice','vegetables'], ['dum cooked'], ['vegetable biryani'], ['indian'], ['lunch','dinner'], 70),
  B('Mutton Biryani', PR, 'Rice', 190, 12, 22, 7, 0.8, {s:200,m:320,l:450}, ['layered','spiced','rice','meat'], ['dum cooked'], ['gosht biryani'], ['indian'], ['lunch','dinner','feast'], 75),
  B('Egg Biryani', PR, 'Rice', 170, 8, 22, 5.5, 0.8, {s:200,m:320,l:450}, ['layered','rice','egg'], ['dum cooked'], ['anda biryani'], ['indian'], ['lunch','dinner'], 60),
  B('Fish Biryani', PR, 'Rice', 175, 11, 22, 5, 0.8, {s:200,m:320,l:450}, ['layered','rice','fish'], ['dum cooked'], [], ['indian'], ['lunch','dinner'], 55),
  B('Prawn Biryani', PR, 'Rice', 165, 12, 22, 4, 0.8, {s:200,m:320,l:450}, ['layered','rice','prawns'], ['dum cooked'], ['shrimp biryani'], ['indian'], ['lunch','dinner'], 55),
  B('Tamarind Rice', PR, 'Rice', 150, 3, 28, 3.5, 1, {s:100,m:150,l:250}, ['brown','tangy','rice'], ['tempered'], ['puliyodarai','pulihora'], ['indian'], ['lunch','south indian'], 50),
  B('Coconut Rice', PR, 'Rice', 175, 3, 26, 7, 1.5, {s:100,m:150,l:250}, ['white','coconut','rice'], ['tempered'], ['thengai sadam'], ['indian'], ['lunch','south indian'], 50),
  B('Tomato Rice', PR, 'Rice', 145, 3, 25, 3.5, 1, {s:100,m:150,l:250}, ['red','rice','spiced'], ['tempered'], ['tomato bath'], ['indian'], ['lunch','south indian'], 50),
  B('Pongal Rice', PR, 'Rice', 115, 3, 18, 3.5, 1, {s:100,m:150,l:250}, ['yellow','mushy','pepper'], ['boiled'], ['ven pongal'], ['indian'], ['breakfast','south indian'], 55),
  B('Bisi Bele Bath', PR, 'Rice', 135, 5, 20, 4, 2, {s:150,m:220,l:300}, ['brown','thick','mixed','spiced'], ['simmered'], ['bisibelebath'], ['indian'], ['lunch','south indian','karnataka'], 50),

  // ═══════════════════════════════════════
  // EXPANDED INDIAN — BREADS
  // ═══════════════════════════════════════
  B('Paneer Paratha', PR, 'Paratha', 260, 8, 30, 12, 2, {s:60,m:80,l:110}, ['round','flat','golden','stuffed'], ['pan fried'], [], ['indian'], ['breakfast','lunch'], 60),
  B('Methi Paratha', PR, 'Paratha', 230, 6, 32, 9, 2.5, {s:50,m:65,l:85}, ['round','flat','green specks'], ['pan fried'], ['fenugreek paratha'], ['indian'], ['breakfast','lunch'], 55),
  B('Mooli Paratha', PR, 'Paratha', 220, 5, 30, 9, 2, {s:60,m:80,l:110}, ['round','flat','golden'], ['pan fried'], ['radish paratha'], ['indian'], ['breakfast','lunch'], 55),
  B('Pyaaz Kachori', SN, '', 340, 5, 32, 21, 2, {s:50,m:75,l:100}, ['round','golden','puffed','crispy'], ['deep fried'], ['onion kachori'], ['indian'], ['snack','breakfast','rajasthani'], 55),
  B('Thepla', PR, '', 250, 6, 30, 12, 3, {s:30,m:45,l:60}, ['round','flat','thin','green specks'], ['pan fried'], ['methi thepla'], ['indian'], ['breakfast','snack','gujarati'], 55),
  B('Dhokla', SN, '', 160, 6, 25, 4, 2, {s:50,m:80,l:120}, ['yellow','spongy','square','steamed'], ['steamed'], ['khaman dhokla','besan dhokla'], ['indian'], ['snack','gujarati','breakfast'], 65),
  B('Khandvi', SN, '', 140, 5, 18, 5, 1, {s:40,m:60,l:100}, ['rolled','yellow','thin','small'], ['steamed','tempered'], [], ['indian'], ['snack','gujarati'], 50),
  B('Handvo', SN, '', 180, 6, 22, 7, 2, {s:60,m:100,l:150}, ['round','flat','thick','brown'], ['baked'], [], ['indian'], ['snack','gujarati'], 45),
  B('Litti Chokha', PR, '', 220, 5, 32, 8, 3, {s:60,m:90,l:130}, ['round','brown','hard'], ['baked','roasted'], ['litti'], ['indian'], ['lunch','bihari'], 50),
  B('Missi Roti', PR, '', 280, 10, 40, 9, 5, {s:35,m:50,l:65}, ['round','flat','brown','thick'], ['dry roasted'], ['besan roti'], ['indian'], ['lunch','dinner','rajasthani'], 50),
  B('Rumali Roti', PR, '', 210, 7, 38, 3, 2, {s:25,m:35,l:50}, ['round','thin','large','soft'], ['roasted'], ['roomali roti'], ['indian'], ['lunch','dinner','restaurant'], 50),
  B('Tandoori Roti', PR, '', 250, 8, 42, 5, 3, {s:35,m:50,l:65}, ['round','flat','charred','thick'], ['tandoori'], [], ['indian'], ['lunch','dinner','restaurant'], 55),
  B('Makki Ki Roti', PR, '', 280, 5, 48, 7, 5, {s:40,m:55,l:75}, ['round','flat','yellow','thick'], ['dry roasted'], ['corn roti','maize roti'], ['indian'], ['lunch','dinner','punjabi'], 50),

  // ═══════════════════════════════════════
  // EXPANDED INDIAN — SNACKS & SWEETS
  // ═══════════════════════════════════════
  B('Bhel Puri', SN, 'Chaat', 180, 3, 26, 7, 2, {s:60,m:100,l:150}, ['mixed','puffed rice','colorful'], ['mixed'], [], ['indian'], ['snack','street food'], 60),
  B('Sev Puri', SN, 'Chaat', 200, 3, 24, 10, 1.5, {s:60,m:100,l:150}, ['flat','toppings','colorful'], ['assembled'], [], ['indian'], ['snack','street food'], 55),
  B('Papdi Chaat', SN, 'Chaat', 190, 4, 22, 9, 1.5, {s:80,m:130,l:180}, ['flat','yogurt','colorful'], ['assembled'], [], ['indian'], ['snack','street food'], 55),
  B('Ragda Pattice', SN, '', 220, 5, 28, 10, 3, {s:100,m:150,l:200}, ['flat','gravy','round'], ['fried','simmered'], [], ['indian'], ['snack','street food'], 50),
  B('Dabeli', SN, '', 260, 4, 32, 12, 2, {s:80,m:120,l:160}, ['round','bread','stuffed'], ['assembled'], ['kutchi dabeli'], ['indian'], ['snack','street food','gujarati'], 55),
  B('Misal Pav', PR, '', 230, 8, 28, 9, 4, {s:150,m:220,l:300}, ['spicy','sprouts','bread','bowl'], ['simmered'], ['misal'], ['indian'], ['breakfast','street food','maharashtrian'], 60),
  B('Poha Jalebi', PR, '', 280, 4, 45, 10, 1, {s:100,m:160,l:220}, ['yellow','orange','mixed'], ['sauteed','deep fried'], [], ['indian'], ['breakfast','street food','indori'], 50),
  B('Medu Vada', SN, 'Vada', 290, 6, 25, 18, 2, {s:35,m:50,l:65}, ['round','golden','donut','crispy'], ['deep fried'], ['urad vada'], ['indian'], ['breakfast','south indian'], 60),
  B('Masala Vada', SN, 'Vada', 270, 8, 22, 16, 3, {s:35,m:50,l:65}, ['round','flat','golden','rough'], ['deep fried'], ['paruppu vadai','chana dal vada'], ['indian'], ['snack','south indian'], 55),
  B('Bonda', SN, '', 300, 4, 30, 18, 2, {s:40,m:60,l:90}, ['round','golden','smooth'], ['deep fried'], ['aloo bonda','mysore bonda'], ['indian'], ['snack','south indian'], 55),
  B('Bajji', SN, '', 250, 4, 24, 15, 2, {s:30,m:50,l:80}, ['golden','irregular','crispy'], ['deep fried'], ['bhajji','pakoda'], ['indian'], ['snack','south indian'], 50),
  B('Murukku', SN, '', 430, 6, 50, 22, 3, {s:20,m:30,l:50}, ['spiral','golden','crunchy','small'], ['deep fried'], ['chakli','muruku'], ['indian'], ['snack','south indian','diwali'], 55),
  B('Namak Pare', SN, '', 420, 6, 48, 22, 2, {s:20,m:35,l:55}, ['small','diamond','golden','crunchy'], ['deep fried'], ['nimki'], ['indian'], ['snack','tea time'], 45),
  B('Mathri', SN, '', 440, 7, 45, 25, 2, {s:15,m:25,l:40}, ['round','flat','flaky','small'], ['deep fried'], [], ['indian'], ['snack','rajasthani','tea time'], 45),
  B('Gajar Halwa', DS, 'Halwa', 200, 3, 28, 9, 1.5, {s:60,m:100,l:150}, ['orange','glossy','bowl','carrots'], ['simmered'], ['carrot halwa'], ['indian'], ['dessert','winter','festival'], 65),
  B('Moong Dal Halwa', DS, 'Halwa', 350, 5, 35, 20, 2, {s:50,m:80,l:120}, ['golden','glossy','rich'], ['simmered'], [], ['indian'], ['dessert','festival','rajasthani'], 55),
  B('Suji Halwa', DS, 'Halwa', 260, 3, 32, 13, 1, {s:50,m:80,l:120}, ['golden','smooth','glossy'], ['simmered'], ['sheera','rava kesari'], ['indian'], ['dessert','prasad'], 60),
  B('Rasmalai', DS, '', 200, 7, 28, 7, 0, {s:50,m:80,l:120}, ['white','flat','cream','saffron'], ['boiled','soaked'], ['ras malai'], ['indian'], ['dessert','sweet','festival'], 65),
  B('Sandesh', DS, '', 280, 8, 35, 12, 0, {s:25,m:40,l:60}, ['white','small','decorated','flat'], ['molded'], ['sondesh'], ['indian'], ['dessert','bengali'], 50),
  B('Rasgulla Rosogolla', DS, '', 186, 6, 35, 2, 0, {s:30,m:50,l:70}, ['round','white','spongy','syrup'], ['boiled'], ['rosogolla'], ['indian'], ['dessert','bengali'], 50),
  B('Peda', DS, '', 390, 7, 50, 18, 0, {s:15,m:25,l:40}, ['round','flat','golden','small'], ['molded'], ['mathura peda','doodh peda'], ['indian'], ['dessert','sweet'], 50),
  B('Kaju Katli', DS, 'Barfi', 500, 10, 45, 30, 1, {s:15,m:25,l:40}, ['diamond','silver','flat','thin'], ['set'], ['kaju barfi','cashew barfi'], ['indian'], ['dessert','festival','diwali'], 65),
  B('Mysore Pak', DS, '', 480, 4, 40, 34, 1, {s:20,m:35,l:55}, ['golden','square','crumbly'], ['fried'], [], ['indian'], ['dessert','south indian','mysore'], 55),
  B('Payasam', DS, 'Kheer', 130, 3.5, 20, 4.5, 0.5, {s:80,m:120,l:180}, ['white','liquid','bowl','vermicelli'], ['boiled','simmered'], ['semiya payasam','ada payasam'], ['indian'], ['dessert','south indian','kerala'], 55),
  B('Shrikhand', DS, '', 280, 5, 35, 13, 0, {s:60,m:100,l:150}, ['white','creamy','smooth','saffron'], ['fermented'], ['amrakhand'], ['indian'], ['dessert','gujarati','maharashtrian'], 55),
  B('Malpua', DS, '', 350, 5, 42, 18, 0.5, {s:40,m:60,l:90}, ['round','flat','golden','soaked'], ['deep fried','soaked'], [], ['indian'], ['dessert','bihari','holi'], 50),
  B('Imarti', DS, 'Jalebi', 380, 3, 50, 18, 0, {s:25,m:40,l:60}, ['flower shaped','orange','soaked','crispy'], ['deep fried','soaked'], ['amriti','jangiri'], ['indian'], ['dessert','sweet','festival'], 50),

  // ═══════════════════════════════════════
  // EXPANDED INDIAN — DRINKS
  // ═══════════════════════════════════════
  B('Masala Chai', BV, 'Chai', 50, 1.5, 6, 1.5, 0, {s:100,m:150,l:200}, ['brown','hot','cup','spiced'], ['boiled'], ['spiced tea'], ['indian'], ['beverage','hot','daily'], 65),
  B('Green Tea', BV, '', 1, 0, 0, 0, 0, {s:100,m:200,l:300}, ['green','clear','cup','light'], ['brewed'], ['matcha'], ['global','japanese'], ['beverage','hot','healthy'], 50),
  B('Black Tea', BV, 'Chai', 2, 0, 0.5, 0, 0, {s:100,m:200,l:300}, ['dark','clear','cup'], ['brewed'], ['plain tea'], ['global'], ['beverage','hot'], 45),
  B('Filter Coffee', BV, 'Coffee', 80, 2, 8, 4, 0, {s:100,m:150,l:200}, ['brown','frothy','tumbler','steel'], ['brewed','steamed'], ['south indian coffee','kaapi'], ['indian'], ['beverage','hot','south indian'], 60),
  B('Cold Coffee', BV, 'Coffee', 150, 4, 20, 6, 0, {s:200,m:300,l:400}, ['brown','cold','glass','ice','cream'], ['blended'], ['iced coffee'], ['global'], ['beverage','cold'], 55),
  B('Mango Lassi', BV, 'Lassi', 120, 3, 18, 3.5, 0.5, {s:150,m:200,l:300}, ['orange','glass','creamy','thick'], ['blended'], [], ['indian'], ['beverage','cold','mango'], 60),
  B('Sweet Lassi', BV, 'Lassi', 90, 3, 12, 3, 0, {s:150,m:200,l:300}, ['white','glass','frothy'], ['blended'], [], ['indian'], ['beverage','cold'], 55),
  B('Jaljeera', BV, '', 25, 0.5, 5, 0.2, 0, {s:150,m:250,l:350}, ['green','glass','clear'], ['mixed'], ['jal jeera'], ['indian'], ['beverage','cold','summer'], 45),
  B('Aam Panna', BV, '', 50, 0.5, 12, 0.2, 0.5, {s:150,m:250,l:350}, ['green','glass','tangy'], ['mixed'], ['raw mango drink'], ['indian'], ['beverage','cold','summer'], 45),
  B('Thandai', BV, '', 130, 4, 16, 5, 1, {s:150,m:250,l:350}, ['white','glass','creamy','nuts'], ['blended'], [], ['indian'], ['beverage','cold','holi','festival'], 50),
  B('Sugarcane Juice', BV, '', 70, 0.5, 17, 0, 0, {s:200,m:300,l:400}, ['green','glass','fresh'], ['squeezed'], ['ganna juice'], ['indian'], ['beverage','cold','street food'], 50),
  B('Badam Milk', BV, '', 120, 5, 14, 5, 1, {s:150,m:200,l:300}, ['white','glass','almond','saffron'], ['boiled','blended'], ['almond milk drink','kesar badam'], ['indian'], ['beverage','hot','healthy'], 50),

  // ═══════════════════════════════════════
  // EXPANDED ITALIAN
  // ═══════════════════════════════════════
  B('Ravioli', PR, 'Pasta', 220, 10, 28, 8, 1.5, {s:150,m:220,l:300}, ['stuffed','square','sauce'], ['boiled'], ['cheese ravioli','meat ravioli'], ['italian'], ['lunch','dinner'], 60),
  B('Gnocchi', PR, 'Pasta', 180, 4, 33, 3, 2, {s:150,m:220,l:300}, ['round','small','pillowy','sauce'], ['boiled'], ['potato gnocchi'], ['italian'], ['lunch','dinner'], 55),
  B('Tortellini', PR, 'Pasta', 250, 11, 30, 9, 1.5, {s:150,m:220,l:300}, ['ring shaped','small','stuffed'], ['boiled'], [], ['italian'], ['lunch','dinner'], 55),
  B('Carbonara', PR, 'Pasta', 200, 10, 22, 9, 1, {s:150,m:220,l:300}, ['creamy','yellow','egg','bacon'], ['boiled','mixed'], ['spaghetti carbonara'], ['italian'], ['lunch','dinner'], 65),
  B('Bolognese', PR, 'Pasta', 150, 8, 18, 5, 2, {s:150,m:220,l:300}, ['red','meat','sauce'], ['simmered'], ['ragu','meat sauce pasta'], ['italian'], ['lunch','dinner'], 65),
  B('Pesto Pasta', PR, 'Pasta', 185, 6, 22, 8, 1.5, {s:150,m:220,l:300}, ['green','basil','bowl'], ['boiled','mixed'], ['pasta al pesto'], ['italian'], ['lunch','dinner'], 55),
  B('Arrabbiata', PR, 'Pasta', 140, 5, 24, 3, 2, {s:150,m:220,l:300}, ['red','spicy','sauce'], ['boiled','simmered'], ['penne arrabbiata'], ['italian'], ['lunch','dinner'], 55),
  B('Focaccia', PR, '', 271, 8, 40, 8, 2, {s:40,m:70,l:100}, ['flat','thick','olive oil','herbs'], ['baked'], [], ['italian'], ['bread','side','appetizer'], 55),
  B('Calzone', PR, 'Pizza', 240, 10, 28, 10, 2, {s:150,m:250,l:350}, ['folded','half moon','sealed','baked'], ['baked'], [], ['italian'], ['lunch','dinner'], 55),
  B('Minestrone', PR, 'Soup', 55, 3, 9, 1, 2, {s:150,m:250,l:350}, ['red','thick','vegetables','bowl'], ['simmered'], ['minestrone soup'], ['italian'], ['soup','healthy','lunch'], 50),
  B('Risotto Mushroom', PR, 'Risotto', 150, 4, 22, 5, 1, {s:150,m:220,l:300}, ['creamy','brown','bowl','mushroom'], ['simmered'], [], ['italian'], ['lunch','dinner'], 55),
  B('Caprese Salad', PR, 'Salad', 250, 12, 5, 20, 1, {s:80,m:150,l:220}, ['red','white','green','layered','tomato'], ['raw'], ['insalata caprese'], ['italian'], ['appetizer','healthy'], 55),
  B('Antipasto', SN, '', 180, 8, 5, 14, 1, {s:80,m:150,l:250}, ['mixed','colorful','platter','meats','cheese'], ['raw'], ['antipasto platter'], ['italian'], ['appetizer'], 50),
  B('Prosciutto', IN, '', 250, 24, 0.5, 16, 0, {s:20,m:40,l:70}, ['thin','pink','sliced','rolled'], ['cured'], ['parma ham'], ['italian'], ['protein','appetizer'], 50),
  B('Pannacotta', DS, '', 240, 4, 22, 15, 0, {s:80,m:120,l:170}, ['white','smooth','dome','sauce'], ['set'], ['panna cotta'], ['italian'], ['dessert','sweet'], 55),
  B('Gelato', DS, 'Ice Cream', 190, 3.5, 22, 10, 0, {s:60,m:100,l:150}, ['scoops','colorful','smooth','creamy'], ['frozen'], [], ['italian'], ['dessert','cold','sweet'], 60),
  B('Cannoli', DS, '', 320, 7, 30, 19, 1, {s:50,m:80,l:120}, ['cylindrical','crispy','cream','dusted'], ['deep fried','filled'], [], ['italian'], ['dessert','sweet'], 55),

  // ═══════════════════════════════════════
  // EXPANDED CHINESE & ASIAN
  // ═══════════════════════════════════════
  B('Schezwan Noodles', PR, 'Noodles', 160, 5, 24, 5, 1, {s:150,m:200,l:300}, ['red','spicy','strings'], ['stir fried'], ['szechuan noodles'], ['chinese','indian'], ['lunch','dinner','spicy'], 60),
  B('Singapore Noodles', PR, 'Noodles', 155, 6, 22, 5, 1.5, {s:150,m:200,l:300}, ['yellow','curry','strings','mixed'], ['stir fried'], [], ['chinese'], ['lunch','dinner'], 55),
  B('Chili Chicken', PR, 'Chicken', 180, 14, 10, 9, 1, {s:100,m:160,l:220}, ['red','glossy','peppers'], ['deep fried','sauteed'], ['chilli chicken'], ['chinese','indian'], ['dinner','spicy'], 65),
  B('Chili Paneer', PR, 'Paneer', 220, 12, 10, 15, 1, {s:100,m:160,l:220}, ['red','glossy','peppers','cubes'], ['deep fried','sauteed'], ['chilli paneer'], ['chinese','indian'], ['appetizer','spicy'], 65),
  B('Manchow Soup', PR, 'Soup', 70, 3, 8, 3, 1, {s:150,m:250,l:350}, ['dark','thick','noodles','bowl'], ['simmered'], [], ['chinese','indian'], ['soup','appetizer'], 55),
  B('Hot and Sour Soup', PR, 'Soup', 55, 3, 7, 2, 0.5, {s:150,m:250,l:350}, ['dark','thick','spicy','bowl'], ['simmered'], ['hot sour soup'], ['chinese'], ['soup','appetizer'], 55),
  B('Fried Momos', SN, 'Momos', 250, 8, 22, 14, 1, {s:60,m:100,l:150}, ['golden','crispy','crescent'], ['deep fried'], ['fried dumplings'], ['chinese','indian','tibetan'], ['snack','street food'], 65),
  B('Tandoori Momos', SN, 'Momos', 210, 9, 20, 10, 1, {s:60,m:100,l:150}, ['red','charred','round'], ['grilled','tandoori'], [], ['indian','tibetan'], ['snack','fusion'], 55),
  B('Steamed Momos', SN, 'Momos', 180, 8, 20, 7, 1, {s:60,m:100,l:150}, ['white','pleated','steamed','soft'], ['steamed'], [], ['chinese','indian','tibetan'], ['snack'], 65),
  B('Sesame Chicken', PR, 'Chicken', 200, 15, 15, 9, 1, {s:120,m:180,l:260}, ['golden','sesame seeds','glazed'], ['deep fried','glazed'], [], ['chinese'], ['dinner'], 55),
  B('General Tso Chicken', PR, 'Chicken', 220, 14, 18, 10, 1, {s:120,m:180,l:260}, ['golden','glossy','sauce','red'], ['deep fried','glazed'], ["general tso's"], ['chinese','american'], ['dinner'], 55),
  B('Mapo Tofu', PR, '', 130, 8, 6, 8, 1, {s:120,m:180,l:260}, ['red','spicy','cubes','bowl'], ['simmered'], [], ['chinese'], ['dinner','spicy'], 50),
  B('Char Siu', CK, '', 250, 20, 12, 14, 0, {s:80,m:130,l:200}, ['red','glazed','sliced','pork'], ['roasted'], ['BBQ pork','chinese barbecue pork'], ['chinese'], ['dinner','protein'], 55),
  B('Congee', PR, 'Rice', 46, 1, 8, 0.3, 0.2, {s:200,m:300,l:450}, ['white','smooth','bowl','porridge'], ['boiled'], ['jook','rice porridge'], ['chinese'], ['breakfast','comfort'], 55),
  B('Dumplings', SN, 'Dim Sum', 200, 8, 20, 9, 1, {s:60,m:100,l:160}, ['pleated','crescent','small'], ['steamed','fried','boiled'], ['gyoza','potstickers','jiaozi'], ['chinese','japanese'], ['appetizer','snack'], 65),
  B('Gyoza', SN, 'Dumplings', 210, 8, 22, 10, 1, {s:60,m:100,l:150}, ['crescent','pan fried','crispy bottom'], ['pan fried'], ['japanese dumplings','potstickers'], ['japanese'], ['appetizer','snack'], 60),
  B('Yakitori', SN, '', 180, 20, 3, 9, 0, {s:60,m:100,l:160}, ['skewer','charred','small','brown'], ['grilled'], ['chicken yakitori'], ['japanese'], ['appetizer','protein','grilled'], 55),
  B('Katsu', PR, 'Chicken', 250, 18, 15, 13, 1, {s:100,m:150,l:220}, ['breaded','golden','flat','sliced'], ['deep fried'], ['tonkatsu','chicken katsu','katsu curry'], ['japanese'], ['dinner','lunch'], 60),
  B('Udon', PR, 'Noodles', 105, 3, 22, 0.5, 1, {s:200,m:300,l:400}, ['thick','white','noodles','bowl','broth'], ['boiled'], ['udon noodles'], ['japanese'], ['lunch','dinner','comfort'], 55),
  B('Soba', PR, 'Noodles', 99, 5, 20, 0.5, 1.5, {s:150,m:250,l:350}, ['brown','thin','noodles','bowl'], ['boiled'], ['buckwheat noodles'], ['japanese'], ['lunch','dinner','healthy'], 50),
  B('Donburi', PR, 'Rice', 180, 10, 26, 4, 1, {s:200,m:300,l:400}, ['bowl','rice','topping','egg'], ['simmered'], ['rice bowl','gyudon','katsudon'], ['japanese'], ['lunch','dinner'], 55),
  B('Bibimbap', PR, 'Rice', 160, 8, 24, 4, 2, {s:200,m:350,l:450}, ['bowl','rice','vegetables','egg','colorful'], ['mixed'], [], ['korean'], ['lunch','dinner','healthy'], 60),
  B('Kimchi', SN, '', 15, 1, 2, 0.3, 2, {s:30,m:50,l:80}, ['red','fermented','cabbage','small'], ['fermented'], [], ['korean'], ['side','healthy','fermented'], 50),
  B('Korean Fried Chicken', PR, 'Chicken', 280, 18, 14, 17, 0.5, {s:100,m:160,l:240}, ['golden','crispy','glazed','sauce'], ['deep fried','glazed'], ['KFC','yangnyeom chicken'], ['korean'], ['dinner','snack'], 60),
  B('Pho', PR, 'Noodles', 60, 5, 6, 2, 0.5, {s:300,m:450,l:600}, ['bowl','noodles','broth','herbs','clear'], ['simmered'], ['vietnamese pho','beef pho'], ['vietnamese'], ['lunch','dinner'], 60),
  B('Banh Mi', PR, 'Sandwich', 250, 12, 32, 8, 2, {s:120,m:180,l:250}, ['bread','layered','vegetables','elongated'], ['baked','assembled'], ['vietnamese sandwich'], ['vietnamese'], ['lunch','snack'], 55),

  // ═══════════════════════════════════════
  // EXPANDED MEXICAN & LATIN
  // ═══════════════════════════════════════
  B('Churros', DS, '', 370, 4, 44, 20, 1, {s:40,m:70,l:100}, ['long','ridged','golden','sugar'], ['deep fried'], [], ['mexican','spanish'], ['dessert','sweet','snack'], 60),
  B('Fajitas', PR, '', 200, 15, 12, 10, 2, {s:120,m:200,l:300}, ['strips','peppers','colorful','sizzling'], ['grilled'], ['chicken fajitas','beef fajitas'], ['mexican'], ['dinner'], 55),
  B('Tamale', PR, '', 200, 7, 22, 9, 2, {s:100,m:150,l:220}, ['wrapped','corn husk','steamed'], ['steamed'], ['tamales'], ['mexican'], ['lunch','dinner'], 50),
  B('Elote', SN, '', 150, 4, 22, 6, 3, {s:100,m:150,l:200}, ['corn','grilled','white','cheese'], ['grilled'], ['mexican corn','street corn'], ['mexican'], ['snack','street food'], 50),
  B('Pozole', PR, 'Soup', 100, 7, 12, 3, 2, {s:200,m:300,l:450}, ['red','bowl','hominy','broth'], ['simmered'], [], ['mexican'], ['soup','dinner'], 50),
  B('Chilaquiles', PR, '', 230, 8, 22, 12, 3, {s:150,m:220,l:300}, ['chips','sauce','cheese','egg'], ['simmered'], [], ['mexican'], ['breakfast'], 50),
  B('Empanada', SN, '', 280, 8, 28, 15, 2, {s:60,m:100,l:150}, ['half moon','golden','crimped','stuffed'], ['baked','fried'], ['empanadas'], ['mexican','latin'], ['snack','appetizer'], 55),

  // ═══════════════════════════════════════
  // EXPANDED AMERICAN & WESTERN
  // ═══════════════════════════════════════
  B('BBQ Ribs', PR, '', 280, 20, 8, 19, 0, {s:150,m:250,l:400}, ['brown','glazed','bone','rack'], ['grilled','smoked'], ['pork ribs','baby back ribs'], ['american'], ['dinner','protein','BBQ'], 60),
  B('Pulled Pork', PR, '', 240, 22, 5, 14, 0, {s:100,m:150,l:250}, ['shredded','brown','sauce'], ['smoked','braised'], ['pulled pork sandwich'], ['american'], ['lunch','dinner','BBQ'], 55),
  B('Fish and Chips', PR, '', 260, 12, 25, 13, 2, {s:200,m:300,l:400}, ['golden','battered','chips','fish'], ['deep fried'], ['fish n chips'], ['british'], ['lunch','dinner'], 65),
  B('Shepherd Pie', PR, '', 130, 8, 12, 6, 2, {s:150,m:250,l:350}, ['layered','mashed top','brown','baked'], ['baked'], ["shepherd's pie",'cottage pie'], ['british'], ['dinner','comfort'], 55),
  B('Clam Chowder', PR, 'Soup', 90, 5, 10, 3, 0.5, {s:200,m:300,l:400}, ['white','thick','creamy','bowl'], ['simmered'], ['new england clam chowder'], ['american'], ['soup','dinner'], 50),
  B('Chicken Pot Pie', PR, '', 230, 10, 22, 12, 2, {s:150,m:250,l:350}, ['golden','round','crust','baked'], ['baked'], [], ['american'], ['dinner','comfort'], 55),
  B('Meatball', PR, '', 240, 16, 8, 16, 0.5, {s:50,m:100,l:160}, ['round','brown','sauce'], ['fried','baked'], ['meatballs','swedish meatballs'], ['american','italian'], ['dinner','protein'], 55),
  B('Meatloaf', PR, '', 200, 15, 8, 12, 0.5, {s:100,m:160,l:240}, ['loaf','sliced','brown','glazed'], ['baked'], [], ['american'], ['dinner','comfort'], 50),
  B('Chicken Nuggets', SN, 'Chicken', 300, 15, 18, 18, 1, {s:60,m:100,l:160}, ['small','golden','breaded','nugget'], ['deep fried'], ['mcnuggets','nuggets'], ['american'], ['snack','fast food','kids'], 65),
  B('Chicken Tenders', SN, 'Chicken', 270, 18, 14, 16, 0.5, {s:80,m:130,l:200}, ['strips','golden','breaded'], ['deep fried'], ['chicken strips','chicken fingers'], ['american'], ['snack','fast food'], 60),
  B('Onion Rings', SN, '', 330, 4, 36, 18, 2, {s:60,m:100,l:160}, ['round','ring','golden','breaded'], ['deep fried'], [], ['american'], ['side','snack','fast food'], 55),
  B('Corn Dog', SN, '', 330, 10, 32, 18, 1, {s:80,m:120,l:160}, ['stick','golden','elongated','battered'], ['deep fried'], [], ['american'], ['snack','fast food','fair'], 50),
  B('Loaded Fries', SN, 'French Fries', 350, 8, 38, 18, 3, {s:100,m:180,l:280}, ['golden','cheese','toppings','bacon'], ['deep fried','topped'], ['cheese fries','poutine'], ['american'], ['snack','fast food'], 55),
  B('Coleslaw', PR, 'Salad', 100, 1, 10, 6, 1.5, {s:60,m:100,l:160}, ['white','shredded','creamy','mixed'], ['raw'], ['cole slaw'], ['american'], ['side','healthy'], 45),
  B('Cobb Salad', PR, 'Salad', 150, 12, 6, 9, 2, {s:150,m:250,l:350}, ['mixed','colorful','egg','bacon','cheese'], ['raw'], [], ['american'], ['lunch','healthy'], 50),
  B('BLT Sandwich', PR, 'Sandwich', 280, 12, 24, 15, 2, {s:120,m:170,l:220}, ['layered','bread','bacon','tomato','lettuce'], ['toasted'], ['BLT'], ['american'], ['lunch'], 50),
  B('Club Sandwich', PR, 'Sandwich', 290, 15, 26, 14, 2, {s:130,m:180,l:240}, ['layered','triple deck','toothpick'], ['toasted'], [], ['american'], ['lunch'], 55),
  B('Philly Cheesesteak', PR, 'Sandwich', 270, 16, 24, 12, 1, {s:150,m:230,l:310}, ['elongated','bread','meat','cheese','melted'], ['grilled'], ['cheesesteak'], ['american'], ['lunch','dinner'], 55),
  B('Eggs Benedict', PR, 'Egg', 250, 14, 16, 15, 0.5, {s:150,m:200,l:280}, ['layered','round','poached','hollandaise','muffin'], ['poached'], [], ['american'], ['breakfast','brunch'], 60),
  B('Acai Bowl', PR, '', 210, 4, 38, 6, 5, {s:150,m:250,l:350}, ['purple','bowl','toppings','granola','fruit'], ['blended'], ['acai','smoothie bowl'], ['american','brazilian'], ['breakfast','healthy','gym'], 60),
  B('Overnight Oats', PR, 'Oats', 140, 5, 22, 4, 3, {s:150,m:250,l:350}, ['layered','glass','mixed','fruit','seeds'], ['soaked'], [], ['global'], ['breakfast','healthy','gym'], 55),

  // ═══════════════════════════════════════
  // EXPANDED THAI & SOUTHEAST ASIAN
  // ═══════════════════════════════════════
  B('Massaman Curry', PR, '', 150, 8, 10, 9, 1, {s:150,m:220,l:300}, ['brown','thick','potato','bowl'], ['simmered'], ['massaman'], ['thai'], ['lunch','dinner'], 55),
  B('Red Curry', PR, '', 135, 8, 6, 9, 1, {s:150,m:220,l:300}, ['red','coconut','bowl'], ['simmered'], ['thai red curry'], ['thai'], ['lunch','dinner','spicy'], 55),
  B('Yellow Curry', PR, '', 120, 7, 8, 7, 1, {s:150,m:220,l:300}, ['yellow','coconut','bowl','potato'], ['simmered'], ['thai yellow curry'], ['thai'], ['lunch','dinner'], 50),
  B('Som Tum', PR, 'Salad', 80, 2, 12, 3, 3, {s:80,m:130,l:200}, ['green','shredded','mixed','papaya'], ['raw'], ['papaya salad','green papaya salad'], ['thai'], ['appetizer','healthy'], 50),
  B('Mango Sticky Rice', DS, '', 200, 3, 38, 5, 1, {s:100,m:150,l:220}, ['white','yellow','mango','coconut'], ['steamed'], ['khao niao mamuang'], ['thai'], ['dessert','sweet'], 60),
  B('Larb', PR, '', 150, 15, 5, 8, 1, {s:100,m:150,l:220}, ['minced','mixed','herbs','bowl'], ['sauteed'], ['laab','minced meat salad'], ['thai'], ['dinner','protein'], 50),
  B('Nasi Goreng', PR, 'Rice', 170, 6, 25, 5, 1, {s:150,m:250,l:350}, ['brown','fried','egg','mixed'], ['stir fried'], ['indonesian fried rice'], ['indonesian'], ['lunch','dinner'], 55),
  B('Rendang', PR, '', 200, 18, 4, 12, 1, {s:100,m:150,l:220}, ['dark brown','dry','tender'], ['simmered'], ['beef rendang'], ['indonesian','malaysian'], ['lunch','dinner','rich'], 55),
  B('Laksa', PR, 'Soup', 120, 6, 14, 5, 1, {s:300,m:400,l:500}, ['orange','noodles','broth','coconut'], ['simmered'], ['curry laksa'], ['malaysian','singaporean'], ['lunch','dinner'], 55),

  // ═══════════════════════════════════════
  // EXPANDED MIDDLE EASTERN & MEDITERRANEAN
  // ═══════════════════════════════════════
  B('Hummus', SN, '', 166, 8, 14, 10, 6, {s:30,m:60,l:100}, ['creamy','smooth','bowl','drizzle'], ['blended'], ['houmous'], ['middle eastern'], ['appetizer','healthy','protein'], 60),
  B('Falafel', SN, '', 333, 13, 32, 18, 6, {s:40,m:70,l:100}, ['round','golden','crispy','small'], ['deep fried'], ['felafel'], ['middle eastern'], ['snack','vegetarian','protein'], 65),
  B('Shawarma', PR, '', 220, 18, 12, 12, 1, {s:150,m:250,l:350}, ['wrapped','meat','rolled','large'], ['grilled'], ['chicken shawarma','beef shawarma'], ['middle eastern'], ['lunch','dinner','protein'], 70),
  B('Kebab', PR, '', 230, 20, 4, 15, 0.5, {s:80,m:130,l:200}, ['skewer','charred','meat','elongated'], ['grilled'], ['seekh kebab','shish kebab','doner kebab'], ['middle eastern','indian'], ['dinner','protein','grilled'], 65),
  B('Tabouleh', PR, 'Salad', 50, 2, 9, 1, 2, {s:60,m:100,l:160}, ['green','mixed','small pieces','bowl'], ['raw'], ['tabbouleh','tabouli'], ['middle eastern'], ['side','healthy'], 45),
  B('Baba Ganoush', SN, '', 120, 3, 8, 9, 3, {s:30,m:60,l:100}, ['brown','smooth','smoky','bowl'], ['roasted','blended'], ['baba ghanoush'], ['middle eastern'], ['appetizer','healthy'], 50),
  B('Pita Bread', IN, '', 275, 9, 56, 1.2, 2, {s:30,m:50,l:70}, ['round','flat','puffy','bread'], ['baked'], ['pita','pitta'], ['middle eastern'], ['bread','staple'], 55),
  B('Dolma', SN, '', 180, 4, 18, 10, 2, {s:40,m:70,l:120}, ['rolled','stuffed','leaf','small'], ['simmered'], ['dolmades','stuffed grape leaves'], ['middle eastern','greek'], ['appetizer','side'], 45),
  B('Moussaka', PR, '', 160, 8, 10, 10, 2, {s:150,m:250,l:350}, ['layered','baked','brown top'], ['baked'], [], ['greek'], ['dinner','comfort'], 50),
  B('Gyros', PR, '', 240, 16, 20, 11, 1, {s:150,m:250,l:350}, ['wrapped','meat','pita','sauce'], ['grilled'], ['gyro'], ['greek'], ['lunch','dinner'], 55),
  B('Baklava', DS, '', 430, 7, 40, 27, 3, {s:30,m:50,l:80}, ['layered','golden','honey','nuts','flaky'], ['baked'], [], ['middle eastern','greek','turkish'], ['dessert','sweet'], 60),

  // ═══════════════════════════════════════
  // EXPANDED GYM & FITNESS
  // ═══════════════════════════════════════
  B('Chicken Breast Grilled', CK, 'Chicken', 165, 31, 0, 3.6, 0, {s:80,m:120,l:180}, ['white','flat','grill marks','sliced'], ['grilled'], ['grilled chicken','chicken breast'], ['global'], ['protein','gym','healthy','lunch'], 75),
  B('Turkey Breast', CK, '', 135, 30, 0, 1, 0, {s:80,m:120,l:180}, ['white','flat','sliced','lean'], ['grilled','roasted'], ['turkey','roast turkey'], ['american'], ['protein','gym','healthy'], 55),
  B('Egg White Omelet', PR, 'Egg', 55, 11, 0.7, 0.2, 0, {s:80,m:120,l:160}, ['white','flat','folded'], ['pan fried'], ['egg white omelette'], ['global'], ['protein','gym','healthy','low fat'], 55),
  B('Brown Rice Bowl', PR, 'Brown Rice', 130, 3, 27, 1.5, 2, {s:100,m:150,l:250}, ['brown','bowl','grain'], ['steamed'], ['brown rice plate'], ['global'], ['healthy','gym','lunch'], 50),
  B('Grilled Fish', CK, 'Fish', 130, 22, 0, 5, 0, {s:100,m:150,l:220}, ['flat','grill marks','fillet'], ['grilled'], ['grilled fish fillet'], ['global'], ['protein','gym','healthy'], 60),
  B('Cottage Cheese', IN, '', 98, 11, 3.4, 4.3, 0, {s:60,m:100,l:160}, ['white','creamy','crumbly','bowl'], ['raw'], ['paneer','curd cheese'], ['global'], ['protein','gym','snack'], 55),
  B('Protein Bar', SN, '', 350, 20, 35, 12, 3, {s:30,m:50,l:70}, ['rectangular','wrapped','bar'], ['processed'], ['energy bar','granola bar'], ['global'], ['snack','gym','protein'], 55),
  B('Sweet Potato', CK, '', 86, 1.6, 20, 0.1, 3, {s:100,m:150,l:220}, ['orange','round','roasted'], ['baked','boiled','roasted'], ['yam'], ['global'], ['healthy','gym','carb'], 55),
  B('Tuna Salad', PR, 'Tuna', 150, 18, 4, 7, 1, {s:100,m:180,l:280}, ['mixed','flaky','bowl'], ['raw','mixed'], [], ['global'], ['lunch','protein','gym','healthy'], 55),
  B('Tofu Scramble', PR, '', 120, 10, 3, 7, 1, {s:80,m:130,l:180}, ['yellow','crumbled','mixed'], ['sauteed'], ['scrambled tofu'], ['global'], ['breakfast','vegan','protein'], 50),
  B('Edamame Bowl', SN, 'Edamame', 122, 12, 9, 5, 5, {s:80,m:130,l:200}, ['green','pods','bowl'], ['steamed'], ['soybean'], ['japanese'], ['snack','protein','gym','healthy'], 50),
  B('Chia Pudding', DS, '', 130, 4, 12, 7, 10, {s:100,m:150,l:220}, ['black seeds','white','layered','glass'], ['soaked'], ['chia seed pudding'], ['global'], ['breakfast','healthy','gym'], 50),
  B('Protein Pancakes', PR, 'Pancake', 180, 15, 20, 5, 2, {s:60,m:100,l:150}, ['round','stacked','golden'], ['pan fried'], [], ['global'], ['breakfast','gym','protein'], 50),

  // ═══════════════════════════════════════
  // EXPANDED FRUITS & VEGETABLES
  // ═══════════════════════════════════════
  B('Dragon Fruit', IN, '', 60, 1, 13, 0.4, 3, {s:80,m:150,l:250}, ['pink','white','seeds','sliced'], ['raw'], ['pitaya'], ['global'], ['fruit','exotic'], 45),
  B('Lychee', IN, '', 66, 0.8, 17, 0.4, 1.3, {s:50,m:80,l:130}, ['white','small','round','translucent'], ['raw'], ['litchi'], ['global','chinese'], ['fruit'], 45),
  B('Passion Fruit', IN, '', 97, 2.2, 23, 0.7, 10, {s:40,m:60,l:100}, ['purple','round','seeds','wrinkled'], ['raw'], [], ['global'], ['fruit','exotic'], 45),
  B('Jackfruit', IN, '', 95, 1.7, 23, 0.6, 1.5, {s:60,m:100,l:180}, ['yellow','large','segments'], ['raw'], ['kathal'], ['indian','global'], ['fruit'], 50),
  B('Custard Apple', IN, '', 94, 2.1, 24, 0.3, 4.4, {s:80,m:120,l:180}, ['green','round','bumpy','white inside'], ['raw'], ['sitaphal','cherimoya'], ['indian','global'], ['fruit'], 45),
  B('Sapodilla', IN, '', 83, 0.4, 20, 1.1, 5.3, {s:50,m:80,l:120}, ['brown','oval','smooth'], ['raw'], ['chikoo','chiku'], ['indian','global'], ['fruit'], 45),
  B('Fig', IN, '', 74, 0.8, 19, 0.3, 2.9, {s:40,m:60,l:100}, ['purple','teardrop','seeds','halved'], ['raw'], ['anjeer','figs'], ['global'], ['fruit','healthy'], 45),
  B('Dates', IN, '', 277, 1.8, 75, 0.2, 7, {s:15,m:30,l:50}, ['brown','oval','wrinkled','sticky'], ['raw','dried'], ['khajoor','medjool dates'], ['middle eastern','indian'], ['snack','healthy','energy'], 55),
  B('Raisin', IN, '', 299, 3.1, 79, 0.5, 3.7, {s:10,m:20,l:35}, ['small','dark','wrinkled'], ['dried'], ['kishmish','raisins','dried grapes'], ['global'], ['snack','healthy'], 40),
  B('Cranberry', IN, '', 46, 0.5, 12, 0.1, 4.6, {s:20,m:30,l:50}, ['red','small','round'], ['raw','dried'], ['cranberries','dried cranberry'], ['american'], ['fruit','healthy'], 40),
  B('Blueberry', IN, '', 57, 0.7, 14, 0.3, 2.4, {s:40,m:80,l:130}, ['blue','small','round'], ['raw'], ['blueberries'], ['american','global'], ['fruit','healthy','antioxidant'], 50),
  B('Raspberry', IN, '', 52, 1.2, 12, 0.7, 6.5, {s:40,m:80,l:130}, ['red','small','textured'], ['raw'], ['raspberries'], ['global'], ['fruit','healthy'], 45),
  B('Blackberry', IN, '', 43, 1.4, 10, 0.5, 5.3, {s:40,m:80,l:130}, ['dark','small','cluster'], ['raw'], ['blackberries'], ['global'], ['fruit','healthy'], 40),
  B('Plum', IN, '', 46, 0.7, 11, 0.3, 1.4, {s:50,m:80,l:120}, ['purple','round','smooth'], ['raw'], ['plums','aloo bukhara'], ['global'], ['fruit'], 40),
  B('Pear', IN, '', 57, 0.4, 15, 0.1, 3.1, {s:100,m:150,l:200}, ['green','pear shaped','smooth'], ['raw'], ['pears'], ['global'], ['fruit','healthy'], 50),
  B('Peach', IN, '', 39, 0.9, 10, 0.3, 1.5, {s:80,m:130,l:180}, ['orange','fuzzy','round'], ['raw'], ['peaches'], ['global'], ['fruit'], 45),
  B('Apricot', IN, '', 48, 1.4, 11, 0.4, 2, {s:30,m:50,l:80}, ['orange','small','round'], ['raw','dried'], ['apricots','khubani'], ['global'], ['fruit'], 40),
  B('Litchi', IN, '', 66, 0.8, 17, 0.4, 1.3, {s:50,m:80,l:130}, ['white','translucent','round'], ['raw'], ['lychee'], ['chinese','indian'], ['fruit'], 40),
  B('Spinach Salad', PR, 'Salad', 23, 2.9, 3.6, 0.4, 2.2, {s:60,m:120,l:200}, ['green','leaves','mixed'], ['raw'], ['baby spinach salad'], ['global'], ['healthy','gym','side'], 45),
  B('Roasted Vegetables', CK, '', 80, 2, 12, 3, 3, {s:100,m:180,l:280}, ['colorful','mixed','roasted','charred'], ['roasted'], ['roast veggies','grilled vegetables'], ['global'], ['healthy','side','gym'], 50),
  B('Stir Fry Vegetables', CK, '', 60, 2, 8, 2.5, 2.5, {s:100,m:160,l:240}, ['colorful','mixed','glossy'], ['stir fried'], ['vegetable stir fry'], ['chinese','global'], ['healthy','side'], 50),

  // ═══════════════════════════════════════
  // FAST FOOD & RESTAURANT
  // ═══════════════════════════════════════
  B('Pepperoni Pizza', PR, 'Pizza', 280, 12, 30, 12, 2, {s:80,m:120,l:180}, ['flat','round','red','pepperoni','cheese'], ['baked'], [], ['american','italian'], ['lunch','dinner','fast food'], 65),
  B('BBQ Chicken Pizza', PR, 'Pizza', 260, 13, 30, 9, 2, {s:80,m:120,l:180}, ['flat','round','BBQ','chicken'], ['baked'], [], ['american'], ['lunch','dinner','fast food'], 55),
  B('Veggie Pizza', PR, 'Pizza', 240, 10, 30, 8, 3, {s:80,m:120,l:180}, ['flat','round','vegetables','colorful'], ['baked'], ['vegetable pizza'], ['italian'], ['lunch','dinner'], 55),
  B('Double Cheeseburger', PR, 'Burger', 350, 22, 28, 18, 1, {s:180,m:240,l:320}, ['stacked','layered','thick','cheese'], ['grilled'], ['double burger'], ['american'], ['lunch','dinner','fast food'], 55),
  B('Veggie Burger', PR, 'Burger', 220, 12, 28, 8, 4, {s:140,m:190,l:260}, ['round','layered','bread','patty'], ['grilled'], ['plant burger','garden burger'], ['american'], ['lunch','dinner','vegetarian'], 55),
  B('Chicken Burger', PR, 'Burger', 280, 18, 26, 12, 1, {s:150,m:200,l:280}, ['round','layered','chicken','bread'], ['grilled','fried'], ['chicken sandwich'], ['american'], ['lunch','dinner','fast food'], 60),
  B('Fish Burger', PR, 'Burger', 270, 14, 28, 12, 1, {s:150,m:200,l:270}, ['round','layered','fish','bread'], ['fried'], ['fish sandwich','filet o fish'], ['american'], ['lunch','dinner','fast food'], 50),
  B('Subway Sandwich', PR, 'Sandwich', 230, 14, 30, 6, 3, {s:150,m:230,l:330}, ['elongated','layered','bread','vegetables'], ['assembled'], ['sub','hero','hoagie'], ['american'], ['lunch','fast food'], 50),
  B('Shawarma Plate', PR, 'Shawarma', 280, 20, 25, 12, 2, {s:200,m:300,l:400}, ['plate','rice','meat','salad'], ['grilled'], ['shawarma rice'], ['middle eastern'], ['lunch','dinner'], 55),
  B('Butter Chicken Rice', PR, '', 220, 12, 24, 8, 1, {s:200,m:300,l:400}, ['orange','rice','chicken','plate'], ['simmered'], [], ['indian'], ['lunch','dinner','restaurant'], 55),
  B('Chicken Fried Rice', PR, 'Fried Rice', 170, 8, 24, 5, 1, {s:150,m:250,l:350}, ['mixed','rice','chicken','colorful'], ['stir fried'], [], ['chinese','indian'], ['lunch','dinner'], 60),
  B('Schezwan Fried Rice', PR, 'Fried Rice', 175, 5, 25, 6, 1, {s:150,m:250,l:350}, ['red','spicy','rice','mixed'], ['stir fried'], ['szechuan rice'], ['chinese','indian'], ['lunch','dinner','spicy'], 55),
];

async function seed() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/getfit';
  console.log('[Seed Expand] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Seed Expand] Connected.');
  console.log(`[Seed Expand] Inserting ${FOODS.length} additional foods...`);

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
  console.log(`[Seed Expand] ✓ Inserted ${inserted}, Skipped ${skipped} duplicates`);
  console.log(`[Seed Expand] Total foods in ontology: ${total}`);
  await mongoose.disconnect();
}

seed().catch(e => { console.error('[Seed Expand] Error:', e); process.exit(1); });
