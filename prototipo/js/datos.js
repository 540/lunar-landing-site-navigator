// Catálogo del prototipo. Coordenadas APROXIMADAS: hay que sustituirlas por las de Quickmap.

export const SITIOS = [
  { id: 'cresta', nombre: 'Cresta de conexión de Shackleton', corto: 'Cresta Shackleton', lat: -89.45, lon: -137.3,
    nota: 'Región candidata de Artemis III. Una cresta alta: ve lejos en casi todas direcciones.' },
  { id: 'ladera', nombre: 'Ladera de la cresta (≈4 km al lado)', corto: 'Ladera cresta', lat: -89.463, lon: -151.2,
    nota: 'Ilustrativo: el mismo entorno, pero más abajo. Sirve para ver qué pasa si el lander cae desviado.' },
  { id: 'malapert', nombre: 'Macizo de Malapert', corto: 'Malapert', lat: -86.0, lon: 0.0,
    nota: 'Región candidata de Artemis III. Montaña en la cara que mira a la Tierra.' },
  { id: 'gerlache', nombre: 'Borde de de Gerlache', corto: 'de Gerlache', lat: -87.97, lon: -87.1,
    nota: 'Región candidata de Artemis III. Borde de un cráter.' },
  { id: 'mouton', nombre: 'Mons Mouton (zona de IM-2)', corto: 'Mons Mouton', lat: -84.6, lon: 31.0,
    nota: 'Región candidata de Artemis III. Cerca de donde aterrizó Athena (IM-2) en marzo de 2025.' },
  { id: 'apolo15', nombre: 'Apolo 15 (referencia ecuatorial)', corto: 'Apolo 15', lat: 26.13, lon: 3.63, fueraMapa: true,
    nota: 'Lejos del polo: el Sol sube alto y la Tierra siempre se ve. Sirve de comparación.' },
];

// Perfiles de misión de EJEMPLO. Los umbrales reales los tiene que dar cada misión.
export const PERFILES = [
  { id: 'robotico', nombre: 'Lander robótico pequeño', dias: 10, aguante: 12, minTierra: 60,
    fuente: 'Ejemplo: dura un día lunar de luz (~10 días) y su batería aguanta unas 12 h a oscuras. Athena (IM-2) murió en ~12 h sin Sol' },
  { id: 'artemis', nombre: 'Misión tripulada tipo Artemis III', dias: 6.5, aguante: 4, minTierra: 80,
    fuente: 'NASA pide 6–7 días de Sol para Artemis III. Aguante de 4 h y 80 % de Tierra: ejemplo' },
  { id: 'rover', nombre: 'Rover de larga duración', dias: 14, aguante: 48, minTierra: 40,
    fuente: 'Ejemplo: más batería (2 días a oscuras) porque puede esperar a que vuelva el Sol' },
];

export const FECHA_INICIAL = '2027-04-03T12:00';

// Fuentes de datos reales que sustituirán a las simuladas.
export const FUENTES = [
  { grupo: 'Posición del Sol y de la Tierra', items: [
    { nombre: 'JPL Horizons (web)', url: 'https://ssd.jpl.nasa.gov/horizons/', para: 'Pruebas a mano: observador en la Luna (código 301) con las coordenadas del sitio; pedir azimut y elevación.', quien: 'Motor de datos', estado: 'simulado' },
    { nombre: 'JPL Horizons (API)', url: 'https://ssd.jpl.nasa.gov/api/horizons.api', para: 'Sacar series largas (cada hora, durante meses) desde código. En Python: astroquery.', quien: 'Motor de datos', estado: 'simulado' },
    { nombre: 'SPICE (NAIF)', url: 'https://naif.jpl.nasa.gov/', para: 'Lo mismo que Horizons pero calculado en local (spiceypy). Más rápido para muchos sitios y fechas.', quien: 'Motor de datos', estado: 'simulado' },
  ]},
  { grupo: 'Relieve (lo que tapa)', items: [
    { nombre: 'LOLA de alta resolución del polo sur (PGDA)', url: 'https://pgda.gsfc.nasa.gov/products/78', para: 'Mapas de alturas de las zonas candidatas. Con ellos se calcula el horizonte de cada sitio.', quien: 'Motor de datos', estado: 'simulado' },
    { nombre: 'Archivo LOLA (PDS Geosciences)', url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm', para: 'Los mapas de alturas oficiales de toda la Luna, con versiones polares.', quien: 'Motor de datos', estado: 'simulado' },
  ]},
  { grupo: 'Mapas para comprobar que acertamos', items: [
    { nombre: 'Iluminación y visibilidad de la Tierra en los polos (PGDA)', url: 'https://pgda.gsfc.nasa.gov/products/69', para: 'Qué % del tiempo hay Sol y se ve la Tierra en cada punto. Si nuestro cálculo dice otra cosa, algo falla.', quien: 'Motor de datos', estado: 'pendiente' },
    { nombre: 'Mapa de iluminación de LROC', url: 'https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_ILL_PCT_SOUTH', para: 'Lo mismo, a partir de fotos reales del satélite.', quien: 'Motor de datos', estado: 'pendiente' },
  ]},
  { grupo: 'Sitios de aterrizaje', items: [
    { nombre: 'Regiones candidatas de Artemis III (NASA)', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/', para: 'Los nombres de los sitios oficiales del polo sur.', quien: 'Planificador', estado: 'usado' },
    { nombre: 'Quickmap', url: 'https://quickmap.lroc.asu.edu/', para: 'Buscar cada sitio y copiar sus coordenadas reales (las del prototipo son aproximadas).', quien: 'Planificador', estado: 'pendiente' },
    { nombre: 'Moon Trek', url: 'https://trek.nasa.gov/moon/', para: 'Ver el terreno en 3D para entender los sitios.', quien: 'Todos', estado: 'referencia' },
  ]},
  { grupo: 'Para entenderlo y contarlo', items: [
    { nombre: 'NASA SVS: iluminación del polo sur y la Tierra vista desde el polo', url: 'https://svs.gsfc.nasa.gov/', para: 'Animaciones de cómo se mueven la luz y la Tierra. Buscar «south pole illumination».', quien: 'Todos', estado: 'referencia' },
    { nombre: 'NASA, «Lunar Site Selection» (2023)', url: 'https://ntrs.nasa.gov/api/citations/20230016267/downloads/Lunar%20Site%20Selection.pdf', para: 'Cómo decide NASA dónde aterrizar. Frases con fuente para el pitch.', quien: 'Planificador', estado: 'usado' },
    { nombre: 'Caso Athena (IM-2)', url: 'https://spaceflightnow.com/2025/03/07/intuitive-machines-im-2-mission-ends-with-lander-on-its-side-on-the-moon/', para: 'Aterrizó desviada, con el Sol bajo, y murió en unas 12 horas.', quien: 'Planificador', estado: 'usado' },
    { nombre: 'El reto en Space Apps', url: 'https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/', para: 'Lo que pide el jurado. Copia en fuentes/ del repo de discovery.', quien: 'Todos', estado: 'usado' },
  ]},
];
