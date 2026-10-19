(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = 960, H = 540;
  const worldWidth = 1500;
  const gravity = 0.62;
  const player = { x: 55, y: 390, w: 38, h: 43, vx: 0, vy: 0, grounded: false, face: 1, ridePlatform: null };
  const input = { left: false, right: false, jumpQueued: false, jumpHeld: false, keyState: { left: false, right: false, jump: false } };
  const startX = 55, floorY = 460;
  const audioState = { context: null, masterGain: null, musicGain: null, sfxGain: null, musicTimer: null, musicStarted: false, muted: false, musicStep: 0, failureTriggered: false, fallTriggered: false }; 
  const musicPattern = [261.63, 329.63, 392.0, 329.63, 293.66, 293.66, 349.23, 392.0, 440.0, 392.0, 349.23, 329.63, 293.66, 261.63, 293.66, 329.63];
  const devilState = {
    activeText: '',
    visible: false,
    hideTimer: null,
    expression: 'idle',
    expressionTimer: null,
    lastText: '',
    totalFailures: 0,
    repeatedObstacleFailures: new Map(),
    introShown: false,
    nextBubbleAt: 0,
    lastNearMissAtPan: false
  };

  const devilLines = {
    intro: ['Collect the food. Reach me. Easy!', 'You can do it. Probably.'],
    fall: ['WHEEEEE! Oh. Goodbye.', 'That was dramatic. And pointless.'],
    repeatedFailure: ['You fell for that AGAIN?', 'The floor is still undefeated.'],
    nearMiss: ['That was way too close.', 'You nudged disaster and it blinked.'],
    collect: ['Hey! That was mine!', 'Nope. That was definitely mine.'],
    levelComplete: ['Fine. You got lucky.', 'This round goes to you. Barely.'],
    obstacleRepeat: ['You keep doing this to the pan?', 'The pan is your favorite enemy.'],
    obstacleRepeatStrong: ['You are making a hobby out of that.', 'That obstacle has your name on it now.']
  };

  const audioController = {
    ensureContext() {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      if (!audioState.context) {
        audioState.context = new AudioCtor();
        audioState.masterGain = audioState.context.createGain();
        audioState.musicGain = audioState.context.createGain();
        audioState.sfxGain = audioState.context.createGain();
        audioState.musicGain.gain.value = 0.1;
        audioState.sfxGain.gain.value = 0.18;
        audioState.masterGain.gain.value = 0.9;
        audioState.musicGain.connect(audioState.masterGain);
        audioState.sfxGain.connect(audioState.masterGain);
        audioState.masterGain.connect(audioState.context.destination);
      }
      if (audioState.context.state === 'suspended') {
        audioState.context.resume();
      }
      if (audioState.muted) {
        audioState.masterGain.gain.setTargetAtTime(0, audioState.context.currentTime, 0.04);
      } else {
        audioState.masterGain.gain.setTargetAtTime(0.9, audioState.context.currentTime, 0.04);
      }
      return audioState.context;
    },
    setMuted(value) {
      audioState.muted = value;
      const button = $('audioToggle');
      if (button) {
        button.textContent = value ? '🔇' : '🔊';
        button.setAttribute('aria-label', value ? 'Unmute audio' : 'Mute audio');
      }
      if (audioState.masterGain && audioState.context) {
        audioState.masterGain.gain.setTargetAtTime(value ? 0 : 0.9, audioState.context.currentTime, 0.04);
      }
    },
    startMusic() {
      const ctx = this.ensureContext();
      if (!ctx || audioState.musicStarted) return;
      audioState.musicStarted = true;
      audioState.musicStep = 0;
      audioState.musicTimer = setInterval(() => {
        if (audioState.muted || !running) return;
        const freq = musicPattern[audioState.musicStep % musicPattern.length];
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.045, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        osc.connect(gain);
        gain.connect(audioState.musicGain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.13);
        audioState.musicStep += 1;
      }, 180);
    },
    stopMusic() {
      if (audioState.musicTimer) {
        clearInterval(audioState.musicTimer);
      }
      audioState.musicTimer = null;
      audioState.musicStarted = false;
    },
    playTone({ frequency = 440, type = 'square', duration = 0.12, volume = 0.12, sweep = 0 }) {
      const ctx = this.ensureContext();
      if (!ctx || audioState.muted) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, ctx.currentTime);
      if (sweep !== 0) {
        osc.frequency.linearRampToValueAtTime(Math.max(40, frequency + sweep), ctx.currentTime + duration);
      }
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioState.sfxGain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration + 0.02);
    },
    playFall() {
      this.playTone({ frequency: 280, type: 'sawtooth', duration: 0.2, volume: 0.12, sweep: -200 });
      setTimeout(() => {
        this.playTone({ frequency: 180, type: 'triangle', duration: 0.35, volume: 0.09, sweep: -120 });
      }, 110);
    },
    playFailure() {
      this.playTone({ frequency: 260, type: 'square', duration: 0.18, volume: 0.13, sweep: -80 });
      setTimeout(() => {
        this.playTone({ frequency: 180, type: 'triangle', duration: 0.28, volume: 0.11, sweep: -60 });
      }, 120);
      setTimeout(() => {
        this.playTone({ frequency: 120, type: 'sawtooth', duration: 0.42, volume: 0.1, sweep: -50 });
      }, 260);
    }
  };

  const level1PlatformSeed = [
    { x: 0, y: floorY, w: 360, h: 80, kind: 'ground' },
    { x: 420, y: 420, w: 100, h: 18, kind: 'safe' },
    { x: 560, y: 392, w: 90, h: 18, kind: 'safe' },
    { x: 682, y: 355, w: 92, h: 18, kind: 'disappearing', hidden: false, triggered: false, vanishTimer: 0, vanishDelay: 18 },
    { x: 835, y: 318, w: 92, h: 18, kind: 'moving', minX: 720, maxX: 1020, dir: 1, speed: 1.25, dx: 0 },
    { x: 1000, y: 392, w: 100, h: 18, kind: 'safe' },
    { x: 1170, y: floorY, w: 330, h: 80, kind: 'ground' }
  ];

  const level1FoodSeed = [
    { id: 'l1-food-1', worldX: 145, worldY: 410, emoji: '🍓', bob: 0.8 },
    { id: 'l1-food-2', worldX: 470, worldY: 365, emoji: '🍪', bob: 1.7 },
    { id: 'l1-food-3', worldX: 600, worldY: 332, emoji: '🍕', bob: 2.9 },
    { id: 'l1-food-4', worldX: 820, worldY: 290, emoji: '🍩', bob: 3.2 },
    { id: 'l1-food-5', worldX: 1240, worldY: 412, emoji: '🧀', bob: 4.4 }
  ];

  const level2PlatformSeed = [
    { x: 0, y: floorY, w: 230, h: 80, kind: 'ground' },
    { x: 300, y: 420, w: 130, h: 18, kind: 'safe' },
    { x: 500, y: 380, w: 90, h: 18, kind: 'moving', minX: 440, maxX: 660, dir: 1, speed: 1.8, dx: 0 },
    { x: 710, y: 338, w: 110, h: 18, kind: 'safe' },
    { x: 905, y: 425, w: 100, h: 18, kind: 'disappearing', hidden: false, triggered: false, vanishTimer: 0, vanishDelay: 72 },
    { x: 1050, y: 360, w: 110, h: 18, kind: 'safe' },
    { x: 1200, y: 315, w: 120, h: 18, kind: 'trigger', hidden: false, triggered: false, moved: false, xBase: 1200, shiftDir: -1, shiftAmount: 165, moveDelay: 6, shiftSpeed: 11, moveTimer: 0, dx: 0 },
    { x: 1370, y: 280, w: 120, h: 18, kind: 'safe' },
    { x: 1540, y: floorY, w: 280, h: 80, kind: 'ground' }
  ];

  const level2FoodSeed = [
    { id: 'l2-food-1', worldX: 120, worldY: 410, emoji: '🍓', bob: 0.5 },
    { id: 'l2-food-2', worldX: 350, worldY: 365, emoji: '🍪', bob: 1.5 },
    { id: 'l2-food-3', worldX: 530, worldY: 325, emoji: '🍕', bob: 2.6 },
    { id: 'l2-food-4', worldX: 1120, worldY: 300, emoji: '🍩', bob: 3.1 },
    { id: 'l2-food-5', worldX: 1560, worldY: 412, emoji: '🧀', bob: 4.0 }
  ];

  const levelConfigs = {
    1: {
      id: 1,
      name: 'LEVEL 01 · THE POLITE KITCHEN',
      title: 'A perfectly normal kitchen.',
      copy: 'Collect all 5 snacks and reach the Devil Burger. Watch your step. Or don’t. We’re not your mum.',
      startButton: 'LET’S GET SNACKED',
      overlayEmoji: '🍓',
      startX: 55,
      floorY: 460,
      worldWidth: 1500,
      platformSeed: level1PlatformSeed,
      foodSeed: level1FoodSeed,
      burger: { x: 1315, y: 385, w: 70, h: 75, baseX: 1315 },
      obstacle: null,
      pan: null
    },
    2: {
      id: 2,
      name: 'LEVEL 02 · THE ANGRY KITCHEN',
      title: 'The kitchen is not calm.',
      copy: 'The fryer’s buzzing, the floor is lying, and the burger is still judging you.',
      startButton: 'ENTER THE KITCHEN',
      overlayEmoji: '🔥',
      startX: 65,
      floorY: 460,
      worldWidth: 1850,
      platformSeed: level2PlatformSeed,
      foodSeed: level2FoodSeed,
      burger: { x: 1685, y: 315, w: 70, h: 75, baseX: 1685 },
      obstacle: null,
      pan: { x: 830, y: 260, w: 82, h: 26, amplitude: 105, phase: 1.8, speed: 0.045 }
    },
    3: {
      id: 3,
      name: 'LEVEL 03 · RAGE KITCHEN',
      title: 'The kitchen is no longer pretending.',
      copy: 'The grill is hot, the floor is mean, and the last burger still looks smug. Keep moving and keep your nerve.',
      startButton: 'ENTER RAGE KITCHEN',
      overlayEmoji: '👑',
      startX: 60,
      floorY: 460,
      worldWidth: 2550,
      platformSeed: [
        { x: 0, y: 460, w: 210, h: 80, kind: 'ground' },
        { x: 270, y: 420, w: 120, h: 18, kind: 'safe' },
        { x: 470, y: 372, w: 110, h: 18, kind: 'moving', minX: 430, maxX: 660, dir: 1, speed: 1.9, dx: 0 },
        { x: 720, y: 330, w: 100, h: 18, kind: 'safe' },
        { x: 930, y: 290, w: 110, h: 18, kind: 'moving', minX: 860, maxX: 1120, dir: -1, speed: 1.7, dx: 0 },
        { x: 1160, y: 350, w: 115, h: 18, kind: 'safe' },
        { x: 1355, y: 410, w: 120, h: 18, kind: 'disappearing', hidden: false, triggered: false, vanishTimer: 0, vanishDelay: 42 },
        { x: 1520, y: 300, w: 120, h: 18, kind: 'safe' },
        { x: 1710, y: 340, w: 110, h: 18, kind: 'moving', minX: 1560, maxX: 1865, dir: 1, speed: 1.8, dx: 0 },
        { x: 1900, y: 260, w: 120, h: 18, kind: 'safe' },
        { x: 2090, y: 220, w: 110, h: 18, kind: 'trigger', hidden: false, triggered: false, moved: false, xBase: 2090, shiftDir: -1, shiftAmount: 150, moveDelay: 6, shiftSpeed: 11, moveTimer: 0, dx: 0 },
        { x: 2280, y: 460, w: 270, h: 80, kind: 'ground' }
      ],
      foodSeed: [
        { id: 'l3-food-1', worldX: 190, worldY: 410, emoji: '🍓', bob: 0.6 },
        { id: 'l3-food-2', worldX: 330, worldY: 365, emoji: '🍪', bob: 1.8 },
        { id: 'l3-food-3', worldX: 760, worldY: 290, emoji: '🍕', bob: 2.9 },
        { id: 'l3-food-4', worldX: 980, worldY: 250, emoji: '🍩', bob: 3.5 },
        { id: 'l3-food-5', worldX: 1540, worldY: 260, emoji: '🧀', bob: 4.2 },
        { id: 'l3-food-6', worldX: 2140, worldY: 180, emoji: '🍟', bob: 4.8 }
      ],
      burger: { x: 2430, y: 365, w: 70, h: 75, baseX: 2430 },
      obstacle: null,
      pan: { x: 1230, y: 260, w: 86, h: 24, amplitude: 100, phase: 2.2, speed: 0.04 }
    }
  };

  const platformSeed = levelConfigs[1].platformSeed;
  const foodSeed = levelConfigs[1].foodSeed;

  let highestUnlockedLevel = 3;

  let currentLevel = 1;
  let food = [], platforms = [], running = false, won = false, gameOver = false, raf = 0, lastTime = 0;
  let deaths = 0, rage = 0, levelTime = 0, toastTimer = 0;
  let jumpCount = 0, lastX = startX, rushFrames = 0, idleFrames = 0, behaviorHint = '', cameraX = 0;
  let burger = { x: 1315, y: 385, w: 70, h: 75, baseX: 1315 };
  let activePan = null;
  let level2ShiftTriggered = false;
  let level2FinalObstacle = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  }
  window.addEventListener('resize', resizeCanvas);

  function syncInputFlags() {
    input.left = input.keyState.left;
    input.right = input.keyState.right;
    input.jumpHeld = input.keyState.jump;
  }

  function handleKeyEvent(event, isPressed) {
    if (isPressed) {
      audioController.ensureContext();
    }
    const key = event.key;
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    const isLeftKey = key === 'ArrowLeft' || normalized === 'a';
    const isRightKey = key === 'ArrowRight' || normalized === 'd';
    const isJumpKey = key === ' ' || key === 'Spacebar' || key === 'ArrowUp' || normalized === 'w';

    if (isLeftKey) {
      input.keyState.left = isPressed;
    }
    if (isRightKey) {
      input.keyState.right = isPressed;
    }
    if (isJumpKey) {
      if (isPressed && !input.keyState.jump) {
        input.jumpQueued = true;
      }
      input.keyState.jump = isPressed;
    }

    syncInputFlags();

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'Spacebar', 'a', 'd', 'w', 'A', 'D', 'W'].includes(key)) {
      event.preventDefault();
    }
  }

  window.addEventListener('keydown', (event) => handleKeyEvent(event, true));
  window.addEventListener('keyup', (event) => handleKeyEvent(event, false));

  function refreshFoodHud() {
    const count = food.filter((item) => item.collected).length;
    $('foodValue').textContent = `${count} / ${food.length}`;
    $('rageBar').style.width = Math.min(100, rage * 10) + '%';
    $('deathValue').textContent = deaths;
    $('moodValue').textContent = rage < 2 ? '😇 INNOCENT' : rage < 4 ? '🍳 PETTY' : rage < 7 ? '🌶️ SALTY' : '😈 MENACE';
  }

  function resetInputState() {
    input.keyState.left = false;
    input.keyState.right = false;
    input.keyState.jump = false;
    input.left = false;
    input.right = false;
    input.jumpQueued = false;
    input.jumpHeld = false;
  }

  function pickDevilLine(group, fallback = '') {
    const options = devilLines[group] || [fallback];
    const usable = options.filter((line) => line !== devilState.lastText);
    const pool = usable.length ? usable : options;
    const chosen = pool[Math.floor(Math.random() * pool.length)] || fallback;
    devilState.lastText = chosen;
    return chosen;
  }

  function showDevilBubble(text, options = {}) {
    if (!text) return;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const { duration = 2200, cooldown = 1600, expression = 'talk' } = options;
    if (now < devilState.nextBubbleAt && devilState.visible) return;
    devilState.visible = true;
    devilState.activeText = text;
    devilState.expression = expression;
    devilState.nextBubbleAt = now + cooldown;
    if (devilState.hideTimer) clearTimeout(devilState.hideTimer);
    if (devilState.expressionTimer) clearTimeout(devilState.expressionTimer);
    devilState.hideTimer = setTimeout(() => {
      devilState.visible = false;
      devilState.activeText = '';
      devilState.expression = 'idle';
    }, duration);
    devilState.expressionTimer = setTimeout(() => {
      if (devilState.expression === expression) {
        devilState.expression = 'idle';
      }
    }, duration + 180);
  }

  function queueDevilReaction(group, fallback = '', options = {}) {
    const text = pickDevilLine(group, fallback);
    showDevilBubble(text, options);
  }

  function resetDevilSessionState() {
    devilState.totalFailures = 0;
    devilState.repeatedObstacleFailures.clear();
    devilState.introShown = false;
    devilState.lastText = '';
    devilState.visible = false;
    devilState.activeText = '';
    devilState.expression = 'idle';
    devilState.lastNearMissAtPan = false;
    if (devilState.hideTimer) {
      clearTimeout(devilState.hideTimer);
      devilState.hideTimer = null;
    }
  }

  function loadLevel(levelNumber, autoStart = false) {
    audioState.failureTriggered = false;
    audioState.fallTriggered = false;
    audioController.stopMusic();
    const safeLevel = Math.min(levelNumber, highestUnlockedLevel);
    currentLevel = safeLevel;
    const config = levelConfigs[currentLevel];
    const levelState = {
      platforms: config.platformSeed.map((platform) => ({ ...platform, hidden: !!platform.hidden, triggered: !!platform.triggered, vanishTimer: platform.vanishTimer || 0, dx: 0 })),
      food: config.foodSeed.map((item) => ({ ...item, collected: false })),
      burger: { ...config.burger },
      pan: config.pan ? { ...config.pan } : null,
      obstacle: config.obstacle ? { ...config.obstacle } : null,
      shiftTriggered: false,
      startX: config.startX,
      floorY: config.floorY,
      worldWidth: config.worldWidth
    };

    player.x = levelState.startX;
    player.y = levelState.floorY - player.h;
    player.vx = 0;
    player.vy = 0;
    player.grounded = true;
    player.face = 1;
    player.ridePlatform = null;
    resetInputState();

    platforms = levelState.platforms;
    food = levelState.food;
    burger = levelState.burger;
    activePan = levelState.pan;
    level2ShiftTriggered = false;
    level2FinalObstacle = levelState.obstacle;
    cameraX = 0;
    running = false;
    won = false;
    gameOver = false;
    levelTime = 0;
    jumpCount = 0;
    lastX = player.x;
    rushFrames = 0;
    idleFrames = 0;
    behaviorHint = '';

    if (currentLevel === 1 && !devilState.introShown) {
      devilState.introShown = true;
      queueDevilReaction('intro', 'Collect the food. Reach me. Easy!', { duration: 2600, cooldown: 8000, expression: 'talk' });
    }

    refreshFoodHud();
    $('overlay').classList.remove('hidden');
    $('overlayEmoji').textContent = config.overlayEmoji;
    $('overlayKicker').textContent = config.name;
    $('overlayTitle').textContent = config.title;
    $('overlayCopy').textContent = config.copy;
    $('startButton').textContent = config.startButton;
    $('overlaySecondaryButton').classList.add('hidden');
    $('narrator').innerHTML = currentLevel === 1 ? '“The platforms are completely trustworthy.” <span>— the burger, probably</span>' : currentLevel === 2 ? '“This kitchen has opinions.” <span>— the fryer, probably</span>' : '“Rage Kitchen is louder than your plan.” <span>— the grill, definitely</span>';
    if (autoStart) {
      startGame();
    }
    draw();
  }

  function freshLevel() {
    loadLevel(currentLevel, false);
  }

  function showToast(text, duration = 1500) {
    const el = $('gameToast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }

  function setNarrator(text) {
    $('narrator').textContent = text;
  }

  function startGame() {
    if (gameOver || won) return;
    audioController.ensureContext();
    audioController.startMusic();
    $('overlay').classList.add('hidden');
    running = true;
    lastTime = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function restartLevel() {
    cancelAnimationFrame(raf);
    freshLevel();
    startGame();
  }

  $('startButton').addEventListener('click', () => {
    if (gameOver) {
      restartLevel();
      return;
    }
    if (won && currentLevel === 1) {
      loadLevel(2, true);
      return;
    }
    if (won && currentLevel === 2) {
      loadLevel(3, true);
      return;
    }
    if (won && currentLevel === 3) {
      restartLevel();
      return;
    }
    startGame();
  });
  $('overlaySecondaryButton').addEventListener('click', () => {
    if (won && currentLevel === 1) {
      restartLevel();
      return;
    }
    if (won && currentLevel === 2) {
      loadLevel(2, true);
      return;
    }
    if (won && currentLevel === 3) {
      loadLevel(2, true);
      return;
    }
    if (currentLevel === 2) {
      loadLevel(1, true);
      return;
    }
    restartLevel();
  });
  $('restartButton').addEventListener('click', restartLevel);

  function hit(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function die(reason) {
    if (gameOver || won || !running) return;
    gameOver = true;
    running = false;
    audioController.stopMusic();
    if (!audioState.failureTriggered) {
      audioController.playFailure();
      audioState.failureTriggered = true;
    }
    devilState.totalFailures += 1;
    if (reason === 'HOT PAN!') {
      const panFalls = (devilState.repeatedObstacleFailures.get('pan') || 0) + 1;
      devilState.repeatedObstacleFailures.set('pan', panFalls);
    }
    const panRepeatCount = devilState.repeatedObstacleFailures.get('pan') || 0;
    if (reason === 'HOT PAN!' && panRepeatCount >= 3) {
      queueDevilReaction('obstacleRepeatStrong', 'You are making a hobby out of that.', { duration: 2300, cooldown: 6000, expression: 'shock' });
    } else if (reason === 'HOT PAN!' && panRepeatCount >= 2) {
      queueDevilReaction('obstacleRepeat', 'You keep doing this to the pan?', { duration: 2200, cooldown: 6000, expression: 'shock' });
    } else if (devilState.totalFailures >= 3) {
      queueDevilReaction('repeatedFailure', 'You fell for that AGAIN?', { duration: 2200, cooldown: 6000, expression: 'shock' });
    } else {
      queueDevilReaction('fall', 'WHEEEEE! Oh. Goodbye.', { duration: 2200, cooldown: 4500, expression: 'shock' });
    }
    player.vx = 0;
    player.vy = 0;
    resetInputState();
    deaths += 1;
    rage = Math.min(10, rage + 1);
    refreshFoodHud();
    $('overlay').classList.remove('hidden');
    $('overlayEmoji').textContent = '💥';
    $('overlayKicker').textContent = 'YOU FELL';
    $('overlayTitle').textContent = 'You fell! Try again?';
    $('overlayCopy').textContent = 'The floor wins this round. Reset and try the kitchen again.';
    $('startButton').textContent = 'Retry';
    setNarrator(deaths === 1 ? '“Oops. That was definitely a normal platform.”' : deaths < 4 ? '“The floor would like to apologise. It won’t.”' : '“You again? The burger is laughing.”');
    showToast(reason + ' — TRY AGAIN', 1100);
  }

  function winGame() {
    if (won) return;
    won = true;
    running = false;
    audioController.stopMusic();
    queueDevilReaction('levelComplete', 'Fine. You got lucky.', { duration: 2100, cooldown: 6000, expression: 'cheer' });
    if (currentLevel === 1) {
      $('overlay').classList.remove('hidden');
      $('overlayEmoji').textContent = '✅';
      $('overlayKicker').textContent = 'LEVEL 01 COMPLETE';
      $('overlayTitle').textContent = 'Level 1 Complete!';
      $('overlayCopy').textContent = 'The kitchen is defeated. Continue to the next one.';
      $('startButton').textContent = 'Continue to Level 2';
      $('overlaySecondaryButton').textContent = 'Replay Level 1';
      $('overlaySecondaryButton').classList.remove('hidden');
      setNarrator('“Fine. You can have one bite. ONE.”');
      showToast('LEVEL 1 COMPLETE! 🍔', 2000);
      return;
    }
    if (currentLevel === 2) {
      $('overlay').classList.remove('hidden');
      $('overlayEmoji').textContent = '✅';
      $('overlayKicker').textContent = 'LEVEL 02 COMPLETE';
      $('overlayTitle').textContent = 'Level 2 Complete!';
      $('overlayCopy').textContent = 'The angry kitchen is behind you. Continue to Rage Kitchen.';
      $('startButton').textContent = 'Continue to Level 3';
      $('overlaySecondaryButton').textContent = 'Replay Level 2';
      $('overlaySecondaryButton').classList.remove('hidden');
      setNarrator('“You survived the fryer. Rage Kitchen is waiting.”');
      showToast('LEVEL 2 COMPLETE! 🔥', 2100);
      return;
    }
    if (currentLevel === 3) {
      $('overlay').classList.remove('hidden');
      $('overlayEmoji').textContent = '👑';
      $('overlayKicker').textContent = 'RAGE KITCHEN CLEARED';
      $('overlayTitle').textContent = 'You Beat Rage Kitchen!';
      $('overlayCopy').textContent = 'The last burger is defeated. Replay Rage Kitchen or head back to the fryer.';
      $('startButton').textContent = 'Replay Level 3';
      $('overlaySecondaryButton').textContent = 'Return to Level 2';
      $('overlaySecondaryButton').classList.remove('hidden');
      setNarrator('“The kitchen is finally quiet. For now.”');
      showToast('YOU BEAT RAGE KITCHEN! 🏆', 2200);
      return;
    }
  }

  function update(dt) {
    levelTime += dt;

    if (currentLevel === 2 && activePan) {
      const panX = activePan.x + Math.sin(levelTime * activePan.speed + activePan.phase) * activePan.amplitude;
      const panBox = { x: panX, y: activePan.y, w: activePan.w, h: activePan.h };
      const playerCenterX = player.x + player.w / 2;
      const panCenterX = panBox.x + panBox.w / 2;
      const nearPan = Math.abs(playerCenterX - panCenterX) < 26 && player.y + player.h > activePan.y - 10 && player.y < activePan.y + activePan.h + 26;
      if (nearPan && !devilState.lastNearMissAtPan) {
        queueDevilReaction('nearMiss', 'That was way too close.', { duration: 1800, cooldown: 6000, expression: 'shock' });
      }
      devilState.lastNearMissAtPan = nearPan;
    }

    if (Math.abs(player.x - lastX) < 0.15) idleFrames += dt;
    else idleFrames = 0;
    if (player.x > lastX + 0.5) rushFrames += dt;
    else if (player.x < lastX - 0.5) rushFrames = Math.max(0, rushFrames - dt * 0.5);
    lastX = player.x;

    for (const platform of platforms) {
      if (!platform) continue;
      if (platform.kind === 'moving') {
        platform.x += platform.speed * platform.dir * dt;
        platform.dx = platform.speed * platform.dir * dt;
        if (platform.x <= platform.minX) {
          platform.x = platform.minX;
          platform.dir = 1;
        }
        if (platform.x + platform.w >= platform.maxX) {
          platform.x = platform.maxX - platform.w;
          platform.dir = -1;
        }
      }

      if (platform.kind === 'trigger') {
        if (!platform.triggered) {
          const triggerZone = player.x + player.w > platform.x - 18 && player.x < platform.x + platform.w + 18;
          const playerAbove = player.y + player.h >= platform.y - 8 && player.y + player.h <= platform.y + 28;
          if (triggerZone && playerAbove) {
            platform.triggered = true;
            platform.moveTimer = dt;
            platform.dx = 0;
          }
        } else if (!platform.moved) {
          const previousX = platform.x;
          platform.moveTimer += dt;
          if (platform.moveTimer >= platform.moveDelay) {
            const elapsed = platform.moveTimer - platform.moveDelay;
            const targetShift = Math.min(platform.shiftAmount, platform.shiftSpeed * elapsed);
            platform.x = platform.xBase + platform.shiftDir * targetShift;
            platform.dx = platform.x - previousX;
            if (targetShift >= platform.shiftAmount) {
              platform.moved = true;
              platform.dx = 0;
            }
          } else {
            platform.dx = 0;
          }
        }
      }
    }

    if (player.grounded && player.ridePlatform && (player.ridePlatform.kind === 'moving' || player.ridePlatform.kind === 'trigger')) {
      player.x += player.ridePlatform.dx;
    }

    const speed = 3.25;
    player.vx = 0;
    if (input.left) { player.vx = -speed; player.face = -1; }
    if (input.right) { player.vx = speed; player.face = 1; }
    if (input.jumpQueued && player.grounded) { player.vy = -12.3; player.grounded = false; jumpCount++; }
    input.jumpQueued = false;

    const previousBottom = player.y + player.h;
    player.vy = Math.min(13, player.vy + gravity * dt);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, 0, levelConfigs[currentLevel].worldWidth - player.w);
    player.grounded = false;
    player.ridePlatform = null;

    for (const platform of platforms) {
      if (!platform || platform.hidden) continue;
      if (platform.kind === 'disappearing' && platform.triggered) {
        platform.vanishTimer += dt;
        if (platform.vanishTimer >= (platform.vanishDelay ?? 18)) {
          platform.hidden = true;
          continue;
        }
      }
      const landing = player.vy >= 0 && previousBottom <= platform.y + 6 && player.y + player.h >= platform.y && player.x + player.w > platform.x && player.x < platform.x + platform.w;
      if (landing) {
        if (platform.kind === 'disappearing' && !platform.triggered) {
          platform.triggered = true;
          platform.vanishTimer = 0;
        }
        player.y = platform.y - player.h;
        player.vy = 0;
        player.grounded = true;
        player.ridePlatform = platform;
      }
    }

    for (const item of food) {
      if (item.collected) continue;
      const hitBox = { x: item.worldX, y: item.worldY - 22, w: 30, h: 30 };
      if (hit(player, hitBox)) {
        item.collected = true;
        const count = food.filter((entry) => entry.collected).length;
        $('foodValue').textContent = `${count} / ${food.length}`;
        const messages = ['NICE SNACK! +1', 'CRUNCH! +1', 'YUM. +1', 'SNACK SECURED! +1', 'CHEESE ACQUIRED! +1'];
        showToast(messages[count - 1], 850);
        queueDevilReaction('collect', 'Hey! That was mine!', { duration: 1800, cooldown: 5000, expression: 'talk' });
        if (count === food.length) {
          setNarrator(currentLevel === 1 ? '“All snacks secured. Now just touch the suspicious burger.”' : currentLevel === 2 ? '“Everything is on the counter. The burger is still smug.”' : '“The kitchen’s snacks are all accounted for.”');
        }
      }
    }

    if (!behaviorHint && rushFrames > 2.2) {
      behaviorHint = 'rush';
      setNarrator('“Running straight at the problem? Bold snack strategy.”');
    }
    if (jumpCount >= 4 && behaviorHint !== 'jump') {
      behaviorHint = 'jump';
      setNarrator('“You jump like you owe gravity money.”');
    }
    if (idleFrames > 3.5 && behaviorHint !== 'idle') {
      behaviorHint = 'idle';
      setNarrator('“Waiting for the floor to apologise? Cute.”');
    }

    if (player.y > H + 55) {
      if (!audioState.fallTriggered) {
        audioController.playFall();
        audioState.fallTriggered = true;
      }
      die('FLOOR? WHAT FLOOR?');
      return;
    }

    if (currentLevel === 2 && activePan) {
      const panX = activePan.x + Math.sin(levelTime * activePan.speed + activePan.phase) * activePan.amplitude;
      const panBox = { x: panX, y: activePan.y, w: activePan.w, h: activePan.h };
      if (hit(player, panBox)) {
        die('HOT PAN!');
        return;
      }
    }

    const goal = { x: burger.x, y: burger.y, w: burger.w, h: burger.h };
    const count = food.filter((entry) => entry.collected).length;
    if (hit(player, goal)) {
      if (count === food.length) winGame();
      else if (currentLevel === 1) {
        setNarrator(`“No snacks, no burger. You have ${count}/5. Go back, hungry hero.”`);
        showToast(`YOU NEED ALL 5 SNACKS (${count}/5)`, 1200);
        player.x = 1210;
        player.vx = 0;
      } else {
        setNarrator(`“No snacks, no burger. You have ${count}/5. Keep moving.”`);
        showToast(`YOU NEED ALL 5 SNACKS (${count}/5)`, 1200);
      }
    }

    const targetCamera = clamp(player.x + player.w / 2 - W / 2, 0, levelConfigs[currentLevel].worldWidth - W);
    cameraX += (targetCamera - cameraX) * 0.12;
  }

  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function drawCloud(x, y) {
    rect(x, y, 58, 15, '#f6fff0');
    rect(x + 12, y - 12, 34, 14, '#f6fff0');
    rect(x + 20, y + 12, 28, 8, '#f6fff0');
  }

  function drawStrawberry(x, y) {
    rect(x + 10, y + 7, 20, 7, '#e74767');
    rect(x + 5, y + 13, 30, 17, '#f45170');
    rect(x + 8, y + 28, 24, 8, '#e74767');
    rect(x + 13, y + 35, 14, 4, '#c93658');
    rect(x + 12, y + 2, 7, 6, '#68b66c');
    rect(x + 19, y - 1, 7, 7, '#68b66c');
    rect(x + 24, y + 4, 8, 4, '#68b66c');
    rect(x + 12, y + 15, 4, 5, '#fff5df');
    rect(x + 25, y + 15, 4, 5, '#fff5df');
    rect(x + 14, y + 16, 2, 3, '#302344');
    rect(x + 26, y + 16, 2, 3, '#302344');
    rect(x + 18, y + 25, 7, 2, '#9c2347');
    rect(x + 5, y + 36, 10, 5, '#ffb8bf');
    rect(x + 27, y + 36, 10, 5, '#ffb8bf');
  }

  function drawDevilBurger(x, y, expression = 'idle') {
    rect(x + 0, y + 35, 76, 10, '#8e3c35');
    rect(x - 5, y + 24, 86, 14, '#f4a53c');
    rect(x - 2, y + 17, 78, 8, '#5baf65');
    rect(x + 1, y + 8, 72, 10, '#f4d16a');
    rect(x + 4, y - 3, 66, 13, '#e99b45');
    rect(x + 8, y - 7, 58, 8, '#ffc96b');

    const eyeLift = expression === 'shock' ? 3 : 0;
    const eyeX = expression === 'cheer' ? 3 : 0;
    rect(x + 9 + eyeX, y - 13 + eyeLift, 9, 12, '#ff6489');
    rect(x + 14 + eyeX, y - 18 + eyeLift, 6, 8, '#ff6489');
    rect(x + 59 - eyeX, y - 13 + eyeLift, 9, 12, '#ff6489');
    rect(x + 57 - eyeX, y - 18 + eyeLift, 6, 8, '#ff6489');

    if (expression === 'laugh') {
      rect(x + 18, y + 17, 40, 7, '#302344');
      rect(x + 22, y + 25, 24, 3, '#302344');
    } else if (expression === 'shock') {
      rect(x + 17, y + 13, 42, 9, '#302344');
      rect(x + 20, y + 22, 32, 3, '#302344');
    } else if (expression === 'cheer') {
      rect(x + 18, y + 15, 4, 7, '#302344');
      rect(x + 54, y + 15, 4, 7, '#302344');
      rect(x + 27, y + 18, 22, 5, '#302344');
    } else {
      rect(x + 18, y + 16, 5, 7, '#302344');
      rect(x + 54, y + 16, 5, 7, '#302344');
      rect(x + 30, y + 26, 15, 3, '#302344');
    }

    rect(x + 30, y + 31, 4, 3, '#fff5df');
    rect(x + 41, y + 31, 4, 3, '#fff5df');
  }

  function drawSpeechBubble(text, x, y) {
    const paddingX = 12;
    const paddingY = 10;
    const maxWidth = 170;
    const width = Math.min(maxWidth, Math.max(110, text.length * 7 + 18));
    const height = 34;
    ctx.fillStyle = '#2a2547';
    ctx.fillRect(Math.round(x), Math.round(y), width, height);
    ctx.fillStyle = '#fff5df';
    ctx.fillRect(Math.round(x + 4), Math.round(y + 4), width - 8, height - 8);
    ctx.fillStyle = '#2a2547';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(text, x + paddingX, y + 20);
    ctx.fillStyle = '#fff5df';
    ctx.beginPath();
    ctx.moveTo(x + 28, y + height);
    ctx.lineTo(x + 42, y + height + 12);
    ctx.lineTo(x + 56, y + height);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlatform(platform) {
    if (!platform || platform.hidden) return;
    const x = platform.x - cameraX;

    if (platform.kind === 'ground') {
      rect(x, platform.y, platform.w, platform.h, '#9a624d');
      rect(x, platform.y, platform.w, 9, '#65b96e');
      rect(x, platform.y + 9, platform.w, 5, '#a5df83');
      for (let px = x + 8; px < x + platform.w - 5; px += 32) {
        rect(px, platform.y + 23, 12, 5, '#8a5147');
        rect(px + 13, platform.y + 39, 8, 5, '#8a5147');
      }
      return;
    }

    if (platform.kind === 'trigger') {
      rect(x, platform.y, platform.w, platform.h, '#9060a8');
      rect(x, platform.y, platform.w, 5, '#f6d9ff');
      return;
    }

    if (platform.kind === 'hole') {
      rect(x, platform.y, platform.w, platform.h, '#26223c');
      rect(x + 8, platform.y + 2, platform.w - 16, 10, '#41355d');
      return;
    }

    if (platform.kind === 'gate') {
      rect(x, platform.y, platform.w, platform.h, '#f6d365');
      rect(x + 6, platform.y - 18, platform.w - 12, 20, '#f7a17a');
      rect(x + 14, platform.y + 6, platform.w - 28, 8, '#7a4f24');
      return;
    }

    rect(x, platform.y, platform.w, platform.h, '#9b514c');
    rect(x, platform.y, platform.w, 7, '#ffd17b');
    rect(x, platform.y + 7, platform.w, platform.h - 7, '#9b514c');
    for (let px = x + 8; px < x + platform.w - 5; px += 22) {
      rect(px, platform.y + 10, 4, 4, '#e58d61');
    }
  }

  function drawFood(item) {
    if (item.collected) return;
    const bobOffset = Math.sin(levelTime * 0.1 + item.bob) * 3;
    const screenX = item.worldX - cameraX + 12;
    const screenY = item.worldY + bobOffset;
    ctx.font = '27px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(item.emoji, screenX, screenY);
    ctx.textAlign = 'left';
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    rect(0, 0, W, H, '#a8e5ec');
    rect(0, 270, W, 35, '#79c6ce');
    for (let x = 20; x < W; x += 115) {
      rect(x, 230, 62, 40, '#8bd5d8');
      rect(x + 10, 241, 42, 12, '#a8e5ec');
    }
    [[70, 70], [330, 105], [680, 60], [820, 135]].forEach(([cloudX, cloudY]) => drawCloud(cloudX, cloudY));

    const pitLeft = 360;
    const pitRight = 1160;
    const pitX = pitLeft - cameraX;
    rect(pitX, 270, pitRight - pitLeft, 270, '#201a38');
    rect(pitX, 460, pitRight - pitLeft, 80, '#17142b');
    for (let x = pitX + 16; x < pitX + (pitRight - pitLeft); x += 24) {
      rect(x, 305 + ((x / 12) % 18), 10, 60, '#2a2148');
      rect(x + 5, 350 + ((x / 17) % 16), 6, 54, '#130f2a');
    }

    if (currentLevel === 2 && activePan) {
      const panX = activePan.x + Math.sin(levelTime * activePan.speed + activePan.phase) * activePan.amplitude - cameraX;
      rect(panX, activePan.y, activePan.w, activePan.h, '#d7d7e3');
      rect(panX + 8, activePan.y + 6, activePan.w - 16, 10, '#8a8ca6');
      rect(panX + 18, activePan.y - 8, 10, 12, '#f4cd5d');
      rect(panX + 52, activePan.y - 8, 10, 12, '#f4cd5d');
    }
    for (const platform of platforms) drawPlatform(platform);
    for (const item of food) drawFood(item);

    const goalX = burger.x - cameraX;
    drawDevilBurger(goalX + 9, 380, devilState.expression);
    if (devilState.visible && devilState.activeText) {
      const bubbleX = Math.max(18, goalX + 55);
      const bubbleY = 295;
      drawSpeechBubble(devilState.activeText, bubbleX, bubbleY);
    }

    const playerX = player.x - cameraX;
    drawStrawberry(playerX, player.y);
    ctx.fillStyle = '#fff5df';
    ctx.font = '12px monospace';
    ctx.fillText('✦', playerX - 9, player.y + 12);
    ctx.fillStyle = '#263a50';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(currentLevel === 1 ? 'LEVEL 01: THE POLITE KITCHEN' : currentLevel === 2 ? 'LEVEL 02: THE ANGRY KITCHEN' : 'LEVEL 03: RAGE KITCHEN', 20, 28);

    if (!running && !won) {
      rect(0, 0, W, H, '#17142b20');
    }
  }

  function loop(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min(2.2, (ts - lastTime) / 16.6667);
    lastTime = ts;
    if (running) update(dt);
    draw();
    raf = requestAnimationFrame(loop);
  }

  const audioToggle = $('audioToggle');
  if (audioToggle) {
    audioToggle.addEventListener('click', () => {
      audioController.setMuted(!audioState.muted);
      if (running) {
        if (!audioState.muted) {
          audioController.startMusic();
        } else {
          audioController.stopMusic();
        }
      }
    });
  }

  resetDevilSessionState();
  audioController.setMuted(false);
  resizeCanvas();
  loadLevel(1, false);
  draw();
})();
