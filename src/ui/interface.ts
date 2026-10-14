import { BULBASAUR as B, IVYSAUR as I, grassHelp, isGrass, leafTier } from '../game/grassMoves';
import type { BattleState, Species } from '../game/types';

type Callbacks = { onSelect: (species: Species, opponent?: Species) => void; onRestart: () => void; onPause: () => void; onDemo?: () => void };
const names: Record<Species, string> = { bulbasaur: '이상해씨', ivysaur: '이상해풀', charmander: '파이리', squirtle: '꼬부기', pikachu: '피카츄', mewtwo: '뮤츠' };
const moves: Record<Species, { melee: string; ranged: string; special: string }> = {
  ivysaur: { melee: '덩굴채찍', ranged: '잎날가르기', special: '솔라빔' },
  bulbasaur: { melee: '덩굴채찍', ranged: '잎날가르기', special: '씨뿌리기' },
  charmander: { melee: '할퀴기', ranged: '화염방사', special: '불꽃 회오리' },
  squirtle: { melee: '몸통박치기', ranged: '물대포', special: '물 소용돌이' },
  pikachu: { melee: '전광석화', ranged: '10만볼트', special: '번개' },
  mewtwo: { melee: '염동력', ranged: '사이코키네시스', special: '사이코브레이크' },
};

export function createUI(root: HTMLElement, callbacks: Callbacks): { update(state: BattleState, paused: boolean): void; destroy(): void } {
  const abort = new AbortController();
  let started = false;
  let lastState: BattleState | null = null;
  let lastPaused = false;
  let demo = false;
  root.innerHTML = `
    <main class="arena-shell" data-game-shell data-started="false" data-paused="true">
      <header class="page-header">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span><div><h1>PIXEL <span>ARENA</span></h1><p>실시간 배틀 · 트레이닝 아레나</p></div></div>
        <div class="build-tag"><i></i> BATTLE PROTOTYPE <span>03</span></div>
      </header>
      <section class="arena-frame" aria-label="포켓몬 경기장">
        <div class="match-bar"><div><span class="live-dot"></span><strong>1 VS 1</strong><span class="match-type" data-match-type>TRAINING ARENA</span></div><div class="match-tools"><button type="button" class="quiet-button demo-button" data-demo ${callbacks.onDemo ? '' : 'hidden'}>영상 동작 보기</button><button type="button" class="quiet-button" data-help>기술 설명</button><time data-timer>00:00</time><button type="button" class="quiet-button" data-pause disabled aria-label="일시정지">일시정지 <kbd>Esc</kbd></button></div></div>
        <div class="game-stage">
          <div id="game-mount" tabindex="-1" aria-label="이상해씨, 이상해풀, 파이리, 꼬부기, 피카츄, 뮤츠의 실시간 전투"></div>
          <div class="demo-banner"><span data-demo-label>영상 속 동작을 전투 규칙으로 시연합니다</span><button type="button" data-demo-exit>직접 플레이</button></div>
          <div class="game-overlay select-overlay" data-select-overlay>
            <div class="selection-panel">
              <p class="eyebrow">CHOOSE YOUR FIGHTER</p><h2>함께 싸울 포켓몬</h2><p class="panel-copy">풀, 불꽃, 물, 전기, 초능력의 실시간 대결.</p>
              <div class="fighter-options">
                <button type="button" class="fighter-card grass" data-species="bulbasaur"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/bulbasaur.png" alt="" hidden></span><span class="fighter-number">#001 · GRASS / POISON</span><strong>이상해씨</strong><span class="fighter-description">덩굴채찍 · 씨뿌리기</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
                <button type="button" class="fighter-card grass ivy" data-species="ivysaur"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/ivysaur.png" alt="" hidden></span><span class="fighter-number">#002 · GRASS / POISON</span><strong>이상해풀</strong><span class="fighter-description">왕복 잎 · 솔라빔</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
                <button type="button" class="fighter-card fire" data-species="charmander"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/charmander.png" alt="" hidden></span><span class="fighter-number">#004 · FIRE</span><strong>파이리</strong><span class="fighter-description">화염방사 · 불꽃 회오리</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
                <button type="button" class="fighter-card water" data-species="squirtle"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/squirtle.png" alt="" hidden></span><span class="fighter-number">#007 · WATER</span><strong>꼬부기</strong><span class="fighter-description">물대포 · 물 소용돌이</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
                <button type="button" class="fighter-card electric" data-species="pikachu"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/pikachu.png" alt="" hidden></span><span class="fighter-number">#025 · ELECTRIC</span><strong>피카츄</strong><span class="fighter-description">10만볼트 · 번개</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
                <button type="button" class="fighter-card psychic" data-species="mewtwo"><span class="fighter-portrait"><span class="fighter-fallback" aria-hidden="true">◇</span><img class="fighter-thumbnail" src="${import.meta.env.BASE_URL}assets/mewtwo.png" alt="" hidden></span><span class="fighter-number">#150 · PSYCHIC</span><strong>뮤츠</strong><span class="fighter-description">염동력 · 사이코브레이크</span><span class="choose-label">선택하고 시작 <span>↗</span></span></button>
              </div>
              <label class="opponent-choice">상대 포켓몬 <select data-opponent aria-label="상대 포켓몬"><option value="">자동</option><option value="bulbasaur">이상해씨</option><option value="ivysaur">이상해풀</option><option value="charmander">파이리</option><option value="squirtle">꼬부기</option><option value="pikachu">피카츄</option><option value="mewtwo">뮤츠</option></select></label>
              <p class="selection-hint">K 원거리 기술 · L 특수 기술</p>
            </div>
          </div>
          <div class="game-overlay result-overlay" data-status-overlay hidden><div class="status-panel"><p class="eyebrow" data-status-label></p><h2 data-status-title></h2><p data-status-copy></p><div class="status-actions"><button class="primary-button" data-resume type="button">계속하기</button><button class="primary-button" data-restart type="button">다시 대결</button><button class="quiet-button" data-reselect type="button">포켓몬 변경</button></div></div></div>
          <div class="touch-controls" aria-label="터치 게임 조작"><div class="joystick" data-joystick role="group" aria-label="이동 조이스틱"><span></span></div><div class="touch-actions"><button type="button" data-action="dodge" class="touch-dodge" aria-label="회피">회피</button><button type="button" data-action="special" class="touch-special" aria-label="범위 특수 기술">회오리</button><button type="button" data-action="melee" aria-label="근접 공격">근접</button><button type="button" data-action="ranged" class="touch-ranged" aria-label="원거리 연속 방사">방사<small>길게</small></button></div></div>
        </div>
        <div class="arena-bottom"><span><i class="player-dot"></i><strong data-player-name>파이리</strong><small>YOU</small></span><span class="arena-caption">마우스로 조준 · 키보드/터치는 상대 자동 조준</span><span><small>CPU</small><strong data-enemy-name>꼬부기</strong><i class="enemy-dot"></i></span></div>
        <div class="combat-hud" aria-label="플레이어 기술 상태"><div class="energy-panel"><span>ENERGY <b data-energy-value>100</b></span><div class="energy-track" role="meter" aria-label="에너지" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100" data-energy-meter><i data-energy-fill></i></div></div><div class="action-phase" data-phase>준비</div><div class="cooldown-item melee-status"><kbd>J</kbd><span data-melee-label>할퀴기</span><b data-melee-ready>준비</b></div><div class="cooldown-item"><kbd>K</kbd><span data-stream-label>화염방사</span><b data-ranged-ready>준비</b></div><div class="cooldown-item"><kbd>L</kbd><span data-special-label>불꽃 회오리</span><b data-special-ready>준비</b></div><div class="cooldown-item dodge-status"><span>회피</span><b data-dodge-ready>준비</b></div></div>
      </section>
      <footer class="controls-footer"><div class="control-group"><span class="key-cluster"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>이동 <small>/ 방향키</small></span></div><div class="control-group"><kbd>J</kbd><span data-footer-melee>할퀴기</span></div><div class="control-group"><kbd>K</kbd><span><span data-footer-ranged>화염방사</span> <small data-ranged-hint>길게 누르기 / 클릭</small></span></div><div class="control-group"><kbd>L</kbd><span data-footer-special>불꽃 회오리</span></div><div class="control-group"><kbd>SPACE</kbd><span>회피</span></div></footer>
      <dialog class="move-help" data-help-dialog aria-labelledby="move-help-title"><div class="move-help-heading"><h2 id="move-help-title">기술 설명</h2><button type="button" class="quiet-button" data-help-close>닫기</button></div><label>포켓몬 <select data-help-species>${Object.entries(names).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><div data-help-content></div></dialog>
      <div class="charge-meter" data-charge hidden role="meter" aria-label="잎날가르기 충전" aria-valuemin="0" aria-valuemax="100"><span data-charge-label></span><div><i data-charge-fill></i><b></b></div></div>
      <p class="species-hint" data-species-hint hidden></p>
      <p class="prototype-note">Big Kid Nation의 Pokémon Arena 2D에서 영감을 받은 비공식 팬 프로토타입</p>
    </main>`;
  const shell = root.querySelector<HTMLElement>('[data-game-shell]')!;
  const find = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  root.querySelectorAll<HTMLImageElement>('.fighter-thumbnail').forEach((img) => {
    const setImageAvailable = () => {
      const available = img.complete && img.naturalWidth > 0;
      img.hidden = !available;
      img.previousElementSibling?.toggleAttribute('hidden', available);
    };
    img.addEventListener('load', setImageAvailable, { signal: abort.signal });
    img.addEventListener('error', setImageAvailable, { signal: abort.signal });
    setImageAvailable();
  });
  const pauseButton = find<HTMLButtonElement>('[data-pause]');
  const selectOverlay = find('[data-select-overlay]');
  const statusOverlay = find('[data-status-overlay]');
  const restart = find<HTMLButtonElement>('[data-restart]');
  const resume = find<HTMLButtonElement>('[data-resume]');
  const timer = find('[data-timer]');
  const choose = (species: Species) => {
    demo = false;
    shell.dataset.demo = 'false';
    started = true;
    shell.dataset.started = 'true';
    shell.dataset.finished = 'false';
    selectOverlay.hidden = true;
    statusOverlay.hidden = true;
    const opponent = find<HTMLSelectElement>('[data-opponent]').value as Species | '';
    callbacks.onSelect(species, opponent || undefined);
    find('#game-mount').focus({ preventScroll: true });
  };
  find('[data-demo]').addEventListener('click', () => {
    if (!callbacks.onDemo) return;
    demo = true;
    started = true;
    shell.dataset.demo = 'true';
    shell.dataset.started = 'true';
    shell.dataset.finished = 'false';
    selectOverlay.hidden = true;
    statusOverlay.hidden = true;
    callbacks.onDemo();
    find('#game-mount').focus({ preventScroll: true });
  }, { signal: abort.signal });
  root.querySelectorAll<HTMLButtonElement>('[data-species]').forEach((button) => button.addEventListener('click', () => choose(button.dataset.species as Species), { signal: abort.signal }));
  pauseButton.addEventListener('click', callbacks.onPause, { signal: abort.signal });
  resume.addEventListener('click', callbacks.onPause, { signal: abort.signal });
  restart.addEventListener('click', () => { if (demo && callbacks.onDemo) callbacks.onDemo(); else callbacks.onRestart(); find('#game-mount').focus({ preventScroll: true }); }, { signal: abort.signal });
  const reselect = () => {
    if (!lastPaused && lastState?.winner === null) callbacks.onPause();
    started = false;
    demo = false;
    shell.dataset.demo = 'false';
    shell.dataset.started = 'false';
    selectOverlay.hidden = false;
    statusOverlay.hidden = true;
  };
  find('[data-reselect]').addEventListener('click', reselect, { signal: abort.signal });
  find('[data-demo-exit]').addEventListener('click', reselect, { signal: abort.signal });

  const help = find<HTMLDialogElement>('[data-help-dialog]');
  const helpSpecies = find<HTMLSelectElement>('[data-help-species]');
  let resumeAfterHelp = false;
  const renderHelp = () => {
    const species = helpSpecies.value as Species;
    const entries = grassHelp(species);
    find('[data-help-content]').innerHTML = entries.length ? entries.map(move => `<article><h3>${move.key} · ${move.name}</h3><p>${move.description}</p></article>`).join('') : `<p>J ${moves[species].melee} · K ${moves[species].ranged} 길게 누르기 · L ${moves[species].special} · Space 회피</p><p>마우스 조준 또는 키보드·터치 자동 조준. 원거리 기술은 장애물에 막히며, 특수 기술의 예고 범위를 벗어나거나 회피할 수 있습니다.</p>`;
  };
  find('[data-help]').addEventListener('click', () => {
    helpSpecies.value = lastState?.fighters[0].species ?? 'bulbasaur'; renderHelp();
    resumeAfterHelp = started && !lastPaused && lastState?.winner === null;
    if (resumeAfterHelp) callbacks.onPause();
    help.showModal();
  }, { signal: abort.signal });
  help.addEventListener('keydown', event => event.stopPropagation(), { signal: abort.signal });
  helpSpecies.addEventListener('change', renderHelp, { signal: abort.signal });
  find('[data-help-close]').addEventListener('click', () => help.close(), { signal: abort.signal });
  help.addEventListener('close', () => {
    if (resumeAfterHelp && lastPaused && lastState?.winner === null) callbacks.onPause();
    resumeAfterHelp = false; find('[data-help]').focus();
  }, { signal: abort.signal });
  return {
    update(state, paused) {
      lastState = state;
      lastPaused = paused;
      shell.dataset.paused = String(paused);
      shell.dataset.finished = String(state.winner !== null);
      const elapsed = Math.floor(state.time);
      const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
      if (timer.textContent !== clock) timer.textContent = clock;
      find('[data-player-name]').textContent = names[state.fighters[0].species];
      find('[data-enemy-name]').textContent = names[state.fighters[1].species];
      find('[data-match-type]').textContent = demo ? 'MOTION DEMO' : 'TRAINING ARENA';
      const fighter = state.fighters[0];
      const energy = Math.max(0, Math.min(100, fighter.energy / Math.max(1, fighter.maxEnergy) * 100));
      find('[data-energy-value]').textContent = String(Math.round(fighter.energy));
      find('[data-energy-fill]').style.width = `${energy}%`;
      find('[data-energy-meter]').setAttribute('aria-valuenow', String(Math.round(energy)));
      const phase = fighter.knockdownTime > 0 ? '넘어짐' : fighter.stunTime > 0 ? '피격' : fighter.paralysisTime > 0 ? '감전·이동 둔화' : fighter.phase === 'windup' ? '충전 중' : fighter.phase === 'recovery' ? '후딜 · 회복 중' : fighter.phase === 'active' ? (fighter.action === 'ranged' ? (isGrass(fighter.species) ? '잎 발사' : '연속 방사 중') : fighter.action === 'dodge' ? '회피 중' : '기술 발동') : '준비';
      const seeded = state.leechSeeds.find(seed => seed.target === fighter.id);
      const marked = state.leechSeeds.find(seed => seed.owner === fighter.id);
      const status = seeded ? `씨앗 ${seeded.life.toFixed(1)}s · 후속 공격 주의` : isGrass(fighter.species) && fighter.hp > 0 && fighter.hp <= fighter.maxHp / 3 ? `심록 · ${phase}` : phase;
      find('[data-phase]').textContent = demo ? `시연 · ${status}` : status;
      find('[data-phase]').dataset.phase = fighter.phase;
      const ready = (seconds: number, minEnergy = 0) => seconds > 0.05 ? `${seconds.toFixed(1)}s` : fighter.energy < minEnergy ? '에너지 부족' : '준비';
      const hint = find('[data-species-hint]');
      hint.hidden = !isGrass(fighter.species);
      hint.textContent = fighter.species === 'bulbasaur' ? `씨앗 → J·탭 K +${B.leaf.combo} / 충전 K +${B.leaf.chargedCombo} · ${marked ? `연계 가능 ${marked.life.toFixed(1)}초` : `K ${B.leaf.perfectStart}~${B.leaf.perfectEnd}초에 놓으면 피해 ${B.leaf.perfectDamage}`} · 자세한 조건은 기술 설명` : `J 끝거리 피해 ${I.vine.tipDamage} · K 왕복 ${I.leaf.damage}+${I.leaf.returnDamage} · L 예고 후 피해 ${I.solar.damage} · 자세한 조건은 기술 설명`;
      const charging = fighter.species === 'bulbasaur' && fighter.action === 'ranged' && fighter.phase === 'windup';
      const meter = find('[data-charge]'); meter.hidden = !charging;
      if (charging) {
        const percent = fighter.chargeTime / B.leaf.maximum * 100;
        meter.setAttribute('aria-valuenow', String(Math.round(percent)));
        find('[data-charge-fill]').style.width = `${percent}%`;
        meter.style.setProperty('--perfect-start', `${B.leaf.perfectStart / B.leaf.maximum * 100}%`);
        meter.style.setProperty('--perfect-width', `${(B.leaf.perfectEnd - B.leaf.perfectStart) / B.leaf.maximum * 100}%`);
        find('[data-charge-label]').textContent = fighter.chargeSuspended ? 'K를 다시 누르면 충전 재개' : leafTier(fighter.chargeTime) === 'perfect' ? `지금 놓기 · 피해 ${B.leaf.perfectDamage}` : `충전 ${fighter.chargeTime.toFixed(2)}초 · 밝은 구간에 놓기`;
      }
      const skill = moves[fighter.species];
      find('[data-ranged-hint]').textContent = fighter.species === 'bulbasaur' ? '탭 / 충전 후 놓기' : fighter.species === 'ivysaur' ? '탭 / 왕복 맞히기' : '길게 누르기 / 클릭';
      find('[data-melee-label]').textContent = skill.melee;
      find('[data-stream-label]').textContent = skill.ranged;
      find('[data-special-label]').textContent = skill.special;
      find('[data-footer-melee]').textContent = skill.melee;
      find('[data-footer-ranged]').textContent = skill.ranged;
      find('[data-footer-special]').textContent = skill.special;
      const touchMelee = find<HTMLButtonElement>('[data-action="melee"]');
      const touchRanged = find<HTMLButtonElement>('[data-action="ranged"]');
      const touchSpecial = find<HTMLButtonElement>('[data-action="special"]');
      touchMelee.textContent = skill.melee;
      touchMelee.setAttribute('aria-label', skill.melee);
      if (touchRanged.dataset.skillSpecies !== fighter.species) {
        touchRanged.innerHTML = `${skill.ranged}<small>${fighter.species === 'bulbasaur' ? '충전' : fighter.species === 'ivysaur' ? '왕복' : '길게'}</small>`;
        touchRanged.dataset.skillSpecies = fighter.species;
      }
      touchRanged.setAttribute('aria-label', `${skill.ranged} ${fighter.species === 'bulbasaur' ? '탭 또는 길게 누르기' : fighter.species === 'ivysaur' ? '탭하여 왕복 잎 던지기' : '길게 누르기'}`);
      touchSpecial.textContent = skill.special;
      touchSpecial.setAttribute('aria-label', skill.special);
      find('[data-melee-ready]').textContent = ready(fighter.meleeCooldown);
      find('[data-ranged-ready]').textContent = ready(fighter.rangedCooldown, fighter.species === 'bulbasaur' ? B.leaf.cost : fighter.species === 'ivysaur' ? I.leaf.cost : 8);
      find('[data-special-ready]').textContent = ready(fighter.specialCooldown, fighter.species === 'bulbasaur' ? B.seed.cost : fighter.species === 'ivysaur' ? I.solar.cost : 30);
      find('[data-dodge-ready]').textContent = ready(fighter.dodgeCooldown);
      pauseButton.disabled = !started || state.winner !== null;
      const pauseLabel = paused ? '계속하기' : '일시정지';
      if (pauseButton.getAttribute('aria-label') !== pauseLabel) {
        pauseButton.setAttribute('aria-label', pauseLabel);
        pauseButton.innerHTML = `${pauseLabel} <kbd>Esc</kbd>`;
      }
      const finished = state.winner !== null;
      statusOverlay.hidden = !started || (!paused && !finished);
      if (!statusOverlay.hidden) {
        find('[data-status-label]').textContent = finished ? 'MATCH COMPLETE' : 'TAKE A BREATH';
        find('[data-status-title]').textContent = finished ? (demo ? '시연이 끝났습니다' : state.winner === 0 ? '승리했습니다!' : state.winner === 1 ? '다시 도전해 보세요' : '무승부!') : '잠시 쉬어가기';
        find('[data-status-copy]').textContent = finished ? `${names[state.fighters[0].species]} vs ${names[state.fighters[1].species]} · ${clock}` : '준비되면 전투를 이어가세요.';
        resume.hidden = finished;
        restart.hidden = !finished;
        restart.textContent = demo ? '시연 다시 보기' : '다시 대결';
      }
    },
    destroy() { abort.abort(); root.innerHTML = ''; },
  };
}
