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
