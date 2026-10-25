export const PACKS = {
  Home: ["🍽|Wash dishes", "🗑|Take out trash", "🧺|Laundry", "🛒|Grocery run", "🚿|Clean bathroom", "🧹|Sweep & mop", "🛏|Make beds", "🍳|Cook dinner"],
  "Couple / Roommates": ["🍽|Dishes", "🗑|Trash", "🧺|Laundry", "🛒|Groceries", "🚿|Bathroom", "💡|Pay the bills", "🧊|Clean fridge"],
  "Hostel room": ["🧹|Sweep room", "🚰|Fill water bottles", "🗑|Empty dustbin", "👕|Laundry drop-off", "🍜|Night snack run", "📶|Recharge Wi-Fi"],
  "Diwali cleaning": ["🪟|Clean windows", "🕸|Dust ceiling fans", "📦|Clear the loft", "🪔|Set up diyas", "🧽|Scrub kitchen", "🛍|Shopping run"],
  "Group project": ["📊|Make slides", "📝|Write report", "🎤|Present", "🔎|Research", "📚|References", "📅|Book the meeting room"],
  "Trip planning": ["🎟|Book tickets", "🏨|Book stay", "🧳|Pack snacks", "🗺|Make itinerary", "💸|Track expenses", "📸|Be the photographer"],
};

export const PACK_NAMES = Object.keys(PACKS);
export function packChores(pack, makeId = () => crypto.randomUUID()) {
  return (PACKS[pack] || []).map((line) => {
    const [emoji, name] = line.split("|");
    return { id: makeId(), emoji, name };
  });
}
