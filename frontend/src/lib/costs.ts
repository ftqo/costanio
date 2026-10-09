// Resource cost of each buildable, keyed by resource index
// (1=wood, 2=brick, 3=sheep, 4=wheat, 5=ore). Shared by the build shelf and the
// location action menu.
export const COST: Record<string, Record<number, number>> = {
  road: { 1: 1, 2: 1 },
  settlement: { 1: 1, 2: 1, 3: 1, 4: 1 },
  city: { 4: 2, 5: 3 },
  dev: { 3: 1, 4: 1, 5: 1 },
  ship: { 1: 1, 3: 1 }, // wood + sheep (Islands)
  knight: { 3: 1, 5: 1 }, // sheep + ore (Knights)
  wall: { 2: 2 }, // 2 brick (Knights)
  // The Medicine card's discounted upgrade: 2 ore + 1 wheat instead of 3 + 2
  // (engine/knights costMedicineCity), so the client can explain an unaffordable
  // Medicine.
  medicineCity: { 4: 1, 5: 2 },
};
