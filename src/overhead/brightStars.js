/**
 * The brightest stars (plus Polaris), J2000 RA/Dec in degrees and visual
 * magnitude, from the Yale Bright Star Catalogue (public domain). Enough to
 * answer "is that steady light just a bright star?".
 */
export const BRIGHT_STARS = Object.freeze(
  [
    ['Sirius', 101.287, -16.716, -1.46],
    ['Canopus', 95.988, -52.696, -0.74],
    ['Arcturus', 213.915, 19.182, -0.05],
    ['Vega', 279.235, 38.784, 0.03],
    ['Capella', 79.172, 45.998, 0.08],
    ['Rigel', 78.634, -8.202, 0.13],
    ['Procyon', 114.825, 5.225, 0.34],
    ['Betelgeuse', 88.793, 7.407, 0.42],
    ['Achernar', 24.429, -57.237, 0.46],
    ['Hadar', 210.956, -60.373, 0.61],
    ['Altair', 297.696, 8.868, 0.76],
    ['Acrux', 186.65, -63.099, 0.77],
    ['Aldebaran', 68.98, 16.509, 0.86],
    ['Antares', 247.352, -26.432, 0.96],
    ['Spica', 201.298, -11.161, 0.97],
    ['Pollux', 116.329, 28.026, 1.14],
    ['Fomalhaut', 344.413, -29.622, 1.16],
    ['Deneb', 310.358, 45.28, 1.25],
    ['Mimosa', 191.93, -59.689, 1.25],
    ['Regulus', 152.093, 11.967, 1.35],
    ['Adhara', 104.656, -28.972, 1.5],
    ['Castor', 113.65, 31.888, 1.58],
    ['Shaula', 263.402, -37.104, 1.62],
    ['Bellatrix', 81.283, 6.35, 1.64],
    ['Elnath', 81.573, 28.608, 1.65],
    ['Alnilam', 84.053, -1.202, 1.69],
    ['Alnitak', 85.19, -1.943, 1.74],
    ['Alioth', 193.507, 55.96, 1.77],
    ['Dubhe', 165.932, 61.751, 1.79],
    ['Mirfak', 51.081, 49.861, 1.79],
    ['Polaris', 37.955, 89.264, 1.98],
  ].map(([name, ra, dec, mag]) => Object.freeze({ name, ra, dec, mag })),
);
