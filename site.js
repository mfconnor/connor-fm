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
