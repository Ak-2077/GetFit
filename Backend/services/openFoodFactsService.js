/**
 * Open Food Facts Service — Fallback nutrition lookup
 *
 * Used when USDA returns no results.
 * Free API, no key required, rate-limited.
 */

const OFF_BASE_URL = 'https://world.openfoodfacts.org';

/**
 * Search Open Food Facts for a food item.
 *
 * @param {string} query - Food name to search
 * @param {number} limit - Max results
 * @returns {Array} Nutrition results normalized to per-100g
 */
export async function searchOpenFoodFacts(query, limit = 5) {
  try {
    if (!query || query.length < 2) return [];

    const url = `${OFF_BASE_URL}/cgi/search.pl?` + new URLSearchParams({
      search_terms: query,
      search_simple: '1',
      action: 'process',
      json: '1',
      page_size: String(limit),
      fields: 'product_name,nutriments,serving_size,brands,categories_tags',
    });

    const response = await fetch(url, {
      headers: { 'User-Agent': 'GetFit-App/1.0 (contact@getfit.app)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (!data.products || data.products.length === 0) return [];

    return data.products
      .filter(p => p.nutriments && p.product_name)
      .map(p => {
        const n = p.nutriments;
        return {
          productName: p.product_name,
          brand: p.brands || '',
          calories: Math.round(n['energy-kcal_100g'] || n['energy_100g'] / 4.184 || 0),
          protein: Number((n.proteins_100g || 0).toFixed(1)),
          carbs: Number((n.carbohydrates_100g || 0).toFixed(1)),
          fat: Number((n.fat_100g || 0).toFixed(1)),
          fiber: Number((n.fiber_100g || 0).toFixed(1)),
          sugar: Number((n.sugars_100g || 0).toFixed(1)),
          servingSize: p.serving_size || '100g',
          source: 'openfoodfacts',
        };
      })
      .filter(r => r.calories > 0); // only return entries with actual data
  } catch (err) {
    console.warn(`[OpenFoodFacts] Error searching "${query}":`, err.message);
    return [];
  }
}
