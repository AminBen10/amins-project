// The active client's data. `@client` points at a file in src/clients/, chosen
// with the CLIENT environment variable (see vite.config.js). Every client file
// exports the names in the design contract: BRAND, COPY, THEME, OPENING,
// HOURS_TABLE, SERVICES, CLAIMS, GUARDS, CARTA, STORY, CUTS, BEARDS, INGREDIENTS,
// BARBERS, RATINGS, RATINGS_AS_OF, REVIEWS, BOOKING, PITCH, EXAMPLE_NOTICE, plus
// STORY_CUT and SERVICE_MAP. Node scripts and tests import a client file directly.
export * from '@client';

// Catalogue data that does not depend on the shop.
export { FAMILIES, TOOL_NAMES, GUARD_IDS } from './cuts/catalog.js';
