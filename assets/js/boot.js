/* Runs before paint: theme, no-JS guard, file:// banner. */
(function () {
  var root = document.documentElement;
  root.classList.add("js");

  try {
    var stored = localStorage.getItem("pdfedits-theme");
    var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = stored || (dark ? "dark" : "light");
  } catch (e) {}

  if (location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
      var banner = document.getElementById("file-banner");
      if (banner) banner.hidden = false;
      root.classList.add("is-file");
    });
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
