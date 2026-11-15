// Perfiles de misión: los requisitos con los que se evalúa un aterrizaje.
//
// Los umbrales son supuestos de trabajo, sin validar con fuentes de CLPS: están para poder comparar escenarios,
// no como requisitos reales de ninguna misión.
//
// sunMode y earthMode son los `mode` de la API de datos: cuándo cuenta un disco como visible.
// Para la Tierra se usa `full` (disco entero sobre el horizonte, es decir, el centro a ~0,95° o más): es lo más
// parecido a un margen de elevación para la antena que ofrece hoy la API.
const base = {
  sunMode: 'full',
  earthMode: 'full',
  marginalMargin: 0.1, // una regla cumplida con menos de este margen relativo da veredicto «marginal»
  toleranceDays: 0,    // si es > 0, manda el peor aterrizaje posible dentro de ±toleranceDays
  transitDays: 5,      // viaje de la Tierra a la Luna: solo para traducir la fecha de aterrizaje a la de lanzamiento
};

export const PROFILES = {
  'clps-lunar-day': {
    ...base,
    name: 'Lander CLPS de un día lunar',
    durationDays: 12,
    rules: {
      R1: { active: true },
      R2: { active: true },
      R3: { active: true, threshold: 48 },
      R4: { active: true, threshold: 36 },
      R5: { active: true, threshold: 0.6 },
      R6: { active: true, threshold: 96 },
      R7: { active: true, threshold: 0.25 },
    },
  },
  short: {
    ...base,
    name: 'Misión corta (3 días)',
    durationDays: 3,
    rules: {
      R1: { active: true },
      R2: { active: true },
      R3: { active: true, threshold: 24 },
      R4: { active: true, threshold: 12 },
      R5: { active: true, threshold: 0.7 },
      R6: { active: true, threshold: 24 },
      R7: { active: true, threshold: 0.3 },
    },
  },
  'long-with-relay': {
    ...base,
    name: 'Larga duración con satélite repetidor',
    durationDays: 28,
    transitDays: 30,
    rules: {
      R1: { active: true },
      R2: { active: false },
      R3: { active: true, threshold: 72 },
      R4: { active: true, threshold: 100 },
      R5: { active: true, threshold: 0.5 },
      R6: { active: false, threshold: 120 },
      R7: { active: false, threshold: 0.2 },
    },
  },
};
