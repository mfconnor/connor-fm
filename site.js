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


// Sets the text of an element, but keeps the
// static fallback in the HTML when the value is empty.
function setText(id, value) {
  const element = document.getElementById(id);

  if (element && typeof value === "string" && value.trim()) {
    element.textContent = value.trim();
  }
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
