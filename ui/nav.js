export function initViewNav() {
  const viewRecent = document.getElementById("view-recent");
  const viewIndex = document.getElementById("view-index");

  if (!viewRecent || !viewIndex) return;

  const path = (window.location.pathname || "").toLowerCase();
  const isIndexView = path.includes("index-view");

  viewRecent.classList.toggle("active", !isIndexView);
  viewIndex.classList.toggle("active", isIndexView);
}

