export type Species = 'bulbasaur' | 'ivysaur' | 'venusaur' | 'charmander' | 'squirtle' | 'pikachu' | 'mewtwo';
export interface Vec { x: number; y: number }
export interface Command { move: Vec; aim?: Vec; melee: boolean; ranged: boolean; rangedHeld?: boolean; dodge: boolean; special?: boolean }
export type FighterAction = 'none' | 'melee' | 'ranged' | 'special' | 'dodge';
export type ActionPhase = 'idle' | 'windup' | 'active' | 'recovery';
export interface Fighter { id: number; species: Species; pos: Vec; facing: Vec; hp: number; maxHp: number; radius: number; meleeCooldown: number; rangedCooldown: number; dodgeCooldown: number; dodgeTime: number; stunTime: number; attackTime: number; hitTime: number; velocity: Vec;
  action: FighterAction; phase: ActionPhase; phaseTime: number; phaseDuration: number; actionTime: number;
  energy: number; maxEnergy: number; specialCooldown: number; paralysisTime: number; knockdownTime: number; moveVelocity: Vec;
  chargeTime: number; chargeRelease: number | null; rangedNeedsRelease: boolean; chargeSuspended: boolean;
}
export interface Projectile { id: number; owner: number; species: Species; pos: Vec; velocity: Vec; radius: number; life: number; damage: number; kind?: 'leaf' | 'seed' | 'returnLeaf'; combo?: number; tier?: 'basic' | 'charged' | 'perfect'; returning?: boolean; travelled?: number; hitLeg?: boolean; returnDamage?: number }
export interface LeechSeed { owner: number; target: number; life: number; timer: number; ticksLeft: number }
export interface Effect { id: number; kind: 'hit' | 'melee' | 'dodge' | 'scorch' | 'splash' | 'dust' | 'steam' | 'burst' | 'debris' | 'shockwave' | 'charge' | 'trail' | 'combo' | 'solar'; pos: Vec; life: number; maxLife: number; angle: number; species: Species; size?: number; points?: Vec[]; end?: Vec }
export interface Beam { owner: number; species: Species; start: Vec; end: Vec; width: number; power: number; blocked: boolean }
export interface Clash { pos: Vec; intensity: number; age: number }
export interface Obstacle { id: number; kind: 'crate' | 'rock'; pos: Vec; radius: number; hp: number; maxHp: number }
export interface Hazard { id: number; owner: number; species: Species; pos: Vec; radius: number; life: number; maxLife: number; warmup: number; damageTimer: number }
export interface GroundMark { id: number; kind: 'scorch' | 'crater' | 'wet'; pos: Vec; radius: number; life: number; angle: number }
export interface PlantAttack { id: number; owner: number; kind: 'bomb' | 'roots'; origin: Vec; points: Vec[]; age: number; power: number; hit: boolean; resolved: number }
export interface BattleState { fighters: [Fighter, Fighter]; projectiles: Projectile[]; effects: Effect[]; time: number; winner: number | null; nextId: number; seed: number;
  beams: Beam[]; clash: Clash | null; obstacles: Obstacle[]; hazards: Hazard[]; groundMarks: GroundMark[]; cameraImpact: number; leechSeeds: LeechSeed[]; plantAttacks: PlantAttack[];
}
export const WORLD = { width: 960, height: 600, left: 84, right: 876, top: 88, bottom: 530 };
export const emptyCommand = (): Command => ({ move: { x: 0, y: 0 }, melee: false, ranged: false, dodge: false });
