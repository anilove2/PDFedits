/* Runs before paint: theme + no-JS guard; then the file:// notice. */
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
      root.classList.add("is-file");
      var notice = document.getElementById("file-notice");
      if (notice) notice.hidden = false;
    });
  }

  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
  }
})();
