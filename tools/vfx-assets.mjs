// Pinned PMDO original artwork; never fetched by the browser.
export const revision = '03c80dad937911572f8fb19903771a47956fc696';
export const origin = `https://raw.githubusercontent.com/PMDCollab/RawAsset/${revision}`;
export const particles = {
  roots: 'Frenzy_Plant.None', petalBack: 'Petal_Dance_Back.None', petalFront: 'Petal_Dance_Front.None', petal: 'Petal_Dance_Flower_Pink.None',
  fireBack: 'Magma_Storm_Back.None', fireFront: 'Magma_Storm_Front.None',
  ember: 'Ember.None', flame: 'Flamethrower.None', fireBall: 'Fire_Spin_Fireball.None',
  waterWave: 'Aqua_Tail_Wave.None', waterSplash: 'Water_Spout_Splash.None', waterDrop: 'Water_Spout_Drop.None',
  waterHit: 'Brine_Splashes.None', bubble: 'Bubble_Pop_Blue.None', waterFlow: 'Hydro_Pump_RSE.Dir1',
  leaf: 'Razor_Leaf.None', leafSpin: 'Leaf_Storm_Leaf_Rotating.None', leafCharge: 'Razor_Leaf_Charge.None',
  seed: 'Seed_RSE.None', sprout: 'Leech_Seed_Sprout.None', vine: 'Vine_Whip.Dir1', vineHit: 'Vine_Whip_2.None',
  solarCharge: 'Solar_Beam_Charge.None', solarMote: 'Solar_Beam_Particle.None', absorb: 'Absorb.None',
  scratch: 'Scratch.Dir1', hit: 'Hit_Neutral.None', heavyHit: 'Hit_Super_Effective.None',
  electric: 'Discharge.None', electricHit: 'Discharge_Hit.None', spark: 'Spark.None',
  charge: 'Charge_Up.None', psychicCharge: 'Psych_Up.None', psychicHit: 'Psycho_Shift_Hit.None',
  psychicBack: 'Psycho_Boost_Back.None', psychicFront: 'Psycho_Boost_Front.None',
  psychicWave: 'Wave_Circle_Purple.Dir5', rock: 'Rock_Piece_Rotating.None',
  dust: 'Puff_Brown.None', steam: 'Puff_White.None', dash: 'Vacuum_Wave_Dust.None',
  impact: 'Force_Palm_Hit.None', grassHit: 'Leaf_Storm_Hit.None',
};
export const beams = { water: 'Column_Blue', solar: 'Beam', lightning: 'Lightning', psychic: 'Column_Purple' };
export const sourceFiles = [
  ...Object.entries(particles).map(([key, name]) => ({ key, path: `Particle/${name}.png`, file: `${key}.png` })),
  ...Object.entries(beams).flatMap(([key, name]) => ['Body.png', 'Head.png', 'Tail.png', 'BeamData.xml'].map(part => ({ key: `${key}${part.split('.')[0]}`, path: `Beam/${name}/${part}`, file: `${key}-${part}` }))),
];
