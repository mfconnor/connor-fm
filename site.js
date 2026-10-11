// ==========================================
// connor.fm — shared helpers for the public pages
// ==========================================

async function loadContent() {
  const response = await fetch("/api/content", { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Could not load content.");
  }

  return response.json();
}


// Fills an element with one <p> per paragraph
// (paragraphs are separated by an empty line).
function setParagraphs(element, ...values) {
  const paragraphs = values
    .filter(value => typeof value === "string")
    .flatMap(value => value.split(/\n\s*\n/))
    .map(value => value.trim())
    .filter(Boolean);

  if (!element || paragraphs.length === 0) {
    return;
  }

  element.replaceChildren(
    ...paragraphs.map(value => createElement("p", "", value))
  );
}


function createElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
}


function showEmpty(element, message) {
  element.replaceChildren(createElement("div", "archive-empty", message));
}


function formatDate(value) {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) {
    return "";
  }

  return date
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    .toLowerCase();
}


// ==========================================
// CONTENT BINDING
//
// Elements in the HTML say which content they show:
//
//   data-content="home.title"             text
//   data-content-paragraphs="about.intro"  paragraphs (several keys: space separated)
//   data-cover="music"                    cover image / text
//
// Empty values keep the text written in the HTML.
// ==========================================

function getPath(data, path) {
  return path.split(".").reduce((value, key) => value?.[key], data);
}


function bindContent(data) {
  document.querySelectorAll("[data-content]").forEach(element => {
    const value = getPath(data, element.dataset.content);

    if (typeof value === "string" && value.trim()) {
      element.textContent = value.trim();
    }
  });

  document.querySelectorAll("[data-content-paragraphs]").forEach(element => {
    setParagraphs(
      element,
      ...element.dataset.contentParagraphs.split(" ").map(path => getPath(data, path))
    );
  });

  // "now listening" line in the footer (hidden when empty)
  document.querySelectorAll("[data-now-listening]").forEach(element => {
    const value = data.site?.nowListening?.trim();

    if (!value) {
      return;
    }

    const link = data.site.nowListeningLink;
    const song = createElement(link ? "a" : "span", "now-song", value);

    if (link) {
      song.href = link;
      song.target = "_blank";
      song.rel = "noopener noreferrer";
    }

    element.replaceChildren(createElement("span", "now-dot"), createElement("span", "now-label", "now listening"), song);
    element.hidden = false;
  });

  document.querySelectorAll("[data-cover]").forEach(element => {
    const section = data[element.dataset.cover] || {};

    if (section.coverImage) {
      const image = createElement("img");
      image.src = section.coverImage;
      image.alt = section.title || "";
      element.replaceChildren(image);
      element.classList.add("has-image");

    } else if (section.coverText && section.coverText.trim()) {
      element.replaceChildren(createElement("span", "", section.coverText.trim()));
    }
  });
}


// Loaded once per page; page scripts can use contentReady.then(...)
const contentReady = loadContent()
  .then(data => {
    bindContent(data);
    return data;
  })
  .catch(error => {
    console.error(error);
    return null;
  });


// ==========================================
// AUDIO HELPERS
// ==========================================

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);

  return `${minutes}:${String(rest).padStart(2, "0")}`;
}


const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  previous: "M6 5h2v14H6zM9.5 12 19 19V5z",
  next: "M16 5h2v14h-2zM5 19l9.5-7L5 5z"
};


function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);

  return svg;
}



// ==========================================
// COUNTDOWN
//
// <div data-countdown> on the home page counts down to
// home.countdownAt and then shows home.countdownDone.
// ==========================================

function startCountdown(element, home) {
  const target = Date.parse(home?.countdownAt);

  if (!element || Number.isNaN(target)) {
    return;
  }

  const units = [
    ["days", 86400],
    ["hours", 3600],
    ["min", 60],
    ["sec", 1]
  ];

  const numbers = units.map(([label]) => {
    const unit = createElement("div", "countdown-unit");
    const number = createElement("span", "countdown-number", "00");

    unit.append(number, createElement("span", "countdown-label", label));
    return { unit, number };
  });

  const grid = createElement("div", "countdown-grid");
  grid.append(...numbers.map(({ unit }) => unit));

  element.replaceChildren(
    createElement("div", "countdown-title", home.countdownLabel || "release in"),
    grid
  );

  element.hidden = false;

  const tick = () => {
    let left = Math.max(0, Math.floor((target - Date.now()) / 1000));

    if (left === 0) {
      clearInterval(timer);
      showCountdownDone(element, home);
      return;
    }

    units.forEach(([, size], index) => {
      const value = Math.floor(left / size);
      left -= value * size;
      numbers[index].number.textContent = String(value).padStart(2, "0");
    });
  };

  const timer = setInterval(tick, 1000);
  tick();
}


function showCountdownDone(element, home) {
  const label = home.countdownDone || "out now";
  const done = createElement(home.countdownLink ? "a" : "div", "countdown-done", label);

  if (home.countdownLink) {
    done.href = home.countdownLink;
    done.append(createElement("span", "", " →"));

    if (!home.countdownLink.startsWith("/")) {
      done.target = "_blank";
      done.rel = "noopener noreferrer";
    }
  }

  element.replaceChildren(done);
  element.hidden = false;
}


// ==========================================
// PAGE VIEWS
//
// One anonymous ping per page view (no cookies).
// ==========================================

try {
  navigator.sendBeacon("/api/hit", JSON.stringify({ path: location.pathname }));
} catch {
  // Stats are optional.
}


// ==========================================
// EASTER EGG
//
// Clicking the © in the footer: 50 % rickroll, 50 % snake.
// ==========================================

const RICKROLL_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

document.querySelectorAll(".footer-year").forEach(element => {
  element.classList.add("easter-egg");
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");

  const surprise = () => {
    if (Math.random() < 0.5) {
      window.open(RICKROLL_URL, "_blank", "noopener");
    } else {
      openSnake();
    }
  };

  element.addEventListener("click", surprise);
  element.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      surprise();
    }
  });
});


function openSnake() {
  if (document.querySelector(".snake")) {
    return;
  }

  const SIZE = 20;
  const overlay = createElement("div", "snake");
  const box = createElement("div", "snake-box");
  const head = createElement("div", "snake-head");
  const score = createElement("span", "snake-score", "score 0");
  const best = createElement("span", "snake-best");
  const close = createElement("button", "snake-close", "close ✕");
  const canvas = createElement("canvas", "snake-canvas");
  const hint = createElement("div", "snake-hint", "arrows / wasd / swipe · space to pause · esc to close");

  close.type = "button";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "snake");

  head.append(score, best, close);
  box.append(head, canvas, hint);
  overlay.append(box);
  document.body.append(overlay);

  const context = canvas.getContext("2d");
  const khaki = "#9a9865";

  let highscore = 0;

  try {
    highscore = Number(localStorage.getItem("connor-snake-best")) || 0;
  } catch {
    // ignore
  }

  let snake;
  let direction;
  let queue;
  let food;
  let points;
  let state;
  let speed;
  let timer = null;

  function reset() {
    snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    direction = { x: 1, y: 0 };
    queue = [];
    points = 0;
    speed = 130;
    state = "ready";
    placeFood();
    updateScore();
    draw();
  }

  function placeFood() {
    do {
      food = { x: Math.floor(Math.random() * SIZE), y: Math.floor(Math.random() * SIZE) };
    } while (snake.some(part => part.x === food.x && part.y === food.y));
  }

  function updateScore() {
    score.textContent = `score ${points}`;
    best.textContent = `best ${highscore}`;
  }

  function resize() {
    const pixels = Math.min(window.innerWidth - 40, window.innerHeight - 180, 480);
    const ratio = window.devicePixelRatio || 1;

    canvas.style.width = `${pixels}px`;
    canvas.style.height = `${pixels}px`;
    canvas.width = Math.round(pixels * ratio);
    canvas.height = Math.round(pixels * ratio);
    context.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
    draw();
  }

  function draw() {
    context.fillStyle = "#10100f";
    context.fillRect(0, 0, SIZE, SIZE);

    // faint grid
    context.fillStyle = "rgba(232, 232, 227, 0.035)";
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        context.fillRect(x + 0.47, y + 0.47, 0.06, 0.06);
      }
    }

    context.fillStyle = "#e8e8e3";
    context.fillRect(food.x + 0.25, food.y + 0.25, 0.5, 0.5);

    snake.forEach((part, index) => {
      context.fillStyle = index === 0 ? khaki : `rgba(154, 152, 101, ${Math.max(0.35, 0.85 - index * 0.02)})`;
      context.fillRect(part.x + 0.06, part.y + 0.06, 0.88, 0.88);
    });

    if (state !== "running") {
      context.fillStyle = "rgba(8, 8, 8, 0.6)";
      context.fillRect(0, 0, SIZE, SIZE);
      context.fillStyle = "#e8e8e3";
      context.textAlign = "center";
      context.font = "bold 1.6px Arial, Helvetica, sans-serif";

      const title = { ready: "snake", paused: "paused", over: "game over" }[state];
      context.fillText(title, SIZE / 2, SIZE / 2 - 0.4);

      context.fillStyle = "#8c8c87";
      context.font = "0.7px monospace";
      context.fillText(state === "over" ? "press space or tap to play again" : "press space or tap to start", SIZE / 2, SIZE / 2 + 1.2);
    }
  }

  function step() {
    if (queue.length) {
      direction = queue.shift();
    }

    const next = {
      x: (snake[0].x + direction.x + SIZE) % SIZE,
      y: (snake[0].y + direction.y + SIZE) % SIZE
    };

    if (snake.some(part => part.x === next.x && part.y === next.y)) {
      gameOver();
      return;
    }

    snake.unshift(next);

    if (next.x === food.x && next.y === food.y) {
      points += 1;
      speed = Math.max(60, speed - 3);
      placeFood();
      updateScore();
      restartTimer();
    } else {
      snake.pop();
    }

    draw();
  }

  function restartTimer() {
    clearInterval(timer);
    timer = setInterval(step, speed);
  }

  function start() {
    if (state === "over") {
      reset();
    }

    state = "running";
    restartTimer();
    draw();
  }

  function pause() {
    state = "paused";
    clearInterval(timer);
    draw();
  }

  function gameOver() {
    state = "over";
    clearInterval(timer);

    if (points > highscore) {
      highscore = points;

      try {
        localStorage.setItem("connor-snake-best", String(highscore));
      } catch {
        // ignore
      }
    }

    updateScore();
    draw();
  }

  function turn(x, y) {
    const last = queue[queue.length - 1] || direction;

    // No turning back into yourself.
    if (last.x === -x && last.y === -y) {
      return;
    }

    if (last.x !== x || last.y !== y) {
      queue.push({ x, y });
    }

    if (state !== "running") {
      start();
    }
  }

  const keys = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0]
  };

  function onKey(event) {
    if (event.key === "Escape") {
      shut();
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      state === "running" ? pause() : start();
      return;
    }

    if (keys[event.key]) {
      event.preventDefault();
      turn(...keys[event.key]);
    }
  }

  // Swipe on phones
  let touchStart = null;

  canvas.addEventListener("touchstart", event => {
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });

  canvas.addEventListener("touchend", event => {
    if (!touchStart) {
      return;
    }

    const dx = event.changedTouches[0].clientX - touchStart.x;
    const dy = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) {
      state === "running" ? pause() : start();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      turn(Math.sign(dx), 0);
    } else {
      turn(0, Math.sign(dy));
    }
  });

  canvas.addEventListener("click", () => {
    if (state !== "running") {
      start();
    }
  });

  function shut() {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", resize);
    overlay.remove();
    document.body.classList.remove("snake-open");
  }

  close.addEventListener("click", shut);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) {
      shut();
    }
  });

  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  document.body.classList.add("snake-open");

  reset();
  resize();
  close.focus();
}
