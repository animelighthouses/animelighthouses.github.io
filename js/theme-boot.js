/* Must stay in sync with THEME_STORAGE_KEY in js/preferences.js ("animelighthouse.theme"). */
(function () {
  try {
    if (localStorage.getItem("animelighthouse.theme") === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch (_) {}
})();
