// Example queries (Spanish comments): the tabs of the explorer (GET /graphql in a browser), the persisted queries the
// server knows from the start and the examples of data/README.md. The tests run every one of them.

export interface Example { name: string; query: string; variables?: Record<string, unknown> }

export const EXAMPLES: readonly Example[] = [
  {
    name: 'Ficha de un sitio',
    query: `# Ficha de un sitio: lo que se ve ahora, la pendiente y las mejores fechas de alunizaje.
# Cambia $id por otro sitio del catálogo (consulta «sites { id name }») o usa site(lat: …, lon: …).
query FichaSitio($id: ID! = "shackleton-rim", $en: DateTime = "2027-01-15T00:00:00Z") {
  site(id: $id) {
    name
    latDeg
    lonDeg
    slope { slopeDeg slopeBaselineM meetsMaxSlope }
    sunEarth(at: $en) {
      sun { elevationDeg visible visibleFraction hoursToNextSet hoursToNextRise }
      earth { elevationDeg visible }
      sunAndEarthVisible
      warnings { code message }
    }
    landingDates(from: "2027-01-01", to: "2027-06-30", top: 3) {
      best { rank date score metrics { meanSunDiskFraction earthTimeFraction longestNightHours } }
    }
  }
}`,
    variables: { id: 'shackleton-rim', en: '2027-01-15T00:00:00Z' },
  },
  {
    name: 'Comparar sitios y fechas',
    query: `# Comparar varios sitios en varias fechas de alunizaje con una sola consulta:
# el mismo barrido para cada sitio, una matriz fecha × sitio y un ranking por la mejor fecha.
query Comparar {
  compare(
    sites: ["shackleton-rim", "im1", "chandrayaan3"]
    landingDates: { from: "2027-01-01", to: "2027-02-28", dateStepHours: 48, missionDays: 14 }
  ) {
    siteCount
    dateCount
    ranking { rank siteId name bestDate bestScore meanScore goodFraction }
    matrix { date bestSiteId cells { siteId score sunVisibleAtLanding } }
  }
}`,
  },
  {
    name: 'Barrido de fechas (solo resumen)',
    query: `# Barrido de un año de fechas de alunizaje con relieve, solo con el resumen:
# sin «dates», la respuesta no lleva la serie completa (365 fechas).
query BarridoResumen {
  site(id: "im1") {
    landingDates(from: "2027-01-01", to: "2027-12-31", missionDays: 14, terrain: { enabled: true }) {
      stats { dateCount score { min mean max } goodFraction }
      goodWindows { start end durationDays bestDate bestScore }
      terrain { applied source note }
      note
    }
  }
}`,
  },
  {
    name: 'Ficha corta de varios sitios (web)',
    query: `# Lo que necesita una ficha corta (planificador web/): pocos campos de varios sitios en una petición.
query FichaCorta {
  sites(ids: ["shackleton-rim", "im1", "apollo11", "chandrayaan3", "im2-alunizaje"]) {
    id
    name
    slope { slopeDeg }
    sunEarth(at: "2027-01-15T00:00:00Z") {
      sun { elevationDeg visible }
      earth { elevationDeg visible }
    }
    landingDates(from: "2027-01-01", to: "2027-12-31", top: 3) {
      best { date score }
    }
  }
}`,
  },
  {
    name: 'Análisis completo (dashboard)',
    query: `# Análisis completo (dashboard): ranking con relieve, restricciones y batería, y para el sitio elegido
# la trayectoria, las ventanas con la noche real y el barrido de fechas con su serie.
query Analisis {
  rank(
    sites: ["shackleton-rim", "im2-alunizaje", "im1", "chandrayaan3"]
    from: "2027-01-24T00:00:00Z"
    days: 14
    terrain: { enabled: true, panelHeightM: 10, antennaHeightM: 2 }
    night: { fullNight: true }
    battery: { enabled: true }
    constraints: { minEarthTimeFraction: 0.5, maxBatteryKg: 500 }
    slope: { baselineM: 100, maxSlopeDeg: 15 }
  ) {
    results { rank siteId score meetsConstraints violatedConstraints metrics { meanSunDiskFraction earthTimeFraction longestNightFullHours batteryKg nightTruncated } }
    slope { excluded { siteId reason slopeDeg } }
    terrain { applied note }
    warnings { code message }
  }
  site(id: "shackleton-rim") {
    horizon(heightM: 10) { azimuthStepDeg elevationDeg }
    track(from: "2027-01-24T00:00:00Z", to: "2027-01-26T00:00:00Z", stepMinutes: 60, terrain: { enabled: true }) {
      times
      sun { elevationDeg horizonElevationDeg visibleFraction }
    }
    windows(from: "2027-01-24T00:00:00Z", to: "2027-02-07T00:00:00Z", terrain: { enabled: true }, night: { fullNight: true }, battery: {}) {
      sun { summary { fractionOfTime longestWindowHours } windows { start end durationHours } }
      night { longestNightHours longestNightFullHours nightTruncated }
      battery { batteryKg note }
    }
    landingDates(from: "2027-01-01", to: "2027-03-31", terrain: { enabled: true }, constraints: { maxLongestNightHours: 120 }) {
      stats { score { min mean max } meetsConstraintsFraction }
      dates { date score meetsConstraints violatedConstraints }
    }
  }
}`,
  },
  {
    name: 'Mejores aterrizajes de una ventana',
    query: `# El mejor aterrizaje de cada sitio en una ventana, con los requisitos de la misión y una prioridad
# (las mismas reglas que el planificador web/): veredicto, motivos, puntuación y margen ante retrasos.
query MejoresAterrizajes {
  bestLandings(
    sites: ["shackleton-rim", "im1", "-89.5:0"]
    from: "2027-10-01T00:00:00Z"
    to: "2027-10-15T00:00:00Z"
    missionDays: 7
    batteryHours: 24
    minEarthPct: 50
    priority: delays
  ) {
    mission { days batteryHours minEarthPct }
    options {
      rank siteId name landing verdict reason score
      reasons
      robustness { maxDelayDays nextWindow }
      trace { rule ok value }
    }
    warnings { code message }
  }
}`,
  },
];
